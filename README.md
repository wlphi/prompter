# Voice-Activated Teleprompter

Offline teleprompter with voice tracking. Uses [Vosk](https://alphacephei.com/vosk/) for speech recognition - no data leaves your server.

## Quick Start

```bash
git clone <repo> /opt/teleprompter
cd /opt/teleprompter
./deploy.sh
```

Put it behind a reverse proxy with SSL, then open in browser.

## How It Works

1. Browser captures your mic audio
2. Audio streams to server via WebSocket
3. Vosk recognizes speech offline
4. Words highlight as you speak

## Cross-Device

Edit on desktop, present from mobile:

1. Click **Save** → get a 5-character code + QR
2. On mobile: enter code or scan QR
3. Script loads with all settings

No accounts needed. Scripts stored server-side.

## Script Syntax

Regular text is matched by voice. Two special markers:

```
And that's why [change slide] we need this.
```
`[brackets]` = stage directions, shown but not matched

```
{Key points to cover:
- Started in 2020
- Team of 3}
```
`{braces}` = talking points, click to advance

## Manual Setup

```bash
cd /opt/teleprompter/backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Get a model from https://alphacephei.com/vosk/models
mkdir -p models && cd models
wget https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip
unzip vosk-model-small-en-us-0.15.zip

# Run
cd .. && uvicorn main:app --host 0.0.0.0 --port 8000
```

## Reverse Proxy

Needs WebSocket support. For Caddy:
```
teleprompter.example.com {
    reverse_proxy localhost:8000
}
```

## Troubleshooting

**Mic not working?** Must use HTTPS. Check browser permissions.

**Test page:** `/static/test.html` shows mic levels and device info.

## License

MIT
