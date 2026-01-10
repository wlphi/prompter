# Voice-Activated Teleprompter

Teleprompter with voice tracking for live presentations. Choose between browser-based speech recognition (easy setup) or offline Vosk (privacy-focused).

## Quick Start

**Browser mode (no setup):**
1. Open `frontend/index.html` in Chrome/Edge
2. Paste your script, click Start
3. Speak - words highlight as you read

**Vosk mode (offline/private):**
```bash
./deploy.sh
```
Then access via your server URL.

## Features

**Speech Engines**
- **Browser** - Uses Web Speech API, works in Chrome/Edge, 13+ languages
- **Vosk** - Offline recognition, no data leaves your server
- Unavailable options are automatically disabled

**Pacing Controls**
- Hold `Space` to advance words manually
- Double-tap `Space` to jump to next line
- `Ctrl` to pause/resume
- `↑`/`↓` to adjust speed (CPM-based with punctuation pauses)
- Number keys to jump to quick-nav cue points (auto-pauses)
- Press `?` for keyboard shortcuts

**Dialect Support**
- Match Tolerance slider (50-100%)
- Lower values enable fuzzy matching for dialects (Swiss German, etc.)

**Script Markup**
```
Regular text is matched by voice.

*emphasis* renders yellow/underlined
**strong** renders red/bold (multi-word spans work)

[stage direction] shown but not voice-matched

[1] quick-nav cue point (jump with number keys)
[15] multi-digit quick-nav points work too

{talking points
- click to advance
- bullet list}
```

**Display Options**
- Adjustable font size and scroll position
- Word highlight toggle (red box or subtle underline)
- Horizontal/vertical mirroring
- Settings persist across page reloads

## File Management

- **Open .md** - Load script from markdown file
- **Save .md** - Export script to markdown
- **Save/Load** - Cross-device sync via 5-char code or QR

## Manual Setup (Vosk)

```bash
cd /opt/teleprompter/backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

# Download a model from https://alphacephei.com/vosk/models
mkdir -p models && cd models
wget https://alphacephei.com/vosk/models/vosk-model-small-de-0.15.zip
unzip vosk-model-small-de-0.15.zip

uvicorn main:app --host 0.0.0.0 --port 8000
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` (hold) | Advance words |
| `Space` `Space` | Jump to next line |
| `Ctrl` | Pause / Resume |
| `↑` `↓` | Adjust speed |
| `0-9` | Jump to quick-nav |
| `Esc` | Stop presentation |
| `?` | Show help |

## Troubleshooting

- **Mic not working?** Browser mode needs HTTPS in production. Check permissions.
- **Vosk not connecting?** Ensure backend is running, check WebSocket proxy config.
- **Test page:** `/static/test.html` shows mic levels and device info.

## Reverse Proxy (Vosk mode)

Needs WebSocket support. For Caddy:
```
teleprompter.example.com {
    reverse_proxy localhost:8000
}
```

## License

MIT
