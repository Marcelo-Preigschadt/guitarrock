"""Run in a child process, so cancellation also stops model inference."""
import json
import sys
from pathlib import Path
from .fingering import assign_strings

def estimate_chords(path):
    import librosa
    import numpy as np
    y, sr = librosa.load(path, sr=22050, mono=True)
    duration = len(y) / sr
    tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, hop_length=512)
    bpm = float(np.asarray(tempo).reshape(-1)[0]) if np.asarray(tempo).size else None
    beats = librosa.frames_to_time(beat_frames, sr=sr, hop_length=512)
    bounds = np.unique(np.concatenate(([0.0], beats[::2], [duration]))) if len(beats) >= 4 else np.append(np.arange(0, duration, 0.8), duration)
    chroma = librosa.feature.chroma_stft(y=y, sr=sr, hop_length=512, n_fft=4096)
    rms = librosa.feature.rms(y=y, hop_length=512)[0]
    templates, labels = [], []
    names = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
    for root in range(12):
        for minor in (False, True):
            template = np.zeros(12)
            template[root] = 1; template[(root + (3 if minor else 4)) % 12] = 0.85; template[(root + 7) % 12] = 0.8
            templates.append(template / np.linalg.norm(template)); labels.append(names[root] + ("m" if minor else ""))
    templates = np.array(templates)
    observations, energy = [], []
    for start, end in zip(bounds[:-1], bounds[1:]):
        left, right = int(start * sr / 512), max(int(start * sr / 512) + 1, int(end * sr / 512))
        vector = np.mean(chroma[:, left:right], axis=1)
        vector /= max(np.linalg.norm(vector), 1e-8)
        observations.append(templates @ vector)
        energy.append(float(np.mean(rms[left:right])))
    if not observations:
        return bpm, []
    scores = np.array(observations)
    dp, back = scores.copy(), np.zeros(scores.shape, dtype=int)
    transitions = np.full((24, 24), -0.16); np.fill_diagonal(transitions, 0)
    for i in range(1, len(scores)):
        matrix = dp[i - 1, :, None] + transitions
        back[i] = np.argmax(matrix, axis=0)
        dp[i] += np.max(matrix, axis=0)
    state, path_states = int(np.argmax(dp[-1])), []
    for i in range(len(scores) - 1, -1, -1):
        path_states.append(state); state = int(back[i, state])
    path_states.reverse()
    chords = []
    for i, state in enumerate(path_states):
        label = labels[state] if scores[i, state] > 0.66 and energy[i] > 0.003 else "N"
        if chords and chords[-1]["label"] == label:
            chords[-1]["end"] = round(float(bounds[i + 1]), 3)
        else:
            chords.append({"start": round(float(bounds[i]), 3), "end": round(float(bounds[i + 1]), 3), "label": label})
    return round(bpm, 2) if bpm and 30 <= bpm <= 300 else None, chords

def run(directory):
    import importlib.util
    output = Path(directory)
    result = {"bpm": None, "chords": [], "notes": {}, "warnings": []}
    try:
        result["bpm"], result["chords"] = estimate_chords(output.parent / "source.wav")
    except Exception as error:
        result["warnings"].append(f"Não foi possível estimar as cifras ({type(error).__name__}). Importe seu texto para sincronizar.")
    if importlib.util.find_spec("basic_pitch"):
        try:
            from basic_pitch.inference import predict
            for kind in ("guitar", "bass", "piano"):
                file = output / f"{kind}.wav"
                if not file.exists():
                    continue
                try:
                    _, midi, events = predict(str(file))
                    midi.write(str(output / f"{kind}.mid"))
                    notes = [{"start": round(float(e[0]), 4), "end": round(float(e[1]), 4), "midi": int(e[2]), "velocity": round(float(e[3]), 3)}
                             for e in events if e[1] - e[0] >= 0.07 and float(e[3]) >= 0.15]
                    result["notes"][kind] = assign_strings(notes, kind) if kind in ("guitar", "bass") else notes
                except Exception as error:
                    result["warnings"].append(f"A transcrição de {kind} falhou ({type(error).__name__}). O áudio separado continua disponível.")
        except Exception as error:
            result["warnings"].append(f"O modelo de notas não carregou ({type(error).__name__}). Use a importação manual.")
    else:
        result["warnings"].append("Basic Pitch não está instalado. Importe cifras ou tablaturas para sincronizar manualmente.")
    (output / "transcription.json").write_text(json.dumps(result), encoding="utf-8")

if __name__ == "__main__":
    run(sys.argv[1])
