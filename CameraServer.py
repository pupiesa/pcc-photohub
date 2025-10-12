#!/usr/bin/env python3
# serverV11.py — DSLR/Mirrorless control on Raspberry Pi (Flask + gphoto2)
# - สตรีม Live preview (MJPEG) แบบจำกัด FPS และส่งเฉพาะ "เฟรมใหม่"
# - Autofocus best-effort ก่อนถ่าย/เข้า live
# - รองรับกล้อง Canon / Nikon (Z & DSLR) / Sony / Fujifilm / อื่นๆ ผ่าน libgphoto2
# - Brand tweaks (เปิดได้ด้วย ENV) เพื่อความเข้ากันได้สูงขึ้น
# - Background Cleaner: ลบไฟล์เก่ากว่า N ชั่วโมง + guard MAX_FILES / MAX_DISK_MB
# - Optimization:
#     * Exponential backoff + jitter ตอน reconnect กล้อง
#     * CORS preflight cache (ลด preflight จาก UI)
#     * Heartbeat ในสตรีม MJPEG กัน proxy ตัด connection
#     * ตัวเลือก tmpfs (RAM) เขียนไฟล์ชั่วคราวก่อนย้ายลง SAVE_DIR
#     * จำกัดจำนวน viewers พร้อมกันได้ (MAX_VIEWERS)
#
# API: /video_feed /capture /confirm /return_live /cameras /set_camera
#      /api/health /api/diag /api/config /api/set_fps /api/cleanup/now
#      /stop_stream /stop
#
# แนะนำรันด้วย gunicorn:
#   pip install gunicorn
#   gunicorn serverV11:app -k gthread --threads 8 -w 1 -b 0.0.0.0:8080 --timeout 0

import os, sys, time, signal, threading, mimetypes, random
from datetime import datetime
import gphoto2 as gp
from flask import Flask, Response, request, send_file, send_from_directory, jsonify
from flask_cors import CORS
import atexit

# ===================== ENV =====================
FRONTEND_ORIGIN = os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:3000")
CAMERA_PORT_ENV = (os.getenv("CAMERA_PORT") or "").strip() or None
def _clamp_fps(x):
    try: return max(1.0, min(60.0, float(x)))
    except: return 60.0
preview_fps = _clamp_fps(os.getenv("PREVIEW_FPS", 60))

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SAVE_DIR = (os.getenv("CAPTURE_SAVE_DIR") or "").strip() or os.path.join(BASE_DIR, "captured_images")
os.makedirs(SAVE_DIR, exist_ok=True)

TMP_SAVE_DIR = (os.getenv("TMP_SAVE_DIR") or "").strip()
if TMP_SAVE_DIR: os.makedirs(TMP_SAVE_DIR, exist_ok=True)

RETENTION_HOURS = float(os.getenv("RETENTION_HOURS", "24") or 24)
CLEANUP_EVERY_MINUTES = float(os.getenv("CLEANUP_EVERY_MINUTES", "15") or 15)
MAX_FILES = int(os.getenv("MAX_FILES", "0") or 0)
MAX_DISK_MB = int(os.getenv("MAX_DISK_MB", "0") or 0)
TRY_BRAND_TWEAKS = (os.getenv("TRY_BRAND_TWEAKS", "1") == "1")
MAX_VIEWERS = int(os.getenv("MAX_VIEWERS", "8") or 8)

# Fast-capture tuning
CAPTURE_AF_MODE = (os.getenv("CAPTURE_AF_MODE", "halfpress") or "halfpress").lower() # halfpress|drive|off
CAPTURE_AF_MS = int(os.getenv("CAPTURE_AF_MS", "250") or 250)        # 0..2000
CAPTURE_PREFLIGHT_MS = int(os.getenv("CAPTURE_PREFLIGHT_MS", "60") or 60)  # 0..500
CAPTURE_TIMEOUT_S = float(os.getenv("CAPTURE_TIMEOUT_S", "6") or 6)  # server wait per request

# backoff
RECONNECT_MIN_S = 0.5
RECONNECT_MAX_S = 5.0
_reconnect_delay = RECONNECT_MIN_S
def _reset_backoff():
    global _reconnect_delay; _reconnect_delay = RECONNECT_MIN_S
