from flask import Flask, Response, jsonify, send_from_directory
import gphoto2 as gp
import time
import os
from datetime import datetime
from PIL import Image
import io
import threading

app = Flask(__name__)

# Global camera state management
camera_lock = threading.Lock()
preview_active = False
preview_thread = None

# Define image storage directory
IMAGE_DIR = '/home/pi4b/Desktop/pcc-photohub/image'

def generate_preview():
    global preview_active
    camera = gp.Camera()
    try:
        camera.init()
        preview_active = True
        while preview_active:
            camera_file = camera.capture_preview()
            file_data = camera_file.get_data_and_size()
            data = memoryview(file_data)

            yield (b'--frame\r\n'
                   b'Content-Type: image/jpeg\r\n\r\n' + data.tobytes() + b'\r\n')
            time.sleep(0.1)
    except Exception as e:
        print(f"Preview error: {e}")
    finally:
        preview_active = False
        try:
            camera.exit()
        except:
            pass

@app.route('/preview', methods=['GET'])
def preview():
    return Response(generate_preview(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')

@app.route('/stop-preview', methods=['POST'])
def stop_preview():
    """Stop the preview stream to free camera for capture"""
    global preview_active
    preview_active = False
    time.sleep(1)  # Wait for preview to stop
    return jsonify({'status': 'preview stopped'})

@app.route('/capture', methods=['GET'])
def capture_image():
    global preview_active
    
    with camera_lock:
        # Stop preview if running
        if preview_active:
            preview_active = False
            time.sleep(2)  # Wait for preview to fully stop
        
        camera = None
        try:
            print("Initializing camera for capture...")
            camera = gp.Camera()
            camera.init()
            
            print("Capturing image...")
            file_path = camera.capture(gp.GP_CAPTURE_IMAGE)
            print(f"Image captured: {file_path.folder}/{file_path.name}")
            
            # Get the camera file
            camera_file = camera.file_get(file_path.folder, file_path.name, gp.GP_FILE_TYPE_NORMAL)
            
            # Get file data
            file_data = camera_file.get_data_and_size()
            
            # Convert to PIL Image to handle different formats
            image_data = io.BytesIO(file_data)
            img = Image.open(image_data)
            
            # timestamp for file name
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            filename = f'photo_{timestamp}.jpg'
            target = os.path.join(IMAGE_DIR, filename)
            
            # Ensure directory exists
            os.makedirs(IMAGE_DIR, exist_ok=True)
            
            # Convert and save as JPEG
            if img.mode in ('RGBA', 'LA', 'P'):
                img = img.convert('RGB')
            
            img.save(target, 'JPEG', quality=95)
            print(f"Image saved to: {target}")
            
            return jsonify({
                'status': 'success', 
                'path': target,
                'filename': filename
            })
            
        except Exception as e:
            print(f"Capture error: {e}")
            return jsonify({'status': 'error', 'message': str(e)}), 500
        finally:
            if camera:
                try:
                    camera.exit()
                except:
                    pass

@app.route('/static/<filename>')
def serve_image(filename):
    try:
        return send_from_directory(IMAGE_DIR, filename)
    except FileNotFoundError:
        return jsonify({'error': 'Image not found'}), 404

@app.route('/status', methods=['GET'])
def camera_status():
    try:
        # Only test if preview is not running
        if not preview_active:
            camera = gp.Camera()
            camera.init()
            camera.exit()
        return jsonify({'status': 'ready'})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)