import importlib.util
import fcntl
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

class WorkerStopping(Exception):
    pass


def check_job(job_id, lyrics=False):
    job = db.get(job_id)
    if not job or job['status'] == 'cancelled':
        raise Cancelled()
    if lyrics and job.get('lyrics_state') == 'cancelled':
        raise Cancelled()
    if stop.is_set():
        raise WorkerStopping()
    return job


def acquire_worker_lock():
    config.DATA.mkdir(parents=True, exist_ok=True)
    stream = (config.DATA / 'worker.lock').open('a+')
    try:
        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        stream.close()
        return None
    stream.seek(0); stream.truncate(); stream.write(str(os.getpid())); stream.flush()
    return stream

class ProcessingFailure(RuntimeError):
    def __init__(self, returncode, log_path):
        with log_path.open("rb") as stream:
            stream.seek(max(0, log_path.stat().st_size - 16000))
            detail = stream.read().decode("utf-8", errors="replace")
        self.returncode = returncode
        self.category, message, self.details = summarize_failure(returncode, detail)
        self.details = f'Código de saída: {returncode}\n' + self.details
        super().__init__(message)

def command(args, job_id, log_path, progress=False):
    started, append = time.monotonic(), False
    while True:
        check_job(job_id, progress == 'lyrics')
        with log_path.open('ab' if append else 'wb') as output:
            env = dict(os.environ)
            env.setdefault('OMP_NUM_THREADS', '2')
            env.setdefault('MKL_NUM_THREADS', '2')
            env.setdefault('TF_CPP_MIN_LOG_LEVEL', '2')
            process = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                                       start_new_session=True, close_fds=True, env=env)
            log.info('Job %s: started child %s (worker %s)', job_id, process.pid, os.getpid())
            try:
                while process.poll() is None:
                    current = check_job(job_id, progress == 'lyrics')
                    if time.monotonic() - started > config.JOB_TIMEOUT:
                        raise RuntimeError('O processamento atingiu o limite de tempo do servidor.')
                    if progress == 'lyrics':
                        with log_path.open('rb') as reader:
                            reader.seek(max(0, log_path.stat().st_size - 4096))
                            markers = re.findall(rb'RIFFSYNC_LYRICS (\{[^\r\n]+\})', reader.read())
                        if markers:
                            end = float(json.loads(markers[-1])['end'])
                            length = max(1,float((current.get('result') or {}).get('duration',1)))
                            db.update(job_id,lyrics_progress=min(99,int(end/length*100)),lyrics_stage='Reconhecendo e sincronizando a letra')
                    elif progress:
                        with log_path.open('rb') as reader:
                            reader.seek(max(0, log_path.stat().st_size - 4096))
                            percentages = re.findall(rb'(\d{1,3})%\|', reader.read())
                        if percentages:
                            value = min(100, int(percentages[-1]))
                            db.update(job_id, progress=10 + int(value * .6), stage='Separando os instrumentos')
                    stop.wait(.25)
                # Cancellation/shutdown also wins if the child exited between polls.
                job = check_job(job_id, progress == 'lyrics')
                if process.returncode == 0:
                    return
                log.warning('Job %s: child %s exited with %s; worker stopping=%s', job_id, process.pid, process.returncode, stop.is_set())
                retry_key = 'lyrics_signal_retries' if progress == 'lyrics' else 'signal_retries'
                if process.returncode == -signal.SIGTERM and int(job.get(retry_key, 0)) < 1:
                    if progress == 'lyrics':
                        db.update(job_id, lyrics_signal_retries=1, lyrics_stage='Reconhecimento interrompido; repetindo a etapa uma vez')
                    else:
                        db.update(job_id, signal_retries=1, stage='Separador interrompido; repetindo a etapa uma vez',
                                  progress=10 if progress else job.get('progress', 0))
                    output.write(b'\n[RiffSync] SIGTERM externo: repetindo uma vez com o worker ativo.\n'); output.flush()
                    append = True
                    stop.wait(.25)
                    continue
                raise ProcessingFailure(process.returncode, log_path)
            finally:
                if process.poll() is None:
                    try: os.killpg(process.pid, signal.SIGTERM)
                    except ProcessLookupError: pass
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        try: os.killpg(process.pid, signal.SIGKILL)
                        except ProcessLookupError: pass
                        process.wait()

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
        except (Cancelled, WorkerStopping):
            raise
        except Exception:
            transcription["warnings"].append("A transcrição automática falhou. As pistas estão prontas; importe seu texto para sincronizar.")
    for track in tracks:
        track["notes"] = transcription["notes"].get(track["kind"], [])
    db.update(job_id, status="completed", stage="Pronto para tocar", progress=100,
              warnings=transcription["warnings"], result={"duration": length, "bpm": transcription["bpm"], "timing": transcription.get("timing"), "tracks": tracks, "chords": transcription["chords"]},
              lyrics_state='queued' if job.get('recognize_lyrics') else 'not_requested', lyrics_progress=0)
    shutil.rmtree(directory / "separated", ignore_errors=True)
    (directory / "source.wav").unlink(missing_ok=True)

