#!/usr/bin/env python3
# -*- coding: utf-8 -*-
# CameraServer.py
import os, cv2, glob, stat, time, atexit, signal, threading
import numpy as np
from datetime import datetime
from typing import Optional, List
from flask import Flask, Response, jsonify, request, stream_with_context, make_response, send_from_directory

# ---------- .env (CORS) ----------
try:
    from dotenv import load_dotenv
    load_dotenv(override=True)
except Exception:
    pass

def _parse_origins(val: Optional[str]) -> List[str]:
    if not val: return []
    return [o.strip().rstrip("/") for o in val.split(",") if o.strip()]

CORS_ALLOW_ORIGINS = _parse_origins(os.environ.get("CORS_ALLOW_ORIGINS")) or [
    "http://localhost:3000","http://127.0.0.1:3000",
    "http://localhost:5173","http://127.0.0.1:5173",
]

# ---------- Config ----------
HOST, PORT, DEBUG = "0.0.0.0", 8080, False
JPEG_QUALITY = 80
UVC_W, UVC_H, UVC_FPS = 1280, 720, 60.0
GPHOTO_FPS = 60.0
WATCH_INTERVAL = 1.0
FRAME_TIMEOUT_S = 1.0
FIRST_FRAME_DEADLINE_MS = 300

# ---------- App / State ----------
app = Flask(__name__)

# shared preview buffer
buf_lock = threading.Lock()
latest_jpeg: Optional[bytes] = None
latest_ver = 0

frame_event = threading.Event()

# capture anti-double
capture_lock = threading.Lock()
last_capture_id = 0
last_captured_path = None

# control flags
pause_live = False
viewers = 0

ENGINE_UVC, ENGINE_GPHOTO = "uvc", "gphoto"
current_engine = None

# ---- UVC live thread
uvc_thread = None
uvc_running = False

# ---- gphoto live thread + single-owner camera
gphoto_thread = None
gphoto_running = False
gphoto_selected_port: Optional[str] = None
gphoto_last_error: Optional[str] = None
gphoto_cam = None                 # live thread owns camera
gphoto_cam_lock = threading.RLock()

# probe state (only by watcher/boot)
last_probe = {"engine": None, "ok": False, "why": "not-probed", "details": {}, "time": None}

# watcher (hot-plug)
watcher_thread = None
watcher_running = False
_last_seen_uvc = set()
_last_seen_gphoto_ports = set()
starting_live = threading.Event()

SAVE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "captured_images"))
os.makedirs(SAVE_DIR, exist_ok=True)



# ---------- Utils ----------
DELETE_RECENT_AFTER_UPLOAD = (os.environ.get("DELETE_RECENT_AFTER_UPLOAD", "false").lower() in ("1","true","yes"))
try:
    DELETE_RECENT_COUNT = max(1, int(os.environ.get("DELETE_RECENT_COUNT","2")))
except Exception:
    DELETE_RECENT_COUNT = 2

def _list_captured_sorted():
    """Return list of absolute file paths in SAVE_DIR sorted by mtime desc (newest first)."""
    files = []
    try:
        for p in sorted(glob.glob(os.path.join(SAVE_DIR, "*")), key=lambda x: os.path.getmtime(x), reverse=True):
            if os.path.isfile(p):
                files.append(p)
    except Exception:
        pass
    return files

def _safe_delete(paths):
    """Delete files only if they are inside SAVE_DIR."""
    deleted, failed = [], []
    for p in paths:
        try:
            ap = os.path.abspath(p)
            if not ap.startswith(SAVE_DIR + os.sep):
                failed.append({"path": p, "error": "outside-save-dir"})
                continue
            if os.path.exists(ap):
                os.remove(ap)
                deleted.append(ap)
            else:
                failed.append({"path": p, "error": "not-found"})
        except Exception as e:
            failed.append({"path": p, "error": str(e)})
    return deleted, failed

def log(msg: str): print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)

def _nocache(resp):
    resp.headers["Cache-Control"]="no-store, no-cache, must-revalidate, max-age=0"
    resp.headers["Pragma"]="no-cache"; resp.headers["Expires"]="0"
    return resp

def _apply_cors(resp):
    origin = request.headers.get("Origin","").rstrip("/")
    if origin and origin in CORS_ALLOW_ORIGINS:
        resp.headers["Access-Control-Allow-Origin"]=origin
        resp.headers["Vary"]="Origin"
        resp.headers["Access-Control-Allow-Credentials"]="true"
        resp.headers["Access-Control-Allow-Headers"]="Content-Type, Authorization, X-Requested-With"
        resp.headers["Access-Control-Allow-Methods"]="GET, POST, OPTIONS"
    return resp

@app.after_request
def _after(resp): return _apply_cors(_nocache(resp))

@app.route("/", methods=["GET","OPTIONS"])
def root():
    if request.method=="OPTIONS": return _apply_cors(make_response(("",204)))
    return jsonify({"ok":True,"service":"CameraServer","time":datetime.now().isoformat()}),200

def _enc(frame):
    ok, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY])
    return buf.tobytes() if ok else None

def _black_jpeg(width=640, height=480):
    try:
        img = np.zeros((height, width, 3), dtype=np.uint8)
        ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
        return buf.tobytes() if ok else None
    except Exception:
        return None

def _black_frame_jpeg(width=640, height=480):
    return _black_jpeg(width, height)

def _set_latest(b: bytes):
    global latest_jpeg, latest_ver
    with buf_lock:
        latest_jpeg = b; latest_ver += 1
    try: frame_event.set()
    except Exception: pass

def _free_usb_claimers(port_hint=""):
    os.system("pkill -9 -f gvfs-gphoto2-volume-monitor 2>/dev/null")
    os.system("pkill -9 -f gphoto2 2>/dev/null")
    os.system("pkill -9 -f kdeconnectd 2>/dev/null")
    if port_hint.startswith("usb:") and "," in port_hint:
        bus, dev = port_hint.replace("usb:","").split(",",1)
        os.system(f"sudo umount /dev/bus/usb/{bus}/{dev} 2>/dev/null || true")

# ---------- UVC: cold-probe + live ----------
def _list_v4l2(): 
    out=[]
    for d in sorted(glob.glob("/dev/video*")):
        try:
            if stat.S_ISCHR(os.stat(d).st_mode): out.append(d)
        except Exception: pass
    return out

def _first_uvc_idx():
    for d in _list_v4l2():
        try: idx=int(d.replace("/dev/video",""))
        except: continue
        cap=cv2.VideoCapture(idx)
        ok=bool(cap and cap.isOpened())
        try: cap.release()
        except: pass
        if ok: return idx
    return None

def _cold_probe_uvc():
    idx=_first_uvc_idx()
    if idx is None: return False,"no-uvc-device",{}
    cap=cv2.VideoCapture(idx)
    if not cap or not cap.isOpened(): return False,"open-failed",{"index":idx}
    cap.set(cv2.CAP_PROP_FRAME_WIDTH,UVC_W); cap.set(cv2.CAP_PROP_FRAME_HEIGHT,UVC_H)
    try: cap.set(cv2.CAP_PROP_FPS,UVC_FPS)
    except: pass
    ret,frame=cap.read()
    actual=(int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),float(cap.get(cv2.CAP_PROP_FPS) or 0.0))
    try: cap.release()
    except: pass
    if not ret or frame is None: return False,"no-frame",{"index":idx,"actual":{"w":actual[0],"h":actual[1],"fps":actual[2]}}
    b=_enc(frame); 
    if b: _set_latest(b)
    return True,"ok",{"index":idx,"actual":{"w":actual[0],"h":actual[1],"fps":actual[2]}}

def _open_uvc_from_caps(caps):
    idx=caps.get("index"); 
    if idx is None: return None
    cap=cv2.VideoCapture(idx)
    if not cap or not cap.isOpened(): return None
    if "actual" in caps:
        cap.set(cv2.CAP_PROP_FRAME_WIDTH,caps["actual"]["w"])
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT,caps["actual"]["h"])
        try: cap.set(cv2.CAP_PROP_FPS,caps["actual"]["fps"])
        except: pass
    return cap

def uvc_worker():
    global uvc_running
    log("[UVC] live started")
    caps=last_probe.get("details",{})
    cap=_open_uvc_from_caps(caps)
    if not cap:
        log("[UVC] live open failed from last caps"); uvc_running=False; return
    interval=1.0/max(1.0,float(UVC_FPS)); nxt=time.time()
    while uvc_running:
        if pause_live: time.sleep(0.02); continue
        ret,frame=cap.read()
        if not ret or frame is None:
            time.sleep(0.02); continue
        b=_enc(frame); 
        if b: _set_latest(b)
        nxt+=interval; d=nxt-time.time()
        if d>0: time.sleep(d)
        else: nxt=time.time()
    try: cap.release()
    except: pass
    log("[UVC] live stopped")

def start_uvc_live():
    global uvc_thread, uvc_running
    if uvc_thread and uvc_thread.is_alive(): return
    starting_live.set()
    uvc_running=True
    uvc_thread=threading.Thread(target=uvc_worker,daemon=True); uvc_thread.start()
    threading.Timer(1.0, starting_live.clear).start()

def stop_uvc_live():
    global uvc_thread, uvc_running
    if uvc_thread and uvc_thread.is_alive():
        uvc_running=False
        try: uvc_thread.join(timeout=2)
        except: pass
    uvc_thread=None

# ---------- gphoto: cold-probe + single-owner live/capture ----------
try:
    import gphoto2 as gp
except Exception:
    gp=None

def _gphoto_list():
    if not gp: return []
    try: return gp.Camera.autodetect() or []
    except Exception as e:
        log(f"[GPHOTO] autodetect failed: {e}"); return []

def _gphoto_set_port(cam, port):
    pil=gp.PortInfoList(); pil.load()
    idx=pil.lookup_path(port)
    if idx<0: raise gp.GPhoto2Error(gp.GP_ERROR_BAD_PARAMETERS)
    cam.set_port_info(pil[idx])

def _cold_probe_gphoto():
    cams=_gphoto_list()
    if not cams: return False,"No DSLR detected",{}
    port=gphoto_selected_port if gphoto_selected_port and any(p==gphoto_selected_port for _,p in cams) else cams[0][1]
    cam=gp.Camera()
    try:
        _free_usb_claimers(port)
        _gphoto_set_port(cam,port); time.sleep(0.2); cam.init()
        try:
            cf=cam.capture_preview()
            data=gp.check_result(gp.gp_file_get_data_and_size(cf))
            b=memoryview(data).tobytes()
        except Exception as e:
            try: cam.exit()
            except: pass
            return False,f"no-preview:{e}",{"port":port}
        try: cam.exit()
        except: pass
        if b and b[:2]==b'\xff\xd8': _set_latest(b)
        else: return False,"not-jpeg",{"port":port}
        return True,"ok",{"port":port}
    except gp.GPhoto2Error as e:
        try: cam.exit()
        except: pass
        return False,f"init failed: {e}",{"port":port}

def _detect_engine() -> str:
    return ENGINE_GPHOTO if (gp and _gphoto_list()) else ENGINE_UVC

def _gphoto_set_liveview(cam, enabled: bool):
    try:
        cfg = cam.get_config()
        for key in ['viewfinder','liveview','eosviewfinder','movie']:
            try:
                node = cfg.get_child_by_name(key)
                if not node: continue
                if node.get_type() == gp.GP_WIDGET_TOGGLE:
                    node.set_value(1 if enabled else 0)
                    cam.set_config(cfg)
                    return True
                elif node.get_type() == gp.GP_WIDGET_RADIO and node.count_choices():
                    choice = node.get_choice(0 if enabled else min(1, node.count_choices()-1))
                    node.set_value(choice); cam.set_config(cfg); return True
            except Exception:
                pass
    except Exception:
        pass
    return False

