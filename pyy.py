from flask import Flask, Response, request
from picamera2 import Picamera2
import cv2

app = Flask(__name__)

# Setup camera
picam2 = Picamera2()
config = picam2.create_video_configuration(main={"size": (1280, 720)})
picam2.configure(config)
picam2.start()

# Default color conversion (None = no conversion)
COLOR_SPACE = None

# Map query param -> OpenCV conversion code
COLOR_MAP = {
    "bgr": None,  # native OpenCV format
    "rgb": cv2.COLOR_BGR2RGB,
    "hsv": cv2.COLOR_BGR2HSV,
    "gray": cv2.COLOR_BGR2GRAY,
}

def generate_frames():
    while True:
        frame = picam2.capture_array()

        # Apply selected color conversion if any
        if COLOR_SPACE is not None:
            frame = cv2.cvtColor(frame, COLOR_SPACE)

        # Ensure grayscale is converted back to 3-channel for streaming
        if len(frame.shape) == 2:
            frame = cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)

        ret, buffer = cv2.imencode('.jpg', frame)
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')

@app.route('/video')
def video():
    return Response(generate_frames(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/')
def index():
    return """
    <html>
    <head>
        <style>
            body, html {
                margin: 0;
                padding: 0;
                background: black;
                height: 100%;
                overflow: hidden;
            }
            img {
                width: 100vw;
                height: 100vh;
                object-fit: cover;
            }
        </style>
    </head>
    <body>
        <img src="/video" />
    </body>
    </html>
    """

@app.route('/set_color')
def set_color():
    global COLOR_SPACE
    mode = request.args.get("mode", "bgr").lower()
    COLOR_SPACE = COLOR_MAP.get(mode, None)
    return f"Color space set to {mode}"

if __name__ == '__main__':
    app.run(host="0.0.0.0", port=8080)