def _next_backoff():
    global _reconnect_delay; _reconnect_delay=min(RECONNECT_MAX_S,_reconnect_delay*1.8);return _reconnect_delay+random.uniform(0,0.3)

# ===================== APP =====================
app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": FRONTEND_ORIGIN}}, supports_credentials=True, max_age=86400)

selected_port = CAMERA_PORT_ENV
latest_frame = None
latest_frame_ver = 0
latest_frame_ts = 0.0
mode = "live"
running = False
lock = threading.Lock()
capture_thread = None
supports_preview = None
viewers = 0
last_error = None

cleanup_thread = None
cleanup_running = True

# Fast-capture coordination
capture_req_event = threading.Event()
capture_done_event = threading.Event()
capture_inflight_lock = threading.Lock()
capture_result = {"ok": False, "error": "idle", "filepath": None, "mime": None}

# ===================== Utils =====================
EXT_MAP = {
    'image/jpeg': '.jpg', 'image/heif': '.heif', 'image/heic': '.heic',
    'image/x-canon-cr2': '.cr2', 'image/x-canon-cr3': '.cr3',
    'image/x-nikon-nef': '.nef', 'image/tiff': '.tif',
}
PREVIEW_BOUNDARY = b'--frame\r\n'

def _nocache_headers(resp):
    resp.headers["Cache-Control"]="no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"]="no-cache"; resp.headers["Expires"]="0"; return resp

def _choose_ext(mime, fallback):
    ext = EXT_MAP.get(mime) or mimetypes.guess_extension(mime or '') or os.path.splitext(fallback)[1] or '.bin'; return ext

def _set_latest_frame(data: bytes):
    global latest_frame, latest_frame_ver, latest_frame_ts
    with lock:
        latest_frame = data; latest_frame_ver += 1; latest_frame_ts = time.monotonic()

def _list_dir_sorted(path):
    try:
        fs=[os.path.join(path,p) for p in os.listdir(path) if os.path.isfile(os.path.join(path,p))]
        fs.sort(key=lambda p: os.path.getmtime(p)); return fs
    except: return []

def _dir_size_mb(path):
    tot=0
    for root,_,files in os.walk(path):
        for f in files:
            try: tot += os.path.getsize(os.path.join(root,f))
            except: pass
    return tot/(1024*1024.0)

# ===================== Camera helpers =====================
def list_cameras():
    try: return gp.Camera.autodetect() or []
    except gp.GPhoto2Error as e: print(f"[ERROR] autodetect: {e}"); return []

def _set_port(cam, camera_port):
    pil=gp.PortInfoList(); pil.load(); idx=pil.lookup_path(camera_port)
    if idx < 0: raise gp.GPhoto2Error(gp.GP_ERROR_BAD_PARAMETERS)
    cam.set_port_info(pil[idx])

def _cfg(cam):
    try: return cam.get_config()
    except gp.GPhoto2Error: return None

def _find_child(cfg, names):
    if not cfg: return None, None
    for n in names:
        try:
            node=cfg.get_child_by_name(n)
            if node: return cfg, node
        except gp.GPhoto2Error: pass
    return cfg, None

def _set_value(cam, cfg, node, value):
    try: node.set_value(value); cam.set_config(cfg); return True
    except gp.GPhoto2Error as e: print(f"[WARN] set_value({value}) on {node.get_name() if node else '?'}: {e}"); return False

def _brand_string(cam):
    try: s=str(cam.get_summary()); return (s.splitlines()[0] if s else "")
    except: return ""

