#!/usr/bin/env python3
# server_pi.py â€ Raspberry Pi Camera Control (Flask + PiCamera2 + OpenCV)
# - Provides API routes for preview, capture, confirm, stop, etc.
# - Uses PiCamera2 at 1920x1080 resolution
# - CORS enabled for all routes

import os, sys, time, signal, threading
from datetime import datetime
import cv2
import numpy as np
from flask import Flask, Response, request, send_file, send_from_directory, jsonify
from flask_cors import CORS
from picamera2 import Picamera2

# ---------- APP ----------
app = Flask(__name__)
CORS(app)  # enable CORS for all routes

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SAVE_DIR = os.path.join(BASE_DIR, "captured_images")
os.makedirs(SAVE_DIR, exist_ok=True)

# ---------- Globals ----------
latest_frame = None
latest_frame_ver = 0
latest_frame_ts = 0.0
captured_image = None
captured_filename = None
mode = "live"
running = False
lock = threading.Lock()
capture_thread = None
viewers = 0
last_error = None

preview_fps = 60  # adjustable
FRAME_WIDTH = 1920
FRAME_HEIGHT = 1080

# Initialize PiCamera2
picam2 = Picamera2()
config = picam2.create_preview_configuration(
    main={"size": (FRAME_WIDTH, FRAME_HEIGHT), "format": "RGB888"}
)
picam2.configure(config)

# ---------- Utils ----------
def _nocache_headers(resp):
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp

def _set_latest_frame(data: bytes):
    global latest_frame, latest_frame_ver, latest_frame_ts, lock
    with lock:
        latest_frame = data
        latest_frame_ver += 1
        latest_frame_ts = time.monotonic()

# ---------- Capture loop ----------
def capture_loop():
    global latest_frame, running, preview_fps
    frame_interval = 1.0 / max(1.0, float(preview_fps))
    next_tick = time.monotonic() + frame_interval

    picam2.start()
    while running:
        frame = picam2.capture_array()
        # Encode as JPEG in RGB
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        ret, buf = cv2.imencode(".jpg", rgb_frame)
        if ret:
            _set_latest_frame(buf.tobytes())
        now = time.monotonic()
        sleep_for = next_tick - now
        if sleep_for > 0:
            time.sleep(sleep_for)
        next_tick += frame_interval
    picam2.stop()
    print("[INFO] PiCamera capture_loop stopped")

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
            # Decode and re-encode to ensure RGB colors
            np_frame = cv2.imdecode(np.frombuffer(frame, np.uint8), cv2.IMREAD_COLOR)
            rgb_frame = cv2.cvtColor(np_frame, cv2.COLOR_BGR2RGB)
            ret, buf = cv2.imencode(".jpg", rgb_frame)
            if not ret:
                continue

            headers = (
                b'Content-Type: image/jpeg\r\n' +
                b'Content-Length: ' + str(len(buf)).encode('ascii') + b'\r\n\r\n'
            )
            yield boundary + headers + buf.tobytes() + b'\r\n'
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
        "last_error": last_error, "preview_fps": preview_fps,
    }), 200

@app.route('/capture', methods=['POST'])
def capture():
    global captured_image, captured_filename, mode
    stop_capture_thread()
    try:
        frame = picam2.capture_array()
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        ret, buf = cv2.imencode(".jpg", rgb_frame)
        if not ret:
            return jsonify({"ok": False, "error": "Capture failed"}), 500
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        host_filename = f"capture_{ts}.jpg"
        host_filepath = os.path.join(SAVE_DIR, host_filename)
        cv2.imwrite(host_filepath, rgb_frame)
        with open(host_filepath, 'rb') as f:
            captured_image = f.read()
        captured_filename = os.path.abspath(host_filepath)
        _set_latest_frame(captured_image)
        mode = "captured"
        rel_url = f"/captured_images/{os.path.basename(host_filepath)}"
        return jsonify({"ok": True, "url": rel_url, "serverPath": captured_filename}), 200
    finally:
        ensure_preview_if_needed()

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
    print(f"[BOOT] Save dir: {SAVE_DIR}")
    print(f"[BOOT] Preview FPS: {preview_fps}")
    print(f"[BOOT] PiCamera2 Resolution: {FRAME_WIDTH}x{FRAME_HEIGHT}")
    app.run(host='0.0.0.0', port=8080, debug=True, use_reloader=False)
