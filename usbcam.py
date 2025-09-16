#!/usr/bin/env python3
# webcam_server.py — Webcam control on Raspberry Pi / macOS / Linux (Flask + OpenCV)
# Features:
# - User chooses camera device before starting
# - Live preview via /video_feed (MJPEG, no-cache)
# - Capture single frame via /capture
# - Confirm to return to live via /confirm
# - Serve last captured image via /captured_images/<name> or /download
# Notes:
#   pip install flask flask-cors opencv-python numpy

import os
import sys
import time
import threading
from datetime import datetime

import cv2
import numpy as np
from flask import Flask, Response, request, send_file, send_from_directory, jsonify
from flask_cors import CORS

# ------------------------------------------------------------
# Flask app & CORS
# ------------------------------------------------------------
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "http://127.0.0.1:3000")
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": FRONTEND_ORIGIN}})

SAVE_DIR = "captured_images"
os.makedirs(SAVE_DIR, exist_ok=True)

# ------------------------------------------------------------
# Global state
# ------------------------------------------------------------
selected_device_index = None  # int, OpenCV video device
latest_frame = None           # bytes (JPEG)
captured_image = None         # bytes
captured_filename = None      # str (path)
mode = "live"                 # "live" or "captured"
running = False               # capture thread control
lock = threading.Lock()
capture_thread = None

# ------------------------------------------------------------
# Utilities
# ------------------------------------------------------------
def _nocache_headers(resp):
    resp.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"] = "no-cache"
    resp.headers["Expires"] = "0"
    return resp

def list_cameras(max_index=5):
    """Return list of available camera device indices."""
    available = []
    for i in range(max_index):
        cap = cv2.VideoCapture(i)
        if cap.isOpened():
            available.append(i)
            cap.release()
    return available

def start_capture_thread():
    global running, capture_thread, mode
    running = True
    mode = "live"
    capture_thread = threading.Thread(target=capture_loop, daemon=True)
    capture_thread.start()

def stop_capture_thread():
    global running, capture_thread
    if capture_thread and capture_thread.is_alive():
        running = False
        capture_thread.join(timeout=2)
    capture_thread = None

# ------------------------------------------------------------
# Live capture loop
# ------------------------------------------------------------
def capture_loop():
    global latest_frame, running, selected_device_index, mode
    cap = cv2.VideoCapture(selected_device_index)
    if not cap.isOpened():
        print(f"[ERROR] Cannot open camera {selected_device_index}")
        return

    while running:
        if mode == "live":
            ret, frame = cap.read()
            if ret:
                ret2, buffer = cv2.imencode('.jpg', frame)
                if ret2:
                    with lock:
                        latest_frame = buffer.tobytes()
            else:
                time.sleep(0.05)
        else:
            time.sleep(0.05)

    cap.release()
    print("[INFO] capture_loop stopped")

def generate_frames():
    global latest_frame
    while True:
        with lock:
            frame = latest_frame
        if frame:
            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
        else:
            time.sleep(0.05)

# ------------------------------------------------------------
# Routes
# ------------------------------------------------------------
@app.route('/capture', methods=['POST'])
def capture():
    global captured_image, captured_filename, latest_frame, mode
    stop_capture_thread()
    cap = cv2.VideoCapture(selected_device_index)
    if not cap.isOpened():
        start_capture_thread()
        return "Camera not available", 503

    ret, frame = cap.read()
    cap.release()
    if not ret:
        start_capture_thread()
        return "Capture failed", 500

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    host_filename = f"capture_{ts}.jpg"
    host_filepath = os.path.join(SAVE_DIR, host_filename)
    cv2.imwrite(host_filepath, frame)

    with open(host_filepath, 'rb') as f:
        captured_image = f.read()
    captured_filename = host_filepath

    with lock:
        latest_frame = captured_image

    mode = "captured"
    start_capture_thread()
    return jsonify({"url": f"/{SAVE_DIR}/{host_filename}"}), 200

@app.route('/confirm', methods=['POST'])
def confirm():
    global captured_image, captured_filename, mode, latest_frame
    captured_image = None
    captured_filename = None
    mode = "live"
    stop_capture_thread()
    with lock:
        latest_frame = None
    start_capture_thread()
    ts = int(time.time() * 1000)
    return jsonify({"video": f"/video_feed?ts={ts}"}), 200

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
    
@app.route("/stop_stream", methods=["POST"])
def stop_stream():
    # your stop logic here
    return jsonify({"status": "stopped"})

@app.route("/stop", methods=["POST"])
def stop():
    # optional stop logic
    return jsonify({"status": "stopped"})
    
@app.route('/')
def index():
    return "i am okay"

# ------------------------------------------------------------
# Graceful shutdown
# ------------------------------------------------------------
import signal
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
    print("[INFO] Detecting available cameras...")
    cams = list_cameras(5)
    if not cams:
        print("[ERROR] No camera detected!")
        sys.exit(1)

    print("[INFO] Available cameras:")
    for i, idx in enumerate(cams):
        print(f"  [{i}] Device {idx}")

    choice = input(f"Select camera [0-{len(cams)-1}]: ")
    try:
        choice = int(choice)
        if choice < 0 or choice >= len(cams):
            raise ValueError()
        selected_device_index = cams[choice]
    except ValueError:
        print("[ERROR] Invalid selection")
        sys.exit(1)

    print(f"[INFO] Using camera device {selected_device_index}")
    start_capture_thread()
    app.run(host='0.0.0.0', port=8080, debug=True, use_reloader=False)