def try_enable_liveview(cam):
    cfg=_cfg(cam); 
    if not cfg: return False
    enabled=False
    for key in ['viewfinder','liveview','eosviewfinder','movie','uilock']:
        cfg,node=_find_child(cfg,[key])
        if node and node.get_type() in (gp.GP_WIDGET_TOGGLE, gp.GP_WIDGET_RADIO):
            val=1 if node.get_type()==gp.GP_WIDGET_TOGGLE else None
            if val is None:
                for i in range(node.count_choices()):
                    c=node.get_choice(i).lower()
                    if any(k in c for k in ['on','live','enable','movie','viewfinder']): val=node.get_choice(i); break
            if val is not None and _set_value(cam,cfg,node,val): enabled=True
    cfg=_cfg(cam)
    if cfg:
        cfg,node=_find_child(cfg,['capturetarget'])
        if node and node.get_type()==gp.GP_WIDGET_RADIO:
            try: _set_value(cam,cfg,node,node.get_value())
            except: pass
    return enabled

def _check_preview_support(cam):
    try: cam.capture_preview(); return True
    except gp.GPhoto2Error as e: print(f"[WARN] capture_preview: {e}"); return False

def check_supports_af(cam):
    cfg=_cfg(cam); 
    if not cfg: return False
    for key in (['autofocusdrive','autofocus','triggerfocus'], ['eosremoterelease'], ['manualfocusdrive']):
        _,node=_find_child(cfg,key)
        if node: return True
    return False

def try_autofocus_quick(cam):
    if CAPTURE_AF_MODE == "off": return False
    cfg=_cfg(cam); 
    if not cfg: return False
    ok=False
    if CAPTURE_AF_MODE == "halfpress":
        cfg,node=_find_child(cfg,['eosremoterelease'])
        if node and node.get_type()==gp.GP_WIDGET_RADIO:
            half=release=None
            for i in range(node.count_choices()):
                c=node.get_choice(i).lower()
                if 'press half' in c or 'half' in c: half=node.get_choice(i)
                if 'release' in c: release=node.get_choice(i)
            if half:
                ok |= _set_value(cam,cfg,node,half)
                if CAPTURE_AF_MS>0: time.sleep(min(CAPTURE_AF_MS/1000.0,2.0))
                if release: _set_value(cam,cfg,node,release)
    elif CAPTURE_AF_MODE == "drive":
        cfg,node=_find_child(cfg,['autofocusdrive','autofocus','triggerfocus'])
        if node:
            val=1 if node.get_type()==gp.GP_WIDGET_TOGGLE else 'On'
            ok |= _set_value(cam,cfg,node,val)
            if CAPTURE_AF_MS>0: time.sleep(min(CAPTURE_AF_MS/1000.0,2.0))
    return ok

def try_set_image_jpeg(cam):
    try:
        cfg=cam.get_config()
        for key in ('imageformat','imagequality'):
            try: node=cfg.get_child_by_name(key)
            except gp.GPhoto2Error: node=None
            if not node: continue
            for i in range(node.count_choices()):
                c=node.get_choice(i).lower()
                if 'jpeg' in c or 'jpg' in c or 'fine' in c:
                    node.set_value(node.get_choice(i)); cam.set_config(cfg)
                    print(f"[INFO] Set {key} to {node.get_value()}"); return
    except gp.GPhoto2Error as e:
        print(f"[WARN] set JPEG failed: {e}")

def try_brand_tweaks(cam):
    if not TRY_BRAND_TWEAKS: return
    head=_brand_string(cam).lower(); cfg=_cfg(cam)
    if not cfg: return
    if 'sony' in head or 'fujifilm' in head or 'finepix' in head or 'x-' in head or 'canon' in head or 'eos' in head or 'nikon' in head:
        try_enable_liveview(cam)
    if 'sony' in head:
        for key in ('focusmode','focus-mode','afmode'):
            c2,node=_find_child(cfg,[key])
            if node and node.get_type() in (gp.GP_WIDGET_RADIO,gp.GP_WIDGET_MENU):
                val=node.get_value()
                for i in range(node.count_choices()):
                    if 'af-s' in node.get_choice(i).lower() or 'single' in node.get_choice(i).lower():
                        val=node.get_choice(i); break
                _set_value(cam,c2,node,val)
    if 'fujifilm' in head or 'finepix' in head or 'x-' in head:
        c2,node=_find_child(cfg,['capturetarget'])
        if node and node.get_type()==gp.GP_WIDGET_RADIO: _set_value(cam,c2,node,node.get_value())
    if 'nikon' in head:
        c2,node=_find_child(cfg,['capturetarget'])
        if node and node.get_type()==gp.GP_WIDGET_RADIO: _set_value(cam,c2,node,node.get_value())

