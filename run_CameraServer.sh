#!/usr/bin/env bash
# run_CameraServer.sh — run CameraServer.py with python3 (default) or gunicorn via .env
# Env:
#   CAMERA_RUN_MODE=python|gunicorn   (default: python)
#   PORT=8080                         (พอร์ตของ API; ใช้ได้เมื่อ CAMERA_RUN_MODE=gunicorn หรือเมื่อแก้ CameraServer.py ให้รับ $PORT)
#   APT_AUTO=1                        (ติดตั้งแพ็กเกจอัตโนมัติถ้าจำเป็น)

set -Eeuo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
cd "$HERE"

# ---------- CONFIG ----------
PORT="${PORT:-8080}"
VENV_DIR=".venv_camera"
APT_AUTO="${APT_AUTO:-1}"
RUN_MODE="${CAMERA_RUN_MODE:-python}"   # python (default) | gunicorn
# ----------------------------

# 0) ตรวจไฟล์หลัก
if [[ ! -f "CameraServer.py" ]]; then
  echo "[CAM][ERROR] ไม่พบ CameraServer.py ในโฟลเดอร์นี้: $HERE"
  exit 1
fi

# 1) helpers
has_cmd(){ command -v "$1" &>/dev/null; }
apt_install(){
  if [[ "$APT_AUTO" == "1" ]]; then
    echo "[CAM] Installing apt packages: $*"
    sudo apt-get update -y
    sudo apt-get install -y "$@"
  else
    echo "[CAM][WARN] Missing packages: $*  (ตั้ง APT_AUTO=1 เพื่อให้ติดตั้งอัตโนมัติ)"
  fi
}

# 2) system deps
has_cmd python3 || apt_install python3 python3-venv python3-pip
has_cmd pip3     || apt_install python3-pip
has_cmd gphoto2  || apt_install gphoto2
dpkg -s libgphoto2-6    &>/dev/null || apt_install libgphoto2-6
dpkg -s libgphoto2-dev  &>/dev/null || apt_install libgphoto2-dev
dpkg -s build-essential &>/dev/null || apt_install build-essential

# 3) ปิดตัวแย่งกล้อง (ถ้ามี)
echo "[CAM] Killing gvfs gphoto daemons (if any)…"
killall -q gvfs-gphoto2-volume-monitor 2>/dev/null || true
killall -q gvfsd-gphoto2 2>/dev/null || true
killall -q gvfs-gphoto2 2>/dev/null || true

# 4) เตรียม venv
if [[ ! -d "$VENV_DIR" ]]; then
  echo "[CAM] Creating venv: $VENV_DIR"
  python3 -m venv "$VENV_DIR"
fi
# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"
python -m pip install --upgrade pip wheel setuptools

# 5) ติดตั้ง requirements (ถ้ามี)
REQ_FILE=""
if   [[ -f "requirements.camera.txt" ]]; then REQ_FILE="requirements.camera.txt"
elif [[ -f "requirements.txt"       ]]; then REQ_FILE="requirements.txt"
else
  REQ_FILE="requirements.camera.txt"
  cat > "$REQ_FILE" <<'EOF'
Flask==3.1.2
flask-cors==6.0.1
Werkzeug==3.1.3
Jinja2==3.1.6
MarkupSafe==3.0.2
itsdangerous==2.2.0
blinker==1.9.0
click==8.2.1
gphoto2==2.6.2
opencv-python==4.12.0.88
pillow==11.3.0
numpy==2.2.6
imageio==2.37.0
python-dotenv==1.1.1
# optional WSGI
gunicorn==23.0.0
EOF
  echo "[CAM] Created $REQ_FILE (พื้นฐาน)"
fi
echo "[CAM] Installing python requirements from $REQ_FILE ..."
python -m pip install -r "$REQ_FILE"

GUNICORN_BIN="$HERE/$VENV_DIR/bin/gunicorn"
if [[ "$RUN_MODE" == "gunicorn" && ! -x "$GUNICORN_BIN" ]]; then
  echo "[CAM] gunicorn not found in venv → installing…"
  python -m pip install gunicorn==23.0.0
fi

cleanup(){
  echo; echo "[CAM] Stopping CameraServer…"
  pkill -f "gunicorn .*CameraServer:app" 2>/dev/null || true
  pkill -f "python .*CameraServer.py" 2>/dev/null || true
  deactivate 2>/dev/null || true
}
trap cleanup INT TERM EXIT

export PYTHONUNBUFFERED=1

if [[ "$RUN_MODE" == "gunicorn" ]]; then
  echo "[CAM] RUN_MODE=gunicorn → starting at 0.0.0.0:${PORT}"
  exec "$GUNICORN_BIN" "CameraServer:app" \
    -k gthread --threads 8 -w 1 \
    -b "0.0.0.0:${PORT}" \
    --timeout 0 \
    --graceful-timeout 10 \
    --chdir "$HERE"
else
  echo "[CAM] RUN_MODE=python → starting python3 CameraServer.py"
  exec python "CameraServer.py"
fi