def gphoto_worker():
    global gphoto_running, gphoto_cam, gphoto_last_error
    log("[GPHOTO] live started")
    cams=_gphoto_list()
    if not cams:
        gphoto_last_error="no dslr"; gphoto_running=False; return
    port=gphoto_selected_port if gphoto_selected_port and any(p==gphoto_selected_port for _,p in cams) else cams[0][1]
    try:
        cam=gp.Camera()
        _free_usb_claimers(port)
        _gphoto_set_port(cam,port); time.sleep(0.2); cam.init()
        # enable liveview only for live usage
        try:
            _gphoto_set_liveview(cam, True)
        except Exception: pass
        with gphoto_cam_lock:
            gphoto_cam=cam
        frame_interval=1.0/max(1.0,float(GPHOTO_FPS)); nxt=time.monotonic()+frame_interval
        while gphoto_running:
            if pause_live:
                time.sleep(0.02); continue
            now=time.monotonic()
            if now<nxt:
                time.sleep(min(0.008,nxt-now)); continue
            nxt=now+frame_interval
            try:
                with gphoto_cam_lock:
                    if gphoto_cam is None: break
                    cf=gphoto_cam.capture_preview()
                    data=gp.check_result(gp.gp_file_get_data_and_size(cf))
                b=memoryview(data).tobytes()
                if b and b[:2]==b'\xff\xd8': _set_latest(b)
            except Exception as e:
                gphoto_last_error=f"preview: {e}"
                time.sleep(0.05)
    except gp.GPhoto2Error as e:
        gphoto_last_error=f"init: {e}"
    finally:
        with gphoto_cam_lock:
            try:
                if gphoto_cam: gphoto_cam.exit()
            except Exception: pass
            gphoto_cam=None
        log("[GPHOTO] live stopped")
        gphoto_running=False

def start_gphoto_live():
    global gphoto_thread, gphoto_running
    if not gp: return
    if gphoto_thread and gphoto_thread.is_alive(): return
    starting_live.set()
    gphoto_running=True
    gphoto_thread=threading.Thread(target=gphoto_worker,daemon=True); gphoto_thread.start()
    threading.Timer(1.0, starting_live.clear).start()

def stop_gphoto_live():
    global gphoto_thread, gphoto_running
    if gphoto_thread and gphoto_thread.is_alive():
        gphoto_running=False
        try: gphoto_thread.join(timeout=2)
        except: pass
    gphoto_thread=None

# ---------- Watcher: boot/hot-plug probe only ----------
def _snapshot_uvc(): return set(_list_v4l2())
def _snapshot_gphoto(): 
    cams=_gphoto_list() if gp else []
    return set([p for _,p in cams])

def _perform_cold_probe_and_record():
    global last_probe, current_engine
    eng=_detect_engine()
    if eng==ENGINE_GPHOTO and gp:
        ok,why,det=_cold_probe_gphoto()
    else:
        ok,why,det=_cold_probe_uvc()
    last_probe={"engine":eng,"ok":ok,"why":why,"details":det,"time":datetime.now().isoformat()}
    current_engine=eng
    log(f"[PROBE] {eng} ok={ok} why={why}")

def watcher_loop():
    global watcher_running,_last_seen_uvc,_last_seen_gphoto_ports
    log("[WATCHER] started")
    _last_seen_uvc=_snapshot_uvc(); _last_seen_gphoto_ports=_snapshot_gphoto()
    _perform_cold_probe_and_record()
    while watcher_running:
        try:
            if starting_live.is_set(): time.sleep(0.25); continue
            a=_snapshot_uvc(); b=_snapshot_gphoto()
            if a!=_last_seen_uvc or b!=_last_seen_gphoto_ports:
                _last_seen_uvc=a; _last_seen_gphoto_ports=b
                _perform_cold_probe_and_record()
                if viewers>0 and not pause_live:
                    if current_engine==ENGINE_GPHOTO: stop_uvc_live(); start_gphoto_live()
                    else: stop_gphoto_live(); start_uvc_live()
        except Exception as e:
            log(f"[WATCHER] error: {e}")
        time.sleep(WATCH_INTERVAL)
    log("[WATCHER] stopped")

def start_watcher():
    global watcher_thread, watcher_running
    if watcher_thread and watcher_thread.is_alive(): return
    watcher_running=True
    watcher_thread=threading.Thread(target=watcher_loop,daemon=True); watcher_thread.start()

def stop_watcher():
    global watcher_thread, watcher_running
    if watcher_thread and watcher_thread.is_alive():
        watcher_running=False
        try: watcher_thread.join(timeout=2)
        except: pass
    watcher_thread=None

# ---------- API: health/devices ----------
@app.route("/api/health")
def api_health():
    return jsonify({
        "ok": True,
        "paused": bool(pause_live),
        "running": bool((uvc_thread and uvc_thread.is_alive()) or (gphoto_thread and gphoto_thread.is_alive())),
        "engine": current_engine,
        "last_probe": last_probe,
        "uvc_devices": list(_list_v4l2()),
        "dslr_supported": bool(gp is not None),
        "dslr_error": gphoto_last_error,
        "viewers": viewers,
        "time": datetime.now().isoformat(),
    }), 200

@app.route("/api/devices")
def api_devices():
    cams=_gphoto_list() if gp else []
    return jsonify({
        "uvc_devices": list(_list_v4l2()),
        "gphoto_detected":[{"model":m,"port":p} for (m,p) in cams],
        "selected_port": gphoto_selected_port,
        "engine_now": current_engine,
        "last_probe": last_probe,
        "time": datetime.now().isoformat()
    }),200

# ---------- API: control ----------
@app.route("/pause", methods=["POST"])
def pause():
    global pause_live
    pause_live=True
    return jsonify({"ok":True,"paused":True}),200

@app.route("/resume", methods=["POST"])
def resume():
    global pause_live
    pause_live=False
    return jsonify({"ok":True,"resumed":True}),200

@app.route("/stop_stream", methods=["POST"])
@app.route("/stop", methods=["POST"])
def stop_stream():
    global pause_live
    pause_live=True
    stop_gphoto_live(); stop_uvc_live()
    return jsonify({"ok":True,"stopped":True,"paused":True}),200

@app.route("/confirm", methods=["POST"])
def confirm():
    global pause_live
    pause_live=False
    return jsonify({"ok":True}),200

# ---------- API: set camera / reset ----------
@app.route("/cameras")
def cameras():
    cams=_gphoto_list() if gp else []
    return jsonify({"cameras":[{"model":m,"port":p} for (m,p) in cams],
                    "selected_port": gphoto_selected_port}),200

@app.route("/set_camera", methods=["POST","GET"])
def set_camera():
    global gphoto_selected_port
    port=request.values.get('camera_port') or (request.get_json(silent=True) or {}).get('camera_port')
    if not port: return jsonify({"ok":False,"error":"camera_port required"}),400
    gphoto_selected_port=str(port).strip()
    _perform_cold_probe_and_record()
    return jsonify({"ok":True,"selected_port":gphoto_selected_port}),200

@app.route("/reset_camera", methods=["POST"])
def reset_camera():
    _free_usb_claimers(gphoto_selected_port or "")
    _perform_cold_probe_and_record()
    return jsonify({"ok":True,"reset":True}),200

# ---------- Helper: ensure first frame ASAP ----------
def _ensure_first_frame_ready(deadline_ms=FIRST_FRAME_DEADLINE_MS):
    t0 = time.time()
    # already have frame?
    with buf_lock:
        if latest_jpeg:
            return True
    # wait a bit for live thread to deliver a frame
    while (time.time() - t0) * 1000 < deadline_ms:
        with buf_lock:
            if latest_jpeg:
                return True
        time.sleep(0.01)
    # still empty -> try open-once fast path
    if current_engine == ENGINE_UVC or not gp:
        ok, _, _ = _cold_probe_uvc()
        return ok
    else:
        # DSLR: if live cam exists, ask one preview frame quickly
        if gphoto_cam is not None:
            try:
                with gphoto_cam_lock:
                    cf = gphoto_cam.capture_preview()
                    import gphoto2 as gp2
                    data = gp2.check_result(gp2.gp_file_get_data_and_size(cf))
                b = memoryview(data).tobytes()
                if b and b[:2] == b'\xff\xd8':
                    _set_latest(b)
                    return True
            except Exception:
                pass
        return False

# ---------- API: capture (anti double + freshest buffer) ----------
@app.route("/capture", methods=["POST"])
def capture():
    global last_capture_id, last_captured_path

    # anti double-capture
    if not capture_lock.acquire(blocking=False):
        return jsonify({"ok": False, "error": "busy: capture in progress"}), 429

    try:
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")

        # DSLR
        if gp and current_engine == ENGINE_GPHOTO:
            with gphoto_cam_lock:
                if gphoto_cam is None:
                    return jsonify({"ok": False, "error": "DSLR not ready"}), 503
                try:
                    # --- ปิด liveview ชั่วคราว เพื่อให้ capture เต็มเซนเซอร์ ---
                    _gphoto_set_liveview(gphoto_cam, False)
                    fp = gphoto_cam.capture(gp.GP_CAPTURE_IMAGE)
                    folder, name = fp.folder, fp.name
                    cf = gphoto_cam.file_get(folder, name, gp.GP_FILE_TYPE_NORMAL)
                    mime = cf.get_mime_type()
                    import mimetypes
                    ext = mimetypes.guess_extension(mime) or ".jpg"
                    out = os.path.join(SAVE_DIR, f"capture_{ts}{ext}")
                    cf.save(out)
                    try: gphoto_cam.file_delete(folder, name)
                    except Exception: pass

                    # --- เปิด liveview กลับ เพื่อให้ preview ทำงานต่อเนื่อง ---
                    _gphoto_set_liveview(gphoto_cam, True)

                    with open(out, "rb") as f:
                        data = f.read()
                    if data[:2] == b'\xff\xd8':
                        _set_latest(data)
                    last_captured_path = out
                    last_capture_id += 1
                    return jsonify({"ok": True, "serverPath": out,
                                    "url": f"/captured_images/{os.path.basename(out)}",
                                    "capture_id": last_capture_id}), 200
                except gp.GPhoto2Error as e:
                    return jsonify({"ok": False, "error": f"capture failed: {e}"}), 500

        # UVC
        with buf_lock:
            data = latest_jpeg
        if not data:
            ok, why, _ = _cold_probe_uvc()
            if not ok:
                return jsonify({"ok": False, "error": f"open-once failed: {why}"}), 503
            with buf_lock:
                data = latest_jpeg
            if not data:
                return jsonify({"ok": False, "error": "no frame"}), 503

        out = os.path.join(SAVE_DIR, f"capture_{ts}.jpg")
        with open(out, "wb") as f:
            f.write(data)

        # refresh buffer from saved file to avoid stale frame
        with open(out, "rb") as f:
            _set_latest(f.read())
        last_captured_path = out
        last_capture_id += 1
        return jsonify({"ok": True, "serverPath": out,
                        "url": f"/captured_images/{os.path.basename(out)}",
                        "capture_id": last_capture_id}), 200

    finally:
        capture_lock.release()

@app.route("/api/delete_recent", methods=["POST"])
def api_delete_recent():
    # guard เปิด/ปิดจาก .env
    if not DELETE_RECENT_AFTER_UPLOAD:
        return jsonify({"ok": False, "error": "disabled-by-config"}), 403

    payload = request.get_json(silent=True) or {}
    # จำนวนรูปที่จะลบ รับจาก body.count หรือ query ?count=
    try:
        count = int(request.args.get("count", payload.get("count", DELETE_RECENT_COUNT)))
        count = max(1, min(count, 20))  # กันค่าเกิน
    except Exception:
        count = DELETE_RECENT_COUNT

    files = _list_captured_sorted()[:count]
    deleted, failed = _safe_delete(files)
    return jsonify({
        "ok": True,
        "requested": count,
        "deleted": deleted,
        "failed": failed,
        "dir": SAVE_DIR,
    }), 200

@app.route('/captured_images/<path:filename>')
def serve_captured_image(filename):
    resp=send_from_directory(SAVE_DIR,filename)
    return _nocache(resp)

# ---------- MJPEG (Fast First Frame + event-driven) ----------
@app.route("/video_feed")
def video_feed():
    """
    Fast first frame: ส่งเฟรมล่าสุดทันที; ถ้าไม่มี พยายามให้ได้ภายใน ~300ms,
    ไม่ได้จริง ๆ ส่ง black frame ให้ขึ้นก่อน แล้วเฟรมจริงตามมา
    """
    global viewers, pause_live
    viewers += 1

    # autoconfirm: ให้ client ปลด pause ได้ตั้งแต่ GET ครั้งแรก
    try:
        ac = request.args.get("autoconfirm", "0").lower()
        if ac in ("1","true","yes"):
            pause_live = False
    except Exception:
        pass

    # start live according to last probe result
    if _detect_engine()==ENGINE_GPHOTO:
        stop_uvc_live(); start_gphoto_live()
    else:
        stop_gphoto_live(); start_uvc_live()

    def generate():
        global viewers
        last_v = -1

        # --- first frame path ---
        with buf_lock:
            frame = latest_jpeg
            v = latest_ver
        if frame is None:
            _ensure_first_frame_ready(FIRST_FRAME_DEADLINE_MS)
            with buf_lock:
                frame = latest_jpeg
                v = latest_ver
        if frame is None:
            # ส่ง black frame fallback ถ้ายังไม่มี
            frame = _black_frame_jpeg()

        yield (b"--frame\r\n"
               b"Content-Type: image/jpeg\r\n\r\n" + frame + b"\r\n")

        # --- streaming loop ---
        while True:
            frame_event.wait(timeout=1.0)
            with buf_lock:
                nf = latest_jpeg
                nv = latest_ver
            if nf is not None and nv != last_v:
                last_v = nv
                yield (b"--frame\r\n"
                       b"Content-Type: image/jpeg\r\n\r\n" + nf + b"\r\n")

    resp = Response(generate(),
                    mimetype="multipart/x-mixed-replace; boundary=frame")
    @resp.call_on_close
    def _dec_view():
        global viewers
        viewers = max(0, viewers-1)
    return resp

# ---------- Lifecycle ----------
def _graceful_shutdown(*args):
    log("[SYS] shutting down ...")
    try: stop_gphoto_live(); stop_uvc_live(); stop_watcher()
    except Exception: pass
    try: cv2.destroyAllWindows()
    except Exception: pass
    os._exit(0)

signal.signal(signal.SIGINT,_graceful_shutdown)
signal.signal(signal.SIGTERM,_graceful_shutdown)
atexit.register(_graceful_shutdown)

# ---------- Main ----------
if __name__=="__main__":
    log(f"[BOOT] CameraServer starting at {HOST}:{PORT}")
    log(f"[BOOT] CORS_ALLOW_ORIGINS={CORS_ALLOW_ORIGINS}")
    # start watcher → cold-probe ครั้งแรก + รอ hot-plug ต่อไป
    def start_watcher():
        global watcher_thread, watcher_running
        if watcher_thread and watcher_thread.is_alive(): return
        watcher_running=True
        watcher_thread=threading.Thread(target=watcher_loop,daemon=True); watcher_thread.start()
    start_watcher()
    app.run(host=HOST, port=PORT, debug=DEBUG, threaded=True)
