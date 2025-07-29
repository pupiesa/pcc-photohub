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
            
            # Configure camera for high-resolution capture
            try:
                config = camera.get_config()
                print("Attempting to configure camera settings...")
                
                # List all available config options
                def print_config_tree(config, indent=0):
                    for i in range(config.count_children()):
                        child = config.get_child(i)
                        name = child.get_name()
                        try:
                            if child.get_type() == gp.GP_WIDGET_MENU:
                                current = child.get_value()
                                choices = [child.get_choice(j) for j in range(child.count_choices())]
                                print(f"{'  ' * indent}{name}: {current} (options: {choices})")
                            elif child.get_type() == gp.GP_WIDGET_TEXT:
                                print(f"{'  ' * indent}{name}: {child.get_value()}")
                        except:
                            pass
                        if child.count_children() > 0:
                            print_config_tree(child, indent + 1)
                
                print_config_tree(config)
                
                # Try various common setting names for image quality/size
                quality_names = ['imagequality', 'quality', 'jpegquality', 'imageformat']
                size_names = ['imagesize', 'capturesize', 'resolution']
                
                config_changed = False
                
                # First, try to set image quality to JPEG Fine (not RAW)
                for quality_name in quality_names:
                    try:
                        quality_widget = config.get_child_by_name(quality_name)
                        choices = [quality_widget.get_choice(i) for i in range(quality_widget.count_choices())]
                        print(f"Found {quality_name} with options: {choices}")
                        
                        # Prefer JPEG Fine over RAW for web display
                        jpeg_quality_options = ['JPEG Fine', 'Fine', 'JPEG Normal', 'Normal', 'NEF+Fine']
                        for option in jpeg_quality_options:
                            if option in choices:
                                quality_widget.set_value(option)
                                print(f"Set {quality_name} to {option}")
                                config_changed = True
                                break
                        break
                    except:
                        continue
                
                # Then set image size to largest
                for size_name in size_names:
                    try:
                        size_widget = config.get_child_by_name(size_name)
                        choices = [size_widget.get_choice(i) for i in range(size_widget.count_choices())]
                        print(f"Found {size_name} with options: {choices}")
                        
                        # Set to 6000x4000 (largest available)
                        large_size_options = ['6000x4000', 'Large', 'L', '4496x3000']
                        for option in large_size_options:
                            if option in choices:
                                size_widget.set_value(option)
                                print(f"Set {size_name} to {option}")
                                config_changed = True
                                break
                        break
                    except:
                        continue
                
                if config_changed:
                    camera.set_config(config)
                    print("Camera configuration updated")
                else:
                    print("Could not find or set quality/size settings")
                    
            except Exception as config_error:
                print(f"Camera configuration error: {config_error}")
            
            print("Capturing full resolution image...")
            file_path = camera.capture(gp.GP_CAPTURE_IMAGE)
            print(f"Image captured: {file_path.folder}/{file_path.name}")
            
            # Get the camera file (full resolution)
            camera_file = camera.file_get(file_path.folder, file_path.name, gp.GP_FILE_TYPE_NORMAL)
            
            # Get file data
            file_data = camera_file.get_data_and_size()
            print(f"File data size: {len(file_data)} bytes")
            
            # Check if it's a NEF file and handle accordingly
            if file_path.name.lower().endswith('.nef'):
                print("NEF file detected - extracting embedded JPEG")
                try:
                    # Try to get the embedded JPEG from NEF file
                    camera_file_jpeg = camera.file_get(file_path.folder, file_path.name, gp.GP_FILE_TYPE_PREVIEW)
                    file_data = camera_file_jpeg.get_data_and_size()
                    print(f"Extracted JPEG preview size: {len(file_data)} bytes")
                except:
                    print("Could not extract JPEG preview, using full NEF data")
            
            # Convert to PIL Image to handle different formats
            image_data = io.BytesIO(file_data)
            
            try:
                img = Image.open(image_data)
                print(f"Original image size: {img.size}, mode: {img.mode}")
            except Exception as img_error:
                print(f"PIL could not open image: {img_error}")
                # If PIL fails, save the raw file data directly
                timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
                filename = f'photo_{timestamp}.jpg'
                target = os.path.join(IMAGE_DIR, filename)
                os.makedirs(IMAGE_DIR, exist_ok=True)
                
                with open(target, 'wb') as f:
                    f.write(file_data)
                print(f"Saved raw file data to: {target}")
                
                return jsonify({
                    'status': 'success', 
                    'path': target,
                    'filename': filename
                })
            
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

@app.route('/camera-info', methods=['GET'])
def camera_info():
    """Get camera configuration information"""
    camera = None
    try:
        camera = gp.Camera()
        camera.init()
        
        config = camera.get_config()
        
        # Get available settings
        settings = {}
        
        try:
            # Get image quality options
            quality_widget = config.get_child_by_name('imagequality')
            settings['image_quality'] = {
                'current': quality_widget.get_value(),
                'choices': [quality_widget.get_choice(i) for i in range(quality_widget.count_choices())]
            }
        except:
            settings['image_quality'] = 'Not available'
            
        try:
            # Get image size options  
            size_widget = config.get_child_by_name('imagesize')
            settings['image_size'] = {
                'current': size_widget.get_value(),
                'choices': [size_widget.get_choice(i) for i in range(size_widget.count_choices())]
            }
        except:
            settings['image_size'] = 'Not available'
            
        return jsonify({
            'status': 'success',
            'settings': settings
        })
        
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500
    finally:
        if camera:
            try:
                camera.exit()
            except:
                pass

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