"""
Voice-Activated Teleprompter Server

FastAPI server that:
1. Receives audio from browser microphone via WebSocket
2. Performs offline speech recognition using Vosk
3. Sends recognized text back to the browser
4. Serves the teleprompter frontend
"""

import asyncio
import json
import os
import secrets
import string
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, UploadFile, File
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from vosk import Model, KaldiRecognizer, SetLogLevel
from pptx import Presentation

# Reduce Vosk logging verbosity
SetLogLevel(-1)

# Configuration
MODELS_DIR = Path(__file__).parent / "models"
SCRIPTS_DIR = Path(__file__).parent / "scripts"
FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
SAMPLE_RATE = 16000
CODE_LENGTH = 5
EXPIRE_DAYS = 30

# Ensure scripts directory exists
SCRIPTS_DIR.mkdir(exist_ok=True)

# Cache loaded models
loaded_models: dict[str, Model] = {}


def get_model(model_path: str) -> Model:
    """Get or load a Vosk model."""
    if model_path not in loaded_models:
        loaded_models[model_path] = Model(model_path)
    return loaded_models[model_path]


def get_available_models() -> list[dict]:
    """List available Vosk models in the models directory."""
    models = []
    if MODELS_DIR.exists():
        for model_dir in MODELS_DIR.iterdir():
            if model_dir.is_dir() and (model_dir / "am" / "final.mdl").exists():
                name = model_dir.name
                parts = name.replace("vosk-model-", "").replace("small-", "").replace("big-", "").split("-")
                if len(parts) >= 2:
                    lang_code = f"{parts[0]}-{parts[1]}" if len(parts[1]) == 2 else parts[0]
                else:
                    lang_code = parts[0] if parts else "unknown"
                models.append({
                    "path": str(model_dir),
                    "name": name,
                    "language": lang_code,
                })
    return models


# Script storage
class ScriptData(BaseModel):
    script: str
    language: str = ""
    fontSize: int = 48
    scrollMargin: int = 30


def generate_code() -> str:
    """Generate a random 5-character code."""
    chars = string.ascii_lowercase + string.digits
    while True:
        code = ''.join(secrets.choice(chars) for _ in range(CODE_LENGTH))
        if not (SCRIPTS_DIR / f"{code}.json").exists():
            return code


def save_script(code: str, data: ScriptData) -> None:
    """Save script data to file."""
    now = datetime.utcnow().isoformat() + "Z"
    script_file = SCRIPTS_DIR / f"{code}.json"

    # Preserve created date if updating
    created = now
    if script_file.exists():
        existing = json.loads(script_file.read_text())
        created = existing.get("created", now)

    script_file.write_text(json.dumps({
        "script": data.script,
        "language": data.language,
        "fontSize": data.fontSize,
        "scrollMargin": data.scrollMargin,
        "created": created,
        "accessed": now
    }, indent=2))


def load_script(code: str) -> dict | None:
    """Load script data from file."""
    script_file = SCRIPTS_DIR / f"{code}.json"
    if not script_file.exists():
        return None

    data = json.loads(script_file.read_text())

    # Update access time
    data["accessed"] = datetime.utcnow().isoformat() + "Z"
    script_file.write_text(json.dumps(data, indent=2))

    return data


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan."""
    yield


app = FastAPI(
    title="Voice-Activated Teleprompter",
    description="Offline speech recognition teleprompter",
    lifespan=lifespan
)


@app.get("/api/models")
async def api_get_models():
    """List available speech recognition models."""
    models = get_available_models()
    return {"models": models}


@app.post("/api/scripts")
async def api_save_script(data: ScriptData):
    """Save a script and return the access code."""
    code = generate_code()
    save_script(code, data)
    return {"code": code}


@app.get("/api/scripts/{code}")
async def api_load_script(code: str):
    """Load a script by its code."""
    # Sanitize code
    code = code.lower().strip()[:CODE_LENGTH]
    if not code.isalnum():
        raise HTTPException(status_code=400, detail="Invalid code")

    data = load_script(code)
    if data is None:
        raise HTTPException(status_code=404, detail="Script not found")

    return data


@app.post("/api/import/pptx")
async def api_import_pptx(file: UploadFile = File(...)):
    """Extract speaker notes from a PowerPoint file."""
    if not file.filename.lower().endswith('.pptx'):
        raise HTTPException(status_code=400, detail="Only .pptx files are supported")

    try:
        contents = await file.read()
        from io import BytesIO
        prs = Presentation(BytesIO(contents))

        parts = []
        for i, slide in enumerate(prs.slides):
            # Extract speaker notes
            if slide.has_notes_slide:
                notes_text = slide.notes_slide.notes_text_frame.text.strip()
                if notes_text:
                    parts.append(notes_text)

            # Add slide transition cue (except after last slide)
            if i < len(prs.slides) - 1:
                parts.append("[next slide]")

        script = "\n\n".join(parts)
        return {"script": script, "slideCount": len(prs.slides)}

    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse PPTX: {str(e)}")


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for audio streaming and recognition.

    Protocol:
    - Client sends: {"type": "start", "model": "/path/to/model"}
    - Client sends: binary audio data (16-bit PCM, 16kHz, mono)
    - Client sends: {"type": "stop"}
    - Server sends: {"type": "partial", "text": "...", "words": [...]}
    - Server sends: {"type": "final", "text": "...", "words": [...]}
    """
    await websocket.accept()

    recognizer: KaldiRecognizer | None = None

    try:
        while True:
            message = await websocket.receive()

            if "text" in message:
                # JSON control message
                data = json.loads(message["text"])
                msg_type = data.get("type")

                if msg_type == "start":
                    model_path = data.get("model")
                    if not model_path or not Path(model_path).exists():
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "message": "Invalid model path"
                        }))
                        continue

                    try:
                        model = get_model(model_path)
                        recognizer = KaldiRecognizer(model, SAMPLE_RATE)
                        recognizer.SetWords(True)
                        await websocket.send_text(json.dumps({
                            "type": "ready"
                        }))
                    except Exception as e:
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "message": str(e)
                        }))

                elif msg_type == "stop":
                    if recognizer:
                        # Get final result
                        result = json.loads(recognizer.FinalResult())
                        text = result.get("text", "").strip()
                        if text:
                            await websocket.send_text(json.dumps({
                                "type": "final",
                                "text": text,
                                "words": text.lower().split()
                            }))
                    recognizer = None
                    await websocket.send_text(json.dumps({
                        "type": "stopped"
                    }))

                elif msg_type == "ping":
                    await websocket.send_text(json.dumps({"type": "pong"}))

            elif "bytes" in message:
                # Binary audio data
                if recognizer is None:
                    continue

                audio_data = message["bytes"]

                if recognizer.AcceptWaveform(audio_data):
                    result = json.loads(recognizer.Result())
                    text = result.get("text", "").strip()
                    if text:
                        await websocket.send_text(json.dumps({
                            "type": "final",
                            "text": text,
                            "words": text.lower().split()
                        }))
                else:
                    partial = json.loads(recognizer.PartialResult())
                    text = partial.get("partial", "").strip()
                    if text:
                        await websocket.send_text(json.dumps({
                            "type": "partial",
                            "text": text,
                            "words": text.lower().split()
                        }))

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_text(json.dumps({
                "type": "error",
                "message": str(e)
            }))
        except:
            pass


@app.get("/")
async def serve_index():
    """Serve the main page."""
    index_path = FRONTEND_DIR / "index.html"
    if index_path.exists():
        return FileResponse(index_path)
    return {"error": "Frontend not found"}


# Mount static files (CSS, JS)
if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
