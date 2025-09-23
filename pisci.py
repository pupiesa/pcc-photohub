#!/usr/bin/env python3

import os, sys, time, signal, threading, cv2
from datetime import datetime
from flask import Flask, Response, request, send_file, send_from_directory, jsonify
from flask_cors import CORS
from picamera2 import Picamera2

# ---------- Setup ----------
app = Flask(__name__)
CORS(app)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SAVE_DIR = os.path.join(BASE_DIR, "captured_images")
os.makedirs(SAVE_DIR, exist_ok=True)

picam2 = Picamera2()
preview_config = picam2.create_preview_configuration(main={"size": (1920, 1080)})
picam2.configure(preview_config)
picam2.start()

latest_frame = None
latest_frame_ver = 0
captured_image = None
captured_filename = None
mode = "live"
lock = threading.Lock()
running = False
capture_thread = None
viewers = 0
last_error = None
preview_fps = 60.0  # default fps

# ---------- Helpers ----------
def _set_latest_frame(frame_bytes: bytes):
    global latest_frame, latest_frame_ver
    with lock:
        latest_frame = frame_bytes
        latest_frame_ver += 1

def generate_frames():
    global latest_frame_ver
    boundary = b'--frame\r\n'
    last_ver = -1

    while True:
        with lock:
            frame = latest_frame
            ver = latest_frame_ver

        if frame and ver != last_ver:
            headers = (
                b'Content-Type: image/jpeg\r\n'
                + b'Content-Length: ' + str(len(frame)).encode() + b'\r\n\r\n'
            )
            yield boundary + headers + frame + b'\r\n'
            last_ver = ver
        else:
            time.sleep(0.01)

def capture_loop():
    global running
    while running:
        try:
            frame = picam2.capture_array("main")
            # Convert BGR to RGB for correct colors
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            ret, buf = cv2.imencode(".jpg", rgb_frame)
            if ret:
                _set_latest_frame(buf.tobytes())
            time.sleep(1.0 / preview_fps)
        except Exception as e:
            print(f"[WARN] capture_loop error: {e}")
            time.sleep(0.1)

def start_capture_thread():
    global running, capture_thread
    if running: return
    running = True
    capture_thread = threading.Thread(target=capture_loop, daemon=True)
    capture_thread.start()

def stop_capture_thread():
    global running, capture_thread
    running = False
    if capture_thread and capture_thread.is_alive():
        capture_thread.join(timeout=2)
    capture_thread = None

def ensure_preview_if_needed():
    if viewers > 0:
        start_capture_thread()
    else:
        stop_capture_thread()

# ---------- Routes ----------
@app.route("/")
def root():
    return "OK", 200

@app.route("/api/health")
def api_health():
    return jsonify({
        "ok": True, "running": running, "viewers": viewers,
        "mode": mode, "last_error": last_error, "preview_fps": preview_fps
    })

@app.route("/video_feed")
def video_feed():
    global viewers
    viewers += 1
    ensure_preview_if_needed()

    def stream():
        global viewers
        try:
            for chunk in generate_frames():
                yield chunk
        finally:
            viewers = max(0, viewers - 1)
            ensure_preview_if_needed()

    resp = Response(stream(), mimetype="multipart/x-mixed-replace; boundary=frame")
    resp.headers["X-Accel-Buffering"] = "no"
    return resp

@app.route("/capture", methods=["POST"])
def capture():
    global captured_image, captured_filename, mode
    try:
        frame = picam2.capture_array("main")
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)  # convert to RGB
        ret, buf = cv2.imencode(".jpg", rgb_frame)
        if not ret:
            return jsonify({"ok": False, "error": "Failed to encode image"}), 500

        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        host_filename = f"capture_{ts}.jpg"
        host_filepath = os.path.join(SAVE_DIR, host_filename)
        cv2.imwrite(host_filepath, rgb_frame)

        with open(host_filepath, "rb") as f:
            captured_image = f.read()
        captured_filename = host_filepath

        _set_latest_frame(captured_image)
        mode = "captured"

        rel_url = f"/captured_images/{os.path.basename(host_filepath)}"
        return jsonify({"ok": True, "url": rel_url, "serverPath": captured_filename})
    except Exception as e:
        return jsonify({"ok": False, "error": f"Capture failed: {e}"}), 500

@app.route("/confirm", methods=["POST"])
def confirm():
    global captured_image, captured_filename, mode
    captured_image = None
    captured_filename = None
    mode = "live"
    ensure_preview_if_needed()
    ts = int(time.time() * 1000)
    return jsonify({"ok": True, "video": f"/video_feed?ts={ts}"})

@app.route("/return_live", methods=["POST"])
def return_live():
    global captured_image, captured_filename, mode
    captured_image = None
    captured_filename = None
    mode = "live"
    ensure_preview_if_needed()
    return "Live", 200

@app.route("/captured_images/<path:filename>")
def serve_captured_image(filename):
    return send_from_directory(SAVE_DIR, filename)

@app.route("/download")
def download_image():
    global captured_filename
    if captured_filename:
        return send_file(captured_filename, as_attachment=True)
    return "No image captured", 404

@app.route("/stop_stream", methods=["POST"])
@app.route("/stop", methods=["POST"])
def stop_stream():
    global mode
    mode = "live"
    stop_capture_thread()
    return jsonify({"ok": True, "stopped": True})

# ---------- Cleanup ----------
def cleanup(sig, frame):
    print("\n[INFO] Shutting down server...")
    stop_capture_thread()
    picam2.close()
    sys.exit(0)

signal.signal(signal.SIGINT, cleanup)
signal.signal(signal.SIGTERM, cleanup)

if __name__ == "__main__":
    print(f"[BOOT] Save dir: {SAVE_DIR}")
    print(f"[BOOT] Preview FPS: {preview_fps}")
    app.run(host="0.0.0.0", port=8080, debug=True, use_reloader=False)
