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
from .diagnostics import summarize_failure

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("riffsync")
stop = threading.Event()

class Cancelled(Exception):
    pass

class ProcessingFailure(RuntimeError):
    def __init__(self, returncode, log_path):
        with log_path.open("rb") as stream:
            stream.seek(max(0, log_path.stat().st_size - 16000))
            detail = stream.read().decode("utf-8", errors="replace")
        self.category, message, self.details = summarize_failure(returncode, detail)
        super().__init__(message)

def command(args, job_id, log_path, progress=False):
    started = time.monotonic()
    with log_path.open("wb") as output:
        env = dict(os.environ)
        env.setdefault("OMP_NUM_THREADS", "2")
        env.setdefault("MKL_NUM_THREADS", "2")
        env.setdefault("TF_CPP_MIN_LOG_LEVEL", "2")
        process = subprocess.Popen(args, stdout=output, stderr=output, start_new_session=True, env=env)
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
                raise ProcessingFailure(process.returncode, log_path)
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
        # Do not retain a second PyTorch runtime in the supervisor process.
        probe = subprocess.run([sys.executable, "-c", "import torch; print('cuda' if torch.cuda.is_available() else 'cpu')"], capture_output=True, text=True, timeout=60)
        device = "cuda" if probe.returncode == 0 and probe.stdout.strip() == "cuda" else "cpu"
    # Shorter model windows bound peak RAM; the song retains its full duration.
    segment = int(min(7, max(1, config.SEGMENT_SECONDS)))
    attempts = list(dict.fromkeys([(device, segment), (device, min(2.0, segment)), ("cpu", 1.0)]))
    for attempt, (target_device, target_segment) in enumerate(attempts):
        try:
            command([sys.executable, "-m", "demucs", "-n", job["model"], "-d", target_device,
                     "--segment", str(int(target_segment)), "--jobs", "0", "--shifts", "1", "--overlap", "0.25",
                     "--out", str(directory / "separated"), str(directory / "source.wav")], job_id,
                    directory / ("separation.log" if attempt == 0 else f"separation-retry-{attempt}.log"), progress=True)
            break
        except ProcessingFailure as error:
            if error.category != "memory" or attempt == len(attempts) - 1:
                raise
            db.update(job_id, stage="Repetindo a separação com menor uso de memória", progress=10)
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
    transcription = {"bpm": None, "chords": [], "notes": {}, "timing": None, "warnings": []}
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
              warnings=transcription["warnings"], result={"duration": length, "bpm": transcription["bpm"], "timing": transcription.get("timing"), "tracks": tracks, "chords": transcription["chords"]})
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
            db.update(job["id"], status="failed", stage="Não foi possível concluir", error=str(error)[:350],
                      error_code=getattr(error, "category", "processing"), error_details=getattr(error, "details", ""))
    with db.connect() as c:
        c.execute("DELETE FROM workers WHERE id=?", (worker_id,))

if __name__ == "__main__":
    main()
