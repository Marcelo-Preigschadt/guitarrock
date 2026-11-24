import hashlib
import importlib.util
import os
import re
import shutil
from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from . import config, db
from .diagnostics import summarize_failure

@asynccontextmanager
async def lifespan(_app):
    db.init()
    yield

app = FastAPI(title="RiffSync API", version="0.2.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=config.ORIGINS, allow_methods=["GET", "POST", "DELETE"], allow_headers=["Content-Type", "X-Workspace-Key"])

def owner(x_workspace_key: str = Header(default="")):
    if not re.fullmatch(r"[a-zA-Z0-9_-]{32,160}", x_workspace_key):
        raise HTTPException(401, "Identificador de sessão ausente ou inválido.")
    return hashlib.sha256(x_workspace_key.encode()).hexdigest()

def owned(job_id, key):
    if not re.fullmatch(r"[a-f0-9]{32}", job_id):
        raise HTTPException(404, "Tarefa não encontrada.")
    job = db.get(job_id, key)
    if not job:
        raise HTTPException(404, "Tarefa não encontrada.")
    return job

@app.get("/api/health")
def health():
    return {"status": "ok", "worker_online": db.worker_online(),
            "separation_available": bool(importlib.util.find_spec("demucs")) and bool(shutil.which("ffmpeg")),
            "transcription_available": bool(importlib.util.find_spec("basic_pitch")), "device": config.DEVICE}

@app.post("/api/jobs", status_code=202)
async def create_job(file: UploadFile = File(...), model: str = Form("htdemucs_6s"), transcribe: bool = Form(True), key=Depends(owner)):
    if model not in config.MODELS:
        raise HTTPException(422, "Modelo de separação inválido.")
    if not db.worker_online() or not importlib.util.find_spec("demucs"):
        raise HTTPException(503, "O servidor de separação não está disponível. Conecte um servidor com o worker ativo.")
    extension = Path(file.filename or "").suffix.lower()
    if extension not in {".mp3", ".wav", ".flac", ".ogg", ".m4a", ".aac"}:
        raise HTTPException(415, "Envie MP3, WAV, FLAC, OGG, M4A ou AAC.")
    try:
        job = db.create(key, Path(file.filename or "audio").name[:180], model, transcribe)
    except ValueError as error:
        raise HTTPException(429, str(error)) from error
    directory = config.DATA / job["id"]
    directory.mkdir()
    # A job is claimable only once its upload is atomically renamed into place.
    target = directory / "upload.part"
    size = 0
    try:
        with target.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > config.MAX_UPLOAD:
                    raise HTTPException(413, f"O arquivo excede {config.MAX_UPLOAD // 1024 // 1024} MB.")
                output.write(chunk)
        if not size:
            raise HTTPException(422, "O arquivo está vazio.")
        target.rename(directory / f"input{extension}")
        db.update(job["id"], status="queued", stage="Na fila de processamento")
    except BaseException:
        db.update(job["id"], status="cancelled", stage="Upload interrompido")
        shutil.rmtree(directory, ignore_errors=True)
        raise
    finally:
        await file.close()
    return db.public(db.get(job["id"]))

@app.get("/api/jobs/{job_id}")
def get_job(job_id: str, key=Depends(owner)):
    job = owned(job_id, key)
    # Existing failed tasks gain diagnostics without uploading the song again.
    if job["status"] == "failed" and not job.get("error_details"):
        logs = sorted((config.DATA / job_id).glob("*.log"), key=lambda p: p.stat().st_mtime, reverse=True)
        if logs:
            with logs[0].open("rb") as stream:
                stream.seek(max(0, logs[0].stat().st_size - 16000))
                detail = stream.read().decode("utf-8", errors="replace")
            code, error, excerpt = summarize_failure("indisponível", detail)
            job.update(error=error, error_code=code, error_details=excerpt)
    return db.public(job)

@app.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: str, key=Depends(owner)):
    job = owned(job_id, key)
    if job["status"] not in db.TERMINAL:
        job = db.update(job_id, status="cancelled", stage="Cancelado pelo usuário")
    return db.public(job)

@app.delete("/api/jobs/{job_id}", status_code=204)
def delete_job(job_id: str, key=Depends(owner)):
    job = owned(job_id, key)
    if job["status"] not in db.TERMINAL:
        raise HTTPException(409, "Cancele a tarefa antes de removê-la.")
    if job["status"] == "cancelled":
        raise HTTPException(409, "O worker ainda pode estar encerrando a tarefa. A limpeza automática removerá os arquivos.")
    shutil.rmtree(config.DATA / job_id, ignore_errors=True)
    with db.connect() as c:
        c.execute("DELETE FROM jobs WHERE id=? AND owner=?", (job_id, key))

@app.get("/api/jobs/{job_id}/files/{filename}")
def get_file(job_id: str, filename: str, key=Depends(owner)):
    job = owned(job_id, key)
    if job["status"] != "completed":
        raise HTTPException(409, "O processamento ainda não foi concluído.")
    allowed = {track["file"] for track in job["result"]["tracks"]}
    if filename not in allowed or Path(filename).name != filename:
        raise HTTPException(404, "Arquivo não encontrado.")
    path = config.DATA / job_id / "output" / filename
    if not path.is_file():
        raise HTTPException(404, "Arquivo removido ou indisponível.")
    return FileResponse(path, media_type="audio/wav", filename=filename)

dist = Path(os.environ.get("FRONTEND_DIST", str(Path.cwd() / "frontend" / "dist")))
if dist.is_dir():
    app.mount("/", StaticFiles(directory=dist, html=True), name="studio")