def process_lyrics(job):
    directory = config.DATA/job['id']
    source = directory/'output'/'vocals.wav'
    if not source.is_file(): raise RuntimeError('A faixa de voz separada não está disponível no servidor.')
    db.update(job['id'], lyrics_stage='Preparando a IA da letra; primeiro uso pode baixar o modelo')
    destination = directory/'output'/'lyrics.json'
    command([sys.executable,'-m','riffsync.lyrics',str(source),str(destination)],job['id'],directory/'lyrics.log',progress='lyrics')
    recognized=json.loads(destination.read_text(encoding='utf-8'))
    current=check_job(job['id'],lyrics=True)
    result={**current['result'],'lyrics':recognized['lyrics'],'lyrics_language':recognized['language'],'lyrics_model':recognized['model'],
            'lyrics_revision':uuid.uuid4().hex}
    db.update(job['id'],result=result,lyrics_state=recognized['status'],lyrics_progress=100,lyrics_error=None,
              lyrics_stage='Letra reconhecida' if recognized['lyrics'] else 'Nenhuma letra foi reconhecida nesta faixa de voz')

def main():
    db.init()
    if not importlib.util.find_spec("demucs") or not shutil.which("ffmpeg"):
        raise SystemExit("Instale requirements-ai.txt e FFmpeg antes de iniciar o worker.")
    worker_lock = acquire_worker_lock()
    if worker_lock is None:
        log.info('A worker is already active for this data directory; duplicate startup ignored.')
        return
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
        lyrics_only = False
        if not job:
            job = db.claim_lyrics(worker_id)
            lyrics_only = bool(job)
        if not job:
            stop.wait(2); continue
        try:
            process_lyrics(job) if lyrics_only else process(job)
        except WorkerStopping:
            if lyrics_only: db.update(job['id'],lyrics_state='queued')
            else: db.requeue(job['id'])
            log.info('Job %s preserved in queue for worker restart', job['id'])
        except Cancelled:
            if lyrics_only: db.update(job['id'],lyrics_state='cancelled',lyrics_stage='Reconhecimento da letra cancelado')
            else: db.update(job["id"], status="cancelled", stage="Processamento interrompido")
        except Exception as error:
            log.exception("Job %s failed", job["id"])
            if lyrics_only:
                db.update(job['id'],lyrics_state='failed',lyrics_stage='Não foi possível reconhecer a letra',lyrics_error=str(error)[:600])
            else: db.update(job["id"], status="failed", stage="Não foi possível concluir", error=str(error)[:350],
                      error_code=getattr(error, "category", "processing"), error_details=getattr(error, "details", ""), exit_code=getattr(error, 'returncode', None))
    with db.connect() as c:
        c.execute("DELETE FROM workers WHERE id=?", (worker_id,))
    worker_lock.close()

if __name__ == "__main__":
    main()
