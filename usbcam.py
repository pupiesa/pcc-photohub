#!/usr/bin/env python3
# serverV8.py — DSLR/Mirrorless OR USB Webcam control on Raspberry Pi
# - Flask + gphoto2 + OpenCV
# - Live preview (MJPEG) limited FPS and send only "new frames"
# - Auto-focus for DSLR when starting Live View and before capture
# - Supports DSLR/mirrorless via gphoto2, or USB webcams (/dev/video*)
# - User selects device before server starts
#
# ENV:
#   FRONTEND_ORIGIN=http://<ui-host>:3000
#   CAMERA_PORT=usb:001,010   # for gphoto2
#   PREVIEW_FPS=18            # (1–60)
#
# pip install flask flask-cors gphoto2 opencv-python-headless

import os, sys, time, signal, threading, mimetypes, glob
from datetime import datetime
import gphoto2 as gp
import cv2
from flask import Flask, Response, request, send_file, send_from_directory, jsonify
from flask_cors import CORS

# ---------- ENV ----------
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://127.0.0.1:3000")
CAMERA_PORT_ENV = os.getenv("CAMERA_PORT", "").strip() or None

def _clamp_fps(x):
    try:
        v = float(x)
        return max(1.0, min(60.0, v))
    except Exception:
        return 18.0

PREVIEW_FPS_ENV = (os.getenv("PREVIEW_FPS") or "").strip()
preview_fps = _clamp_fps(PREVIEW_FPS_ENV or 18.0)

# ---------- APP ----------
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": FRONTEND_ORIGIN}})

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SAVE_DIR = os.path.join(BASE_DIR, "captured_images")
os.makedirs(SAVE_DIR, exist_ok=True)

# ---------- Globals ----------
selected_port = CAMERA_PORT_ENV
latest_frame = None
latest_frame_ver = 0
latest_frame_ts = 0.0
captured_image = None
captured_filename = None
mode = "live"
running = False
lock = threading.Lock()
capture_thread = None
supports_preview = None
viewers = 0
last_error = None

# new globals
CAMERA_TYPE = None  # "gphoto2" or "webcam"
WEBCAM_INDEX = None

EXT_MAP = {
    'image/jpeg': '.jpg',
    'image/x-canon-cr2': '.cr2',
    'image/x-nikon-nef': '.nef',
    'image/tiff': '.tif',
}

# ---------- Utils ----------
def _nocache_headers(resp):
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp

def _choose_ext(mime: str, fallback_name: str) -> str:
    ext = EXT_MAP.get(mime)
    if not ext:
        guessed = mimetypes.guess_extension(mime or '')
        ext = guessed or os.path.splitext(fallback_name)[1] or '.bin'
    return ext

def _set_latest_frame(data: bytes):
    global latest_frame, latest_frame_ver, latest_frame_ts, lock
    with lock:
        latest_frame = data
        latest_frame_ver += 1
        latest_frame_ts = time.monotonic()

# ---------- Camera detect ----------
def list_cameras():
    try:
        arr = gp.Camera.autodetect()
        return arr or []
    except gp.GPhoto2Error as e:
        print(f"[ERROR] autodetect failed: {e}")
        return []

def list_webcams(max_devices=5):
    found = []
    for i in range(max_devices):
        cap = cv2.VideoCapture(i)
        if cap.isOpened():
            found.append((f"USB Webcam {i}", str(i)))
            cap.release()
    return found

def pick_camera():
    global CAMERA_TYPE, selected_port, WEBCAM_INDEX
    gphoto2_cams = list_cameras()
    webcams = list_webcams()

    print("\n[BOOT] Camera detection:")
    devices = []
    for (m, p) in gphoto2_cams:
        devices.append(("gphoto2", p, m))
    for (m, p) in webcams:
        devices.append(("webcam", p, m))

    if not devices:
        print("[ERROR] No cameras detected (gphoto2 or webcam)")
        sys.exit(1)

    for idx, (typ, port, name) in enumerate(devices):
        print(f"  [{idx}] {name} ({typ}:{port})")

    choice = input("Select camera index: ").strip()
    if not choice.isdigit() or int(choice) < 0 or int(choice) >= len(devices):
        print("[ERROR] Invalid choice")
        sys.exit(1)

    typ, port, name = devices[int(choice)]
    CAMERA_TYPE = typ
    if typ == "gphoto2":
        selected_port = port
        print(f"[INFO] Selected gphoto2 camera on port {port}")
    else:
        WEBCAM_INDEX = int(port)
        print(f"[INFO] Selected USB webcam index {WEBCAM_INDEX}")

# ---------- DSLR helpers (unchanged from V7, shortened for brevity) ----------
def _cfg(cam):
    try: return cam.get_config()
    except gp.GPhoto2Error: return None

def _find_child(cfg, names):
    if not cfg: return None, None
    for name in names:
        try:
            node = cfg.get_child_by_name(name)
            if node: return cfg, node
        except gp.GPhoto2Error: pass
    return cfg, None

def _set_value(cam, cfg, node, value):
    try:
        node.set_value(value); cam.set_config(cfg); return True
    except gp.GPhoto2Error as e:
        print(f"[WARN] set_value({value}) failed: {e}"); return False

def connect_camera(camera_port=None):
    global last_error
    last_error = None
    cam = gp.Camera()
    port_to_use = camera_port
    if not port_to_use:
        detected = list_cameras()
        if detected:
            port_to_use = detected[0][1]
            print(f"[INFO] Auto-select port: {port_to_use}")
        else:
            last_error = "No camera detected by libgphoto2"
            return None
    try:
        pil = gp.PortInfoList(); pil.load()
        idx = pil.lookup_path(port_to_use)
        cam.set_port_info(pil[idx])
        cam.init()
        return cam
    except gp.GPhoto2Error as e:
        last_error = f"Camera init failed: {e}"
        try: cam.exit()
        except: pass
        return None

def safe_capture_one(cam):
    file_path = cam.capture(gp.GP_CAPTURE_IMAGE)
    cam_folder, cam_name = file_path.folder, file_path.name
    camera_file = cam.file_get(cam_folder, cam_name, gp.GP_FILE_TYPE_NORMAL)
    mime = camera_file.get_mime_type()
    ext = _choose_ext(mime, cam_name)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    host_filename = f"capture_{ts}{ext}"
    host_filepath = os.path.join(SAVE_DIR, host_filename)
    camera_file.save(host_filepath)
    try: cam.file_delete(cam_folder, cam_name)
    except gp.GPhoto2Error: pass
    return host_filepath, mime

# ---------- Capture loop ----------
def capture_loop():
    global latest_frame, mode, running, supports_preview, selected_port, last_error, preview_fps

    if CAMERA_TYPE == "gphoto2":
        cam = connect_camera(selected_port)
        frame_interval = 1.0 / max(1.0, float(preview_fps))
        next_tick = time.monotonic() + frame_interval
        while running:
            if not cam:
                time.sleep(0.4)
                cam = connect_camera(selected_port)
                continue
            try:
                camera_file = cam.capture_preview()
                data = gp.check_result(gp.gp_file_get_data_and_size(camera_file))
                b = memoryview(data).tobytes()
                if b and b[:2] == b'\xff\xd8':
                    _set_latest_frame(b)
            except gp.GPhoto2Error:
                time.sleep(0.1)
            now = time.monotonic()
            sleep_for = next_tick - now
            if sleep_for > 0: time.sleep(sleep_for)
            next_tick += frame_interval
        if cam:
            try: cam.exit()
            except: pass
        print("[INFO] DSLR capture_loop stopped")

    elif CAMERA_TYPE == "webcam":
        cap = cv2.VideoCapture(WEBCAM_INDEX)
        if not cap.isOpened():
            last_error = f"Cannot open webcam index {WEBCAM_INDEX}"
            running = False
            return
        frame_interval = 1.0 / max(1.0, float(preview_fps))
        next_tick = time.monotonic() + frame_interval
        while running:
            ret, frame = cap.read()
            if not ret:
                time.sleep(0.05); continue
            ret, buf = cv2.imencode(".jpg", frame)
            if ret:
                _set_latest_frame(buf.tobytes())
            now = time.monotonic()
            sleep_for = next_tick - now
            if sleep_for > 0: time.sleep(sleep_for)
            next_tick += frame_interval
        cap.release()
        print("[INFO] Webcam capture_loop stopped")

# ---------- Stream generator ----------
def generate_frames():
    global preview_fps, latest_frame_ver
    send_interval = 1.0 / max(1.0, float(preview_fps))
    next_send = time.monotonic()
    last_sent_ver = -1
    boundary = b'--frame\r\n'
    while True:
        now = time.monotonic()
        if now < next_send:
            time.sleep(min(0.005, next_send - now))
            continue
        with lock:
            frame = latest_frame
            ver = latest_frame_ver
        if frame and ver != last_sent_ver:
            headers = (
                b'Content-Type: image/jpeg\r\n' +
                b'Content-Length: ' + str(len(frame)).encode('ascii') + b'\r\n\r\n'
            )
            yield boundary + headers + frame + b'\r\n'
            last_sent_ver = ver
            next_send = time.monotonic() + send_interval
        else:
            time.sleep(0.01)

# ---------- Thread control ----------
def stop_capture_thread():
    global running, capture_thread
    if capture_thread and capture_thread.is_alive():
        running = False
        capture_thread.join(timeout=2)
    capture_thread = None

def start_capture_thread():
    global running, capture_thread
    if running: return
    running = True
    capture_thread = threading.Thread(target=capture_loop, daemon=True)
    capture_thread.start()

def has_viewers(): return viewers > 0
def ensure_preview_if_needed():
    if has_viewers(): start_capture_thread()
    else: stop_capture_thread()

