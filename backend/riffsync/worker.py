import importlib.util
import json
import logging
import os
import re
import shutil
import signal
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path
from . import config, db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("riffsync")
stop = threading.Event()

class Cancelled(Exception):
    pass

def command(args, job_id, log_path, progress=False):
    started = time.monotonic()
    with log_path.open("wb") as output:
        process = subprocess.Popen(args, stdout=output, stderr=output, start_new_session=True)
        try:
            while process.poll() is None:
                job = db.get(job_id)
                if stop.is_set() or not job or job["status"] == "cancelled":
                    raise Cancelled()
                if time.monotonic() - started > config.JOB_TIMEOUT:
                    raise RuntimeError("O processamento atingiu o limite de tempo do servidor.")
                if progress:
                    with log_path.open("rb") as reader:
                        reader.seek(max(0, log_path.stat().st_size - 4096))
                        percentages = re.findall(rb"(\d{1,3})%\|", reader.read())
                    if percentages:
                        value = min(100, int(percentages[-1]))
                        db.update(job_id, progress=10 + int(value * 0.6), stage="Separando os instrumentos")
                stop.wait(1)
            if process.returncode:
                log.error("Command failed for job %s; see %s", job_id, log_path)
                raise RuntimeError("O processamento de áudio falhou. Verifique o arquivo, os modelos e a memória disponível no servidor.")
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL); process.wait()

def duration(file):
    result = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(file)], capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise RuntimeError("O arquivo não contém um áudio válido ou está corrompido.")
    try:
        value = float(json.loads(result.stdout)["format"]["duration"])
    except (ValueError, KeyError):
        raise RuntimeError("Não foi possível determinar a duração do áudio.")
    if not 0 < value <= config.MAX_DURATION:
        raise RuntimeError(f"Envie uma música com duração de até {config.MAX_DURATION // 60} minutos.")
    return value

def process(job):
    job_id = job["id"]
    directory = config.DATA / job_id
    sources = list(directory.glob("input.*"))
    if not sources:
        raise RuntimeError("O upload do áudio está incompleto.")
    source = sources[0]
    length = duration(source)
    command(["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(source), "-t", str(config.MAX_DURATION), "-ac", "2", "-ar", "44100", str(directory / "source.wav")], job_id, directory / "decode.log")
    db.update(job_id, progress=10, stage="Separando os instrumentos")
    device = config.DEVICE
    if device == "auto":
        import torch
        device = "cuda" if torch.cuda.is_available() else "cpu"
    command([sys.executable, "-m", "demucs", "-n", job["model"], "-d", device, "--shifts", "1", "--overlap", "0.25", "--out", str(directory / "separated"), str(directory / "source.wav")], job_id, directory / "separation.log", progress=True)
    separated = directory / "separated" / job["model"] / "source"
    output = directory / "output"; output.mkdir(exist_ok=True)
    tracks = []
    names = {"vocals": "Voz", "drums": "Bateria", "bass": "Baixo", "guitar": "Guitarra", "piano": "Piano", "other": "Outros"}
    for kind in ("vocals", "drums", "bass", "guitar", "piano", "other"):
        file = separated / f"{kind}.wav"
        if file.is_file():
            shutil.move(str(file), str(output / file.name))
            tracks.append({"id": kind, "kind": kind, "name": names[kind], "file": file.name})
    if len(tracks) < 4:
        raise RuntimeError("O separador não gerou todas as pistas esperadas.")
    transcription = {"bpm": None, "chords": [], "notes": {}, "warnings": []}
    if job["transcribe"]:
        db.update(job_id, progress=75, stage="Estimando cifras e notas dos instrumentos")
        try:
            command([sys.executable, "-m", "riffsync.transcribe", str(output)], job_id, directory / "transcription.log")
            transcription = json.loads((output / "transcription.json").read_text(encoding="utf-8"))
        except Cancelled:
            raise
        except Exception:
            transcription["warnings"].append("A transcrição automática falhou. As pistas estão prontas; importe seu texto para sincronizar.")
    for track in tracks:
        track["notes"] = transcription["notes"].get(track["kind"], [])
    db.update(job_id, status="completed", stage="Pronto para tocar", progress=100,
              warnings=transcription["warnings"], result={"duration": length, "bpm": transcription["bpm"], "tracks": tracks, "chords": transcription["chords"]})
    shutil.rmtree(directory / "separated", ignore_errors=True)
    (directory / "source.wav").unlink(missing_ok=True)

def main():
    db.init()
    if not importlib.util.find_spec("demucs") or not shutil.which("ffmpeg"):
        raise SystemExit("Instale requirements-ai.txt e FFmpeg antes de iniciar o worker.")
    worker_id = uuid.uuid4().hex
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: stop.set())
    def pulse():
        while not stop.is_set():
            db.heartbeat(worker_id); stop.wait(5)
    thread = threading.Thread(target=pulse, daemon=True); thread.start()
    log.info("RiffSync worker ready (%s)", worker_id)
    last_cleanup = 0
    while not stop.is_set():
        db.recover()
        if time.monotonic() - last_cleanup > 3600:
            db.prune(); last_cleanup = time.monotonic()
        job = db.claim(worker_id)
        if not job:
            stop.wait(2); continue
        try:
            process(job)
        except Cancelled:
            db.update(job["id"], status="cancelled", stage="Processamento interrompido")
        except Exception as error:
            log.exception("Job %s failed", job["id"])
            db.update(job["id"], status="failed", stage="Não foi possível concluir", error=str(error)[:350])
    with db.connect() as c:
        c.execute("DELETE FROM workers WHERE id=?", (worker_id,))

if __name__ == "__main__":
    main()