def _safe_save_camera_file(camera_file, filepath: str):
    if TMP_SAVE_DIR:
        tmp=os.path.join(TMP_SAVE_DIR, os.path.basename(filepath)+".part")
        camera_file.save(tmp)
        if filepath.lower().endswith('.jpg'):
            with open(tmp,'rb') as f:
                if f.read(2)!=b'\xff\xd8': raise ValueError("Not JPEG")
        os.replace(tmp, filepath)
    else:
        camera_file.save(filepath)
        if filepath.lower().endswith('.jpg'):
            with open(filepath,'rb') as f:
                if f.read(2)!=b'\xff\xd8': raise ValueError("Not JPEG")

def _update_latest_with_camera_preview(cam, cam_folder, cam_name):
    try:
        thumb=cam.file_get(cam_folder, cam_name, gp.GP_FILE_TYPE_PREVIEW)
        data=gp.check_result(gp.gp_file_get_data_and_size(thumb))
        b=memoryview(data).tobytes()
        if b[:2]==b'\xff\xd8': _set_latest_frame(b); return True
    except gp.GPhoto2Error: pass
    return False

def _capture_once_on_cam(cam):
    file_path = cam.capture(gp.GP_CAPTURE_IMAGE)  # fast; no re-init
    cam_folder, cam_name = file_path.folder, file_path.name
    camera_file = cam.file_get(cam_folder, cam_name, gp.GP_FILE_TYPE_NORMAL)
    mime = camera_file.get_mime_type()
    ext = _choose_ext(mime, cam_name)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    host_filename = f"capture_{ts}{ext}"
    host_filepath = os.path.join(SAVE_DIR, host_filename)
    _safe_save_camera_file(camera_file, host_filepath)
    try: cam.file_delete(cam_folder, cam_name)
    except gp.GPhoto2Error: pass
    return host_filepath, mime, cam_folder, cam_name

# ===================== Background cleanup =====================
def _remove_path(p):
    try: os.remove(p); print(f"[CLEANUP] removed {os.path.basename(p)}"); return True
    except Exception as e: print(f"[CLEANUP] remove failed {p}: {e}"); return False

def _enforce_caps(files):
    removed=0
    if MAX_FILES and len(files)>MAX_FILES:
        for p in files[:len(files)-MAX_FILES]:
            if _remove_path(p): removed+=1
        files=_list_dir_sorted(SAVE_DIR)
    if MAX_DISK_MB:
        while _dir_size_mb(SAVE_DIR)>MAX_DISK_MB:
            files=_list_dir_sorted(SAVE_DIR)
            if not files: break
            if _remove_path(files[0]): removed+=1
            else: break
    return removed

def cleanup_once():
    now=time.time(); horizon=now-(RETENTION_HOURS*3600.0)
    files=_list_dir_sorted(SAVE_DIR); removed=0
    for p in files:
        try:
            if os.path.getmtime(p)<horizon:
                if _remove_path(p): removed+=1
        except: pass
    files=_list_dir_sorted(SAVE_DIR); removed+=_enforce_caps(files); return removed