# ---------- Routes ----------
@app.route('/')
def root(): return "OK", 200

@app.route('/api/health')
def api_health():
    return jsonify({
        "ok": True, "running": running, "viewers": viewers, "mode": mode,
        "selected_port": selected_port, "camera_type": CAMERA_TYPE,
        "last_error": last_error, "preview_fps": preview_fps,
    }), 200

@app.route('/capture', methods=['POST'])
def capture():
    global captured_image, captured_filename, mode, last_error
    stop_capture_thread()
    if CAMERA_TYPE == "gphoto2":
        cam = connect_camera(selected_port)
        if not cam:
            ensure_preview_if_needed()
            return jsonify({"ok": False, "error": last_error or "Camera not available"}), 503
        try:
            host_filepath, mime = safe_capture_one(cam)
            with open(host_filepath, 'rb') as f:
                captured_image = f.read()
            captured_filename = os.path.abspath(host_filepath)
            if mime == 'image/jpeg':
                _set_latest_frame(captured_image)
            mode = "captured"
            rel_url = f"/captured_images/{os.path.basename(host_filepath)}"
            return jsonify({"ok": True, "url": rel_url, "serverPath": captured_filename}), 200
        except Exception as e:
            last_error = f"Capture failed: {e}"
            return jsonify({"ok": False, "error": last_error}), 500
        finally:
            try: cam.exit()
            except: pass
            ensure_preview_if_needed()
    elif CAMERA_TYPE == "webcam":
        cap = cv2.VideoCapture(WEBCAM_INDEX)
        ret, frame = cap.read()
        cap.release()
        if not ret:
            return jsonify({"ok": False, "error": "Webcam capture failed"}), 500
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        host_filename = f"capture_{ts}.jpg"
        host_filepath = os.path.join(SAVE_DIR, host_filename)
        cv2.imwrite(host_filepath, frame)
        with open(host_filepath, 'rb') as f:
            captured_image = f.read()
        captured_filename = os.path.abspath(host_filepath)
        _set_latest_frame(captured_image)
        mode = "captured"
        rel_url = f"/captured_images/{os.path.basename(host_filepath)}"
        return jsonify({"ok": True, "url": rel_url, "serverPath": captured_filename}), 200

@app.route('/video_feed')
def video_feed():
    global viewers
    viewers += 1
    ensure_preview_if_needed()
    def stream():
        global viewers
        try:
            for chunk in generate_frames(): yield chunk
        finally:
            viewers = max(0, viewers - 1)
            ensure_preview_if_needed()
    resp = Response(stream(), mimetype='multipart/x-mixed-replace; boundary=frame')
    resp.headers["X-Accel-Buffering"] = "no"
    return _nocache_headers(resp)

@app.route('/captured_images/<path:filename>')
def serve_captured_image(filename):
    resp = send_from_directory(SAVE_DIR, filename)
    return _nocache_headers(resp)

@app.route('/download')
def download_image():
    global captured_image, captured_filename
    if captured_image and captured_filename:
        resp = send_file(
            captured_filename,
            mimetype='image/jpeg',
            as_attachment=False,
            download_name=os.path.basename(captured_filename)
        )
        return _nocache_headers(resp)
    else:
        return "No image captured", 404
    
@app.route('/confirm', methods=['POST'])
def confirm():
    global captured_image, captured_filename, mode
    if captured_image and captured_filename:
        mode = "confirmed"
        return jsonify({
            "ok": True,
            "serverPath": captured_filename,
            "url": f"/captured_images/{os.path.basename(captured_filename)}"
        }), 200
    else:
        return jsonify({"ok": False, "error": "No image to confirm"}), 400


@app.route('/stop_stream', methods=['POST'])
@app.route('/stop', methods=['POST'])
def stop_stream():
    global mode, latest_frame
    mode = "live"
    stop_capture_thread()
    with lock: latest_frame = None
    return jsonify({"ok": True, "stopped": True}), 200

# ---------- Cleanup ----------
def cleanup(sig, frame):
    print("\n[INFO] Shutting down server...")
    stop_capture_thread()
    sys.exit(0)

signal.signal(signal.SIGINT, cleanup)
signal.signal(signal.SIGTERM, cleanup)

# ---------- Main ----------
if __name__ == '__main__':
    print(f"[BOOT] FRONTEND_ORIGIN={FRONTEND_ORIGIN}")
    print(f"[BOOT] CAMERA_PORT (env)={CAMERA_PORT_ENV}")
    print(f"[BOOT] Save dir: {SAVE_DIR}")
    print(f"[BOOT] Preview FPS: {preview_fps}")
    print(f"[BOOT] Detected DSLR: {list_cameras()}")
    print(f"[BOOT] Detected Webcams: {list_webcams()}")

    pick_camera()  # <<<<<< user chooses first

    app.run(host='0.0.0.0', port=8080, debug=True, use_reloader=False)
