#!/bin/bash
set -e

cd "$(dirname "$0")"

# Install system deps
if command -v apt &>/dev/null; then
    apt update && apt install -y python3-pip python3-venv unzip wget
elif command -v dnf &>/dev/null; then
    dnf install -y python3-pip python3-venv unzip wget
fi

# Python setup
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -q -r requirements.txt

# Download models if not present
mkdir -p models && cd models

if [ ! -d "vosk-model-small-en-us-0.15" ]; then
    echo "Downloading English model..."
    wget -q https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip
    unzip -q vosk-model-small-en-us-0.15.zip && rm vosk-model-small-en-us-0.15.zip
fi

if [ ! -d "vosk-model-small-de-0.15" ]; then
    echo "Downloading German model..."
    wget -q https://alphacephei.com/vosk/models/vosk-model-small-de-0.15.zip
    unzip -q vosk-model-small-de-0.15.zip && rm vosk-model-small-de-0.15.zip
fi

cd ..

# Create systemd service
cat > /etc/systemd/system/teleprompter.service << 'EOF'
[Unit]
Description=Teleprompter
After=network.target

[Service]
WorkingDirectory=/opt/teleprompter/backend
ExecStart=/opt/teleprompter/backend/venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000
Restart=always

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now teleprompter

echo "Done. Access at http://$(hostname -I | awk '{print $1}'):8000"
