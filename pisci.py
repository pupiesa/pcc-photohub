#!/usr/bin/env python3
# server_pi_cam_api.py — Raspberry Pi CSI Camera streaming + capture server
# - Flask + Picamera2
# - Live preview (MJPEG) at 1920x1080
# - Capture still images, confirm/download flow
# - All API routes kept from DSLR version, but simplified to Pi camera only

import os, sys, time, signal, threading
from datetime import datetime
import cv2
from flask import Flask, Response, send_file, send_from_directory, jsonify, request
from picamera2 import Picamera2

# ---------- ENV ----------
def _clamp_fps(x):
    try:
        v = float(x)
        return max(1.0, min(60.0, v))
    except Exception:
        return 18.0

PREVIEW_FPS_ENV = (os.getenv("PREVIEW_FPS") or "").strip()
preview_fps = _clamp_fps(PREVIEW_FPS_ENV or 18.0)
COLOR_SPACE = os.getenv("COLOR_SPACE", "RGB").upper()
# ---------- APP ----------
app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SAVE_DIR = os.path.join(BASE_DIR, "captured_images")
os.makedirs(SAVE_DIR, exist_ok=True)

# ---------- Globals ----------
latest_frame = None
latest_frame_ver = 0
lock = threading.Lock()
running = False
capture_thread = None
viewers = 0
mode = "live"

captured_image = None
captured_filename = None

picam2 = None

# ---------- Utils ----------
def _nocache_headers(resp):
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp

def _set_latest_frame(data: bytes):
    global latest_frame, latest_frame_ver
    with lock:
        latest_frame = data
        latest_frame_ver += 1

# ---------- Capture loop ----------
def capture_loop():
    global running, picam2

    if not picam2:
        picam2 = Picamera2()
    config = picam2.create_video_configuration(main={"size": (1920, 1080)})
    picam2.configure(config)
    picam2.start()

    frame_interval = 1.0 / preview_fps
    next_tick = time.monotonic() + frame_interval

    while running:
        frame = picam2.capture_array()
        if COLOR_SPACE == "RGB":
            frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        ret, buf = cv2.imencode(".jpg", frame)
        if ret:
            _set_latest_frame(buf.tobytes())
        now = time.monotonic()
        sleep_for = next_tick - now
        if sleep_for > 0:
            time.sleep(sleep_for)
        next_tick += frame_interval

    picam2.stop()
    print("[INFO] Pi Camera capture_loop stopped")

# ---------- Stream generator ----------
def generate_frames():
    global latest_frame_ver
    last_sent_ver = -1
    boundary = b'--frame\r\n'
    while True:
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
    if running:
        return
    running = True
    capture_thread = threading.Thread(target=capture_loop, daemon=True)
    capture_thread.start()

# ---------- Routes ----------
@app.route('/')
def root():
    return "OK", 200

@app.route('/api/health')
def api_health():
    return jsonify({
        "ok": True,
        "running": running,
        "viewers": viewers,
        "mode": mode,
        "preview_fps": preview_fps,
    }), 200

@app.route('/video_feed')
def video_feed():
    global viewers
    viewers += 1
    start_capture_thread()
    def stream():
        global viewers
        try:
            for chunk in generate_frames():
                yield chunk
        finally:
            viewers = max(0, viewers - 1)
            if viewers == 0:
                stop_capture_thread()
    resp = Response(stream(), mimetype='multipart/x-mixed-replace; boundary=frame')
    resp.headers["X-Accel-Buffering"] = "no"
    return _nocache_headers(resp)

@app.route('/capture', methods=['POST'])
def capture():
    global captured_image, captured_filename, mode, picam2
    stop_capture_thread()
    if not picam2:
        picam2 = Picamera2()
        config = picam2.create_still_configuration(main={"size": (1920, 1080)})
        picam2.configure(config)
        picam2.start()
    frame = picam2.capture_array()
    if COLOR_SPACE == "RGB":
        frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    host_filename = f"capture_{ts}.jpg"
    host_filepath = os.path.join(SAVE_DIR, host_filename)
    cv2.imwrite(host_filepath, frame)
    with open(host_filepath, "rb") as f:
        captured_image = f.read()
    captured_filename = os.path.abspath(host_filepath)
    _set_latest_frame(captured_image)
    mode = "captured"
    return jsonify({
        "ok": True,
        "url": f"/captured_images/{os.path.basename(host_filepath)}",
        "serverPath": captured_filename,
    }), 200

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
            mimetype="image/jpeg",
            as_attachment=False,
            download_name=os.path.basename(captured_filename),
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
            "url": f"/captured_images/{os.path.basename(captured_filename)}",
        }), 200
    else:
        return jsonify({"ok": False, "error": "No image to confirm"}), 400

@app.route('/stop_stream', methods=['POST'])
@app.route('/stop', methods=['POST'])
def stop_stream():
    global mode, latest_frame
    mode = "live"
    stop_capture_thread()
    with lock:
        latest_frame = None
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
    print(f"[BOOT] Save dir: {SAVE_DIR}")
    print(f"[BOOT] Preview FPS: {preview_fps}")
    app.run(host='0.0.0.0', port=8080, debug=True, use_reloader=False)
