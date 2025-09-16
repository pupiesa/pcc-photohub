#!/usr/bin/env python3
# server_webcam.py — Webcam control on Raspberry Pi / PC (Flask + OpenCV)
# Features:
# - Live preview via /video_feed (MJPEG, no-cache)
# - Select camera index via /set_camera
# - Robust capture via /capture (JPEG)
# - Confirm via /confirm to clear captured state and return to live
# - Serve last file via /captured_images/<name> or /download
# Notes:
#   pip install flask flask-cors opencv-python numpy pillow imageio

import os
import sys
import time
import signal
import threading
from datetime import datetime

import cv2
from flask import Flask, Response, request, send_file, send_from_directory, jsonify
from flask_cors import CORS

# ------------------------------------------------------------
# Flask app & CORS
# ------------------------------------------------------------
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": FRONTEND_ORIGIN}})

SAVE_DIR = "captured_images"
os.makedirs(SAVE_DIR, exist_ok=True)

# ------------------------------------------------------------
# Global state
# ------------------------------------------------------------
selected_camera = 0        # default webcam index
latest_frame = None        # bytes (JPEG; for MJPEG stream)
captured_image = None      # bytes (for /download)
captured_filename = None   # str (path on disk)
mode = "live"              # "live" or "captured" (informational)
running = False            # capture thread control
lock = threading.Lock()
capture_thread = None
cap = None                 # OpenCV VideoCapture object

# ------------------------------------------------------------
# Utilities
# ------------------------------------------------------------
def _nocache_headers(resp):
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp

def _init_camera(index):
    global cap
    if cap:
        cap.release()
    cap = cv2.VideoCapture(index)
    if not cap.isOpened():
        print(f"[ERROR] Cannot open camera {index}")
        cap = None
    return cap

def safe_capture_one():
    """Captures one frame from webcam and saves as JPEG"""
    global cap
    if not cap:
        _init_camera(selected_camera)
        if not cap:
            raise RuntimeError("Camera not available")
    ret, frame = cap.read()
    if not ret or frame is None:
        raise RuntimeError("Failed to capture frame")

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    host_filename = f"capture_{ts}.jpg"
    host_filepath = os.path.join(SAVE_DIR, host_filename)
    cv2.imwrite(host_filepath, frame)

    return host_filepath, frame

# ------------------------------------------------------------
# Live capture thread (preview loop)
# ------------------------------------------------------------
def capture_loop():
    """Continuously update latest_frame from webcam"""
    global latest_frame, mode, running, cap

    _init_camera(selected_camera)

    while running:
        try:
            if not cap:
                time.sleep(0.2)
                _init_camera(selected_camera)
                continue

            if mode == "live":
                ret, frame = cap.read()
                if ret and frame is not None:
                    ret2, buffer = cv2.imencode('.jpg', frame)
                    if ret2:
                        with lock:
                            latest_frame = buffer.tobytes()
                else:
                    time.sleep(0.05)
            else:
                time.sleep(0.05)
        except Exception as e:
            print(f"[WARN] Camera error: {e}")
            time.sleep(0.5)

    if cap:
        cap.release()
        cap = None
    print("[INFO] capture_loop stopped")

def generate_frames():
    """Yield latest_frame as multipart/x-mixed-replace JPEG stream."""
    global latest_frame
    while True:
        with lock:
            frame = latest_frame
        if frame:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
        else:
            time.sleep(0.05)

def stop_capture_thread():
    global running, capture_thread
    if capture_thread and capture_thread.is_alive():
        running = False
        capture_thread.join(timeout=2)
    capture_thread = None

def start_capture_thread():
    global running, capture_thread, mode
    mode = "live"
    running = True
    capture_thread = threading.Thread(target=capture_loop, daemon=True)
    capture_thread.start()

# ------------------------------------------------------------
# Routes
# ------------------------------------------------------------
@app.route('/set_camera', methods=['POST'])
def set_camera():
    """Select a specific webcam index"""
    global selected_camera
    idx = request.form.get('camera_index')
    if idx is not None:
        selected_camera = int(idx)
    print(f"[INFO] Switching camera to index {selected_camera}")
    stop_capture_thread()
    start_capture_thread()
    return "OK", 200

@app.route('/capture', methods=['POST'])
def capture():
    global mode, captured_image, captured_filename, latest_frame

    stop_capture_thread()
    try:
        host_filepath, frame = safe_capture_one()

        # Keep bytes and filename for /download
        _, buffer = cv2.imencode('.jpg', frame)
        captured_image = buffer.tobytes()
        captured_filename = host_filepath

        # Update latest_frame for MJPEG stream
        with lock:
            latest_frame = captured_image

        mode = "captured"
        rel_url = f"/{os.path.join(SAVE_DIR, os.path.basename(host_filepath))}"
        return jsonify({"url": rel_url}), 200

    except Exception as e:
        print(f"[ERROR] capture failed: {e}")
        return f"Capture failed: {e}", 500
    finally:
        start_capture_thread()

@app.route('/confirm', methods=['POST'])
def confirm():
    """User confirms captured photo, return to live mode"""
    global mode, captured_image, captured_filename, latest_frame
    captured_image = None
    captured_filename = None
    mode = "live"

    stop_capture_thread()
    with lock:
        latest_frame = None
    start_capture_thread()

    ts = int(time.time() * 1000)
    return jsonify({"video": f"/video_feed?ts={ts}"}), 200

@app.route('/return_live', methods=['POST'])
def return_live():
    global mode, captured_image, captured_filename, latest_frame
    captured_image = None
    captured_filename = None
    mode = "live"
    stop_capture_thread()
    with lock:
        latest_frame = None
    start_capture_thread()
    return "Live", 200

@app.route('/video_feed')
def video_feed():
    resp = Response(generate_frames(), mimetype='multipart/x-mixed-replace; boundary=frame')
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

# ------------------------------------------------------------
# Graceful shutdown
# ------------------------------------------------------------
def cleanup(sig, frame):
    print("\n[INFO] Shutting down server...")
    stop_capture_thread()
    sys.exit(0)

signal.signal(signal.SIGINT, cleanup)
signal.signal(signal.SIGTERM, cleanup)

# ------------------------------------------------------------
# Main
# ------------------------------------------------------------
if __name__ == '__main__':
    start_capture_thread()
    app.run(host='0.0.0.0', port=8080, debug=True, use_reloader=False)

