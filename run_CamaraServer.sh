#!/usr/bin/env bash
# run_CameraServer.sh — one-folder bootstrap & runner for CameraServer.py (Raspberry Pi 5)

set -Eeuo pipefail

# ---------- CONFIG ----------
PORT="${PORT:-8080}"        # พอร์ตของ API (เปลี่ยนตอนรันได้ เช่น: PORT=8081 ./run_CameraServer.sh)
VENV_DIR=".venv_camera"     # venv อยู่ในโฟลเดอร์นี้
APT_AUTO="${APT_AUTO:-1}"   # 1=ติดตั้ง apt อัตโนมัติ (ต้องมี sudo), 0=แค่เตือน
# ----------------------------

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)"
cd "$HERE"

# 0) ตรวจไฟล์สำคัญ
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

# 3) ปิดตัวแย่งกล้อง (ไม่ error ถ้าไม่มี)
echo "[CAM] Killing gvfs gphoto daemons (if any)…"
killall -q gvfs-gphoto2-volume-monitor 2>/dev/null || true
killall -q gvfsd-gphoto2 2>/dev/null || true
killall -q gvfs-gphoto2 2>/dev/null || true

# 4) เตรียม venv ในโฟลเดอร์นี้
if [[ ! -d "$VENV_DIR" ]]; then
  echo "[CAM] Creating venv: $VENV_DIR"
  python3 -m venv "$VENV_DIR"
fi

# ใช้ pip จาก venv เสมอ
# shellcheck disable=SC1091
source "$VENV_DIR/bin/activate"
python -m pip install --upgrade pip wheel setuptools

# 5) เลือกไฟล์ requirements (camera > default > create-basic)
REQ_FILE=""
if   [[ -f "requirements.camera.txt" ]]; then REQ_FILE="requirements.camera.txt"
elif [[ -f "requirements.txt"       ]]; then REQ_FILE="requirements.txt"
else
  REQ_FILE="requirements.camera.txt"
  cat > "$REQ_FILE" <<'EOF'
# --- Core web server ---
Flask==3.1.2
flask-cors==6.0.1
Werkzeug==3.1.3
Jinja2==3.1.6
MarkupSafe==3.0.2
itsdangerous==2.2.0
blinker==1.9.0
click==8.2.1

# --- Camera / Image / Utils ---
gphoto2==2.6.2
opencv-python==4.12.0.88
pillow==11.3.0
numpy==2.2.6
imageio==2.37.0
python-dotenv==1.1.1

# --- WSGI server ---
gunicorn==23.0.0
EOF
  echo "[CAM] Created $REQ_FILE (พื้นฐาน)"
fi

echo "[CAM] Installing python requirements from $REQ_FILE ..."
python -m pip install -r "$REQ_FILE"

# ensure gunicorn exists ใน venv
GUNICORN_BIN="$HERE/$VENV_DIR/bin/gunicorn"
if [[ ! -x "$GUNICORN_BIN" ]]; then
  echo "[CAM] gunicorn not found in venv → installing…"
  python -m pip install gunicorn==23.0.0
fi

# 6) รัน server ด้วย gunicorn (ทำความสะอาดตอนจบ)
cleanup(){
  echo; echo "[CAM] Stopping gunicorn…"
  pkill -f "gunicorn .*CameraServer:app" 2>/dev/null || true
  deactivate 2>/dev/null || true
}
trap cleanup INT TERM EXIT

export PYTHONUNBUFFERED=1

echo "[CAM] Starting gunicorn at 0.0.0.0:${PORT}"
exec "$GUNICORN_BIN" "CameraServer:app" \
  -k gthread --threads 8 -w 1 \
  -b "0.0.0.0:${PORT}" \
  --timeout 0 \
  --graceful-timeout 10 \
  --chdir "$HERE"