def cleanup_loop():
    global cleanup_running
    interval=max(1.0,CLEANUP_EVERY_MINUTES)*60.0
    print(f"[CLEANUP] loop started: every {CLEANUP_EVERY_MINUTES} min, retention {RETENTION_HOURS} h")
    while cleanup_running:
        try:
            r=cleanup_once()
            if r: print(f"[CLEANUP] removed {r} files")
        except Exception as e:
            print(f"[CLEANUP] error: {e}")
        for _ in range(int(interval//1)):
            if not cleanup_running: break
            time.sleep(1.0)
    print("[CLEANUP] loop stopped")

# ===================== Live preview + FAST capture (single-thread camera) =====================
def connect_camera(camera_port=None):
    global last_error, selected_port
    last_error=None
    cam=gp.Camera()
    detected=list_cameras()
    if not detected:
        last_error="No camera detected"; print(f"[ERROR] {last_error}"); return None
    port_to_use=camera_port or detected[0][1]
    try:
        _set_port(cam,port_to_use)
        os.system(f"sudo umount /dev/bus/usb/{port_to_use.replace('usb:','')} 2>/dev/null")
        time.sleep(0.3)
        cam.init()
        try_set_image_jpeg(cam)
        try_enable_liveview(cam)
        try_brand_tweaks(cam)
        selected_port=port_to_use
        try: print(f"[INFO] Connected at {port_to_use}:\n{str(cam.get_summary())}")
        except gp.GPhoto2Error: print(f"[INFO] Connected at {port_to_use} (no summary)")
        return cam
    except gp.GPhoto2Error as e:
        # try others
        if e.code==gp.GP_ERROR_FILE_NOT_FOUND:
            for _,port in detected:
                if port==port_to_use: continue
                try:
                    _set_port(cam,port); time.sleep(0.5); cam.init()
                    try_set_image_jpeg(cam); try_enable_liveview(cam); try_brand_tweaks(cam)
                    selected_port=port; print(f"[INFO] Connected at {port}"); return cam
                except gp.GPhoto2Error as e2:
                    print(f"[ERROR] connect {port}: {e2}")
        last_error=f"Camera init failed on {port_to_use}: {e}"; print(f"[ERROR] {last_error}")
        try: cam.exit()
        except: pass
        return None

def generate_frames():
    global preview_fps, latest_frame_ver
    def send_interval(): return 1.0/max(1.0,float(preview_fps))
    next_send=time.monotonic()
    last_sent_ver=-1
    last_flush=time.monotonic()
    while True:
        now=time.monotonic()
        if now<next_send:
            time.sleep(min(0.005,next_send-now)); continue
        with lock:
            frame=latest_frame; ver=latest_frame_ver
        if frame and ver!=last_sent_ver:
            headers=b'Content-Type: image/jpeg\r\nContent-Length: '+str(len(frame)).encode('ascii')+b'\r\n\r\n'
            yield PREVIEW_BOUNDARY+headers+frame+b'\r\n'
            last_sent_ver=ver; next_send=time.monotonic()+send_interval(); last_flush=now
        else:
            if now-last_flush>10.0: # heartbeat
                yield PREVIEW_BOUNDARY+b'Content-Type: text/plain\r\nContent-Length: 1\r\n\r\n.\r\n'
                last_flush=now
            time.sleep(0.01)

def capture_loop():
    global latest_frame, mode, running, supports_preview, selected_port, last_error
    cam=connect_camera(selected_port)
    if cam:
        _reset_backoff()
        try_enable_liveview(cam); try_brand_tweaks(cam)
        if supports_preview is None: supports_preview=_check_preview_support(cam)

    def frame_interval(): return 1.0/max(1.0,float(preview_fps))
    next_tick=time.monotonic()+frame_interval()

    while running:
        try:
            if not cam:
                time.sleep(_next_backoff())
                cam=connect_camera(selected_port)
                if cam:
                    _reset_backoff()
                    try_enable_liveview(cam); try_brand_tweaks(cam)
                    if supports_preview is None: supports_preview=_check_preview_support(cam)
                next_tick=time.monotonic()+frame_interval()
                continue

            # ===== Fast capture request path =====
            if capture_req_event.is_set():
                # preflight nudge
                if CAPTURE_PREFLIGHT_MS>0: time.sleep(min(CAPTURE_PREFLIGHT_MS/1000.0, 0.5))
                # quick AF if requested
                try:
                    if CAPTURE_AF_MODE!="off": try_autofocus_quick(cam)
                except Exception as e:
                    print(f"[WARN] quick AF failed: {e}")
                # do capture
                try:
                    host_filepath, mime, cam_folder, cam_name = _capture_once_on_cam(cam)
                    # push latest frame (if jpeg)
                    try:
                        with open(host_filepath,'rb') as f:
                            buf=f.read()
                        if host_filepath.lower().endswith('.jpg') and buf[:2]==b'\xff\xd8':
                            _set_latest_frame(buf)
                        else:
                            _update_latest_with_camera_preview(cam, cam_folder, cam_name)
                    except Exception as e:
                        print(f"[WARN] preview after capture: {e}")
                    with capture_inflight_lock:
                        capture_result.update({"ok": True, "error": None, "filepath": host_filepath, "mime": mime})
                    mode="captured"
                except Exception as e:
                    with capture_inflight_lock:
                        capture_result.update({"ok": False, "error": f"Capture failed: {e}", "filepath": None, "mime": None})
                    print(f"[ERROR] Capture failed: {e}")
                finally:
                    capture_req_event.clear()
                    capture_done_event.set()   # wake API waiter

                # after capture, resume liveview (fast)
                try:
                    try_enable_liveview(cam)
                    supports_preview=_check_preview_support(cam)
                except Exception as e:
                    print(f"[WARN] resume liveview: {e}")
                continue

            # ===== Normal live preview =====
            if mode == "live":
                if supports_preview is False:
                    try_enable_liveview(cam); try_brand_tweaks(cam)
                    supports_preview=_check_preview_support(cam)
                if supports_preview:
                    now=time.monotonic()
                    sleep_for=next_tick-now
                    if sleep_for>0: time.sleep(sleep_for)
                    next_tick += frame_interval()
                    if next_tick < time.monotonic()-frame_interval():
                        next_tick = time.monotonic()+frame_interval()
                    try:
                        camera_file=cam.capture_preview()
                        file_data=gp.check_result(gp.gp_file_get_data_and_size(camera_file))
                        b=memoryview(file_data).tobytes()
                        if b and b[:2]==b'\xff\xd8': _set_latest_frame(b)
                    except gp.GPhoto2Error as e:
                        if e.code==gp.GP_ERROR_IO_USB_CLAIM:
                            print(f"[WARN] USB claim: {e} -> reconnect")
                            try: cam.exit()
                            except gp.GPhoto2Error: pass
                            cam=None; supports_preview=False
                        else:
                            print(f"[WARN] live preview failed: {e}")
                            supports_preview=False
                        time.sleep(0.05)
                else:
                    time.sleep(0.05)
            else:
                time.sleep(0.02)

        except gp.GPhoto2Error as e:
            last_error=f"Camera error, reconnecting: {e}"
            print(f"[WARN] {last_error}")
            try: cam.exit()
            except gp.GPhoto2Error: pass
            cam=None
            time.sleep(_next_backoff())

    try:
        if cam: cam.exit()
    except: pass
    print("[INFO] capture_loop stopped")

def stop_capture_thread():
    global running, capture_thread
    if capture_thread and capture_thread.is_alive():
        running=False; capture_thread.join(timeout=2)
    capture_thread=None

def start_capture_thread():
    global running, capture_thread, supports_preview, mode
    if running: return
    supports_preview=None; mode="live"; running=True
    capture_thread=threading.Thread(target=capture_loop, daemon=True); capture_thread.start()

def has_viewers(): return viewers>0
def ensure_preview_if_needed():
    if has_viewers(): start_capture_thread()
    else: stop_capture_thread()

# ===================== Hotplug monitor =====================
def monitor_cameras():
    last_detected=set()
    while True:
        try:
            current=list_cameras()
            ports={p for (_,p) in current}
            new_ports=ports-last_detected
            removed=last_detected-ports
            if new_ports or removed:
                print(f"[INFO] Camera change: new {new_ports}, removed {removed}")
                for port in new_ports:
                    print(f"[INFO] Probe new camera {port}")
                    temp=connect_camera(port)
                    if temp:
                        try:
                            s=str(temp.get_summary()); model=s.splitlines()[0] if s.splitlines() else "Unknown"
                            print(f"[NEW CAMERA] {model}")
                        except: print("[NEW CAMERA] summary error")
                        slv=try_enable_liveview(temp); try_brand_tweaks(temp)
                        sp=_check_preview_support(temp); saf=check_supports_af(temp)
                        print(f"[NEW CAMERA] liveview={slv} preview={sp} autofocus={saf}")
                        try: temp.exit()
                        except: pass
                    global selected_port
                    if not selected_port and current: selected_port=port; print(f"[INFO] Auto-select port {selected_port}")
            last_detected=ports
        except Exception as e:
            print(f"[WARN] hotplug monitor: {e}")
        time.sleep(5.0)

# ===================== Routes =====================
@app.route('/')
def root(): return "OK",200

@app.route('/api/health')
def api_health():
    return jsonify({
        "ok":True,"running":running,"viewers":viewers,"mode":mode,
        "selected_port":selected_port,"supports_preview":supports_preview,
        "last_error":last_error,"preview_fps":preview_fps,
        "save_dir":SAVE_DIR,"tmp_save_dir":TMP_SAVE_DIR or None,
        "retention_hours":RETENTION_HOURS,"cleanup_every_minutes":CLEANUP_EVERY_MINUTES,
        "max_files":MAX_FILES,"max_disk_mb":MAX_DISK_MB,"max_viewers":MAX_VIEWERS,
        "fast_capture":{"af_mode":CAPTURE_AF_MODE,"af_ms":CAPTURE_AF_MS,"preflight_ms":CAPTURE_PREFLIGHT_MS}
    }),200

@app.route('/api/config')
def api_config():
    return jsonify({
        "FRONTEND_ORIGIN":FRONTEND_ORIGIN,"CAMERA_PORT":CAMERA_PORT_ENV,
        "PREVIEW_FPS":preview_fps,"CAPTURE_SAVE_DIR":SAVE_DIR,"TMP_SAVE_DIR":TMP_SAVE_DIR or None,
        "RETENTION_HOURS":RETENTION_HOURS,"CLEANUP_EVERY_MINUTES":CLEANUP_EVERY_MINUTES,
        "MAX_FILES":MAX_FILES,"MAX_DISK_MB":MAX_DISK_MB,"MAX_VIEWERS":MAX_VIEWERS,
        "TRY_BRAND_TWEAKS":TRY_BRAND_TWEAKS,"CAPTURE_AF_MODE":CAPTURE_AF_MODE,
        "CAPTURE_AF_MS":CAPTURE_AF_MS,"CAPTURE_PREFLIGHT_MS":CAPTURE_PREFLIGHT_MS
    }),200

@app.route('/api/set_fps', methods=['POST'])
def api_set_fps():
    global preview_fps
    fps = request.values.get('fps') or (request.json.get('fps') if request.is_json else None)
    if not fps: return jsonify({"ok":False,"error":"fps required"}),400
    old=preview_fps; preview_fps=_clamp_fps(fps)
    return jsonify({"ok":True,"preview_fps":preview_fps,"old":old}),200

@app.route('/api/cleanup/now', methods=['POST'])
def api_cleanup_now(): return jsonify({"ok":True,"removed":cleanup_once()}),200

@app.route('/cameras')
def cameras():
    cams=list_cameras()
    return jsonify({"cameras":[{"model":m,"port":p} for (m,p) in cams], "selected_port":selected_port})

@app.route('/set_camera', methods=['GET','POST'])
def set_camera():
    global selected_port, supports_preview, mode
    port=(request.values.get('camera_port') or "").strip()
    if not port: return "camera_port required",400
    selected_port=port; print(f"[INFO] switch camera -> {selected_port}")
    supports_preview=None; mode="live"
    # ไม่ stop thread; ให้ loop re-connect ตาม backoff
    return jsonify({"ok":True,"selected_port":selected_port})

@app.route('/capture', methods=['POST'])
def capture():
    # คิวเดี่ยว: ถ้ายังมีงานค้าง ไม่รับซ้ำ
    if capture_req_event.is_set():
        return jsonify({"ok":False,"error":"capture busy"}),409

    # ตั้งค่า/เคลียร์ผลลัพธ์
    with capture_inflight_lock:
        capture_result.update({"ok":False,"error":"pending","filepath":None,"mime":None})
    capture_done_event.clear()
    capture_req_event.set()   # ส่งสัญญาณไปให้ capture_loop ทำทันที

    # รอผล (เร็วมากถ้ากล้องพร้อม)
    if not capture_done_event.wait(timeout=CAPTURE_TIMEOUT_S):
        capture_req_event.clear()
        with capture_inflight_lock:
            capture_result.update({"ok":False,"error":"capture timeout","filepath":None,"mime":None})
        return jsonify({"ok":False,"error":"timeout"}),504

    with capture_inflight_lock:
        res=dict(capture_result)
    if not res["ok"]:
        return jsonify({"ok":False,"error":res.get("error") or "capture failed"}),500

    host_filepath=res["filepath"]; mime=res["mime"]
    rel_url=f"/captured_images/{os.path.basename(host_filepath)}"
    return jsonify({"ok":True,"url":rel_url,"serverPath":host_filepath}),200

@app.route('/confirm', methods=['POST'])
def confirm():
    global mode, latest_frame
    mode="live"
    with lock:
        latest_frame = None
    return jsonify({"video":f"/video_feed?ts={int(time.time()*1000)}"}),200

@app.route('/return_live', methods=['POST'])
def return_live():
    global mode, latest_frame
    mode = "live"
    with lock:
        latest_frame = None
    return "Live",200

@app.route('/video_feed')
def video_feed():
    global viewers
    if viewers>=MAX_VIEWERS: return jsonify({"ok":False,"error":"too many viewers"}),429
    viewers+=1; ensure_preview_if_needed()
    def stream():
        global viewers
        try:
            for chunk in generate_frames(): yield chunk
        finally:
            viewers=max(0,viewers-1); ensure_preview_if_needed()
    resp=Response(stream(), mimetype='multipart/x-mixed-replace; boundary=frame')
    resp.headers["X-Accel-Buffering"]="no"; return _nocache_headers(resp)

@app.route('/captured_images/<path:filename>')
def serve_captured_image(filename):
    resp=send_from_directory(SAVE_DIR, filename); return _nocache_headers(resp)

@app.route('/download')
def download_image():
    return "Use /captured_images/<file>", 410

@app.route('/stop_stream', methods=['POST'])
@app.route('/stop', methods=['POST'])
def stop_stream():
    global mode, latest_frame
    with lock:
        latest_frame = None
    return jsonify({"ok":True,"stopped":True}),200

# ===================== Boot / Shutdown =====================
def cleanup(sig, frame):
    global cleanup_running
    print("\n[INFO] Shutting down...")
    cleanup_running=False
    stop_capture_thread()
    sys.exit(0)

signal.signal(signal.SIGINT, cleanup)
signal.signal(signal.SIGTERM, cleanup)

def _graceful_stop():
    global cleanup_running
    print("\n[INFO] Shutting down (graceful)...")
    cleanup_running = False
    stop_capture_thread()
    # เธรด monitor/cleanup เป็น daemon=True จะปิดตามโปรเซส

# เรียกตอน interpreter ปิดตัว (รวมถึงกรณี gunicorn สั่งหยุด)
atexit.register(_graceful_stop)

if __name__ == '__main__':
    import signal
    def _signal_cleanup(sig, frame):
        _graceful_stop()
    signal.signal(signal.SIGINT, _signal_cleanup)
    signal.signal(signal.SIGTERM, _signal_cleanup)

    print(f"[BOOT] FRONTEND_ORIGIN={FRONTEND_ORIGIN}")
    print(f"[BOOT] CAMERA_PORT={CAMERA_PORT_ENV}")
    print(f"[BOOT] Save dir: {SAVE_DIR} (tmp: {TMP_SAVE_DIR or '-'})")
    print(f"[BOOT] Preview FPS: {preview_fps}")
    print(f"[BOOT] Fast capture: mode={CAPTURE_AF_MODE}, af_ms={CAPTURE_AF_MS}, preflight_ms={CAPTURE_PREFLIGHT_MS}")
    print(f"[BOOT] Detected cameras: {list_cameras()}")

    # start background threads
    monitor_thread = threading.Thread(target=monitor_cameras, daemon=True); monitor_thread.start()
    cleanup_thread = threading.Thread(target=cleanup_loop, daemon=True); cleanup_thread.start()

    app.run(host='0.0.0.0', port=int(os.getenv("SetCamera_PORT", "8080")), debug=False, use_reloader=False)
# ===================== End =====================