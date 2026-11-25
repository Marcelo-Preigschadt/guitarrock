import { useState } from "react";
import type { Chord, Project, Track } from "../types";
import { chordShape } from "../chords";
import { formatTime } from "../sync";

export function ChordDiagram({ label }: { label: string }) {
  const frets = chordShape(label);
  if (!frets)
    return <p className="field-help">Sem digitação cadastrada para {label}.</p>;
  const pressed = frets.filter((fret) => fret > 0),
    first =
      pressed.length && Math.max(...pressed) > 4 ? Math.min(...pressed) : 1;
  return (
    <svg
      viewBox="0 0 170 200"
      role="img"
      aria-label={`Diagrama de ${label}: ${frets.map((f, i) => `${6 - i}ª corda ${f < 0 ? "abafada" : f === 0 ? "solta" : `casa ${f}`}`).join(", ")}`}
    >
      <text x="85" y="19" textAnchor="middle" className="diagram-title">
        {label}
      </text>
      {Array.from({ length: 6 }, (_, i) => (
        <line
          key={`f${i}`}
          x1="35"
          x2="135"
          y1={48 + i * 25}
          y2={48 + i * 25}
          stroke={i === 0 && first === 1 ? "#d5dfcf" : "#596568"}
          strokeWidth={i === 0 && first === 1 ? 4 : 1}
        />
      ))}
      {frets.map((fret, i) => (
        <g key={i}>
          <line
            x1={35 + i * 20}
            x2={35 + i * 20}
            y1="48"
            y2="173"
            stroke="#778487"
          />
          <text
            x={35 + i * 20}
            y="39"
            textAnchor="middle"
            fill="#b5c2c4"
            fontSize="12"
          >
            {fret < 0 ? "×" : fret === 0 ? "○" : ""}
          </text>
          {fret > 0 && (
            <circle
              cx={35 + i * 20}
              cy={48 + (fret - first + 0.5) * 25}
              r="7"
              fill="#c5f16d"
            />
          )}
          <text
            x={35 + i * 20}
            y="190"
            textAnchor="middle"
            fontSize="10"
            fill="#91a1b0"
          >
            {["E", "A", "D", "G", "B", "e"][i]}
          </text>
        </g>
      ))}
      {first > 1 && (
        <text x="9" y="65" fontSize="12" fill="#c5f16d">
          {first}ª
        </text>
      )}
    </svg>
  );
}

function Fretboard({
  track,
  chord,
  time,
}: {
  track?: Track;
  chord?: Chord;
  time: number;
}) {
  const [mode, setMode] = useState<"notes" | "chord">("chord");
  const bass = track?.kind === "bass",
    tuning = bass ? [43, 38, 33, 28] : [64, 59, 55, 50, 45, 40];
  const notes =
    track?.notes?.filter(
      (note) =>
        note.start <= time &&
        note.end > time &&
        note.string &&
        note.fret !== undefined,
    ) || [];
  const shape = !bass && chord ? chordShape(chord.label) : null;
  const positions =
    mode === "notes" || bass
      ? notes.map((note) => ({
          string: note.string!,
          fret: note.fret!,
          pitch: note.pitch,
        }))
      : (shape || []).flatMap((fret, index) =>
          fret < 0
            ? []
            : [{ string: 6 - index, fret, pitch: tuning[5 - index] + fret }],
        );
  const minFret = Math.min(...positions.map((position) => position.fret), 0),
    maxFret = Math.max(...positions.map((position) => position.fret), 0);
  const first = maxFret > 12 && minFret >= 0 ? Math.max(0, maxFret - 12) : 0;
  const pitchName = (pitch: number) =>
    ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"][
      pitch % 12
    ];
  return (
    <div className="fretboard-area">
      <div className="fretboard-controls">
        <strong>Braço · {bass ? "baixo" : "guitarra / violão"}</strong>
        <div className="text-source">
          <button
            className={mode === "chord" ? "active" : ""}
            disabled={bass}
            onClick={() => setMode("chord")}
          >
            Posição do acorde
          </button>
          <button
            className={mode === "notes" ? "active" : ""}
            onClick={() => setMode("notes")}
          >
            Notas da faixa
          </button>
        </div>
      </div>
      <div className="fretboard-scroll">
        <svg
          viewBox={`0 0 1000 ${bass ? 175 : 235}`}
          role="img"
          aria-label={`Braço de ${bass ? "baixo" : "guitarra"} ${mode === "chord" ? "com posição sugerida de " + (chord?.label || "acorde não identificado") : "com notas detectadas na posição atual"}`}
        >
          <rect
            x="55"
            y="35"
            width="930"
            height={(tuning.length - 1) * 30}
            fill="#242923"
          />
          {Array.from({ length: 13 }, (_, i) => (
            <g key={i}>
              <line
                x1={55 + i * 77}
                x2={55 + i * 77}
                y1="35"
                y2={35 + (tuning.length - 1) * 30}
                stroke={i === 0 ? "#d2d6c9" : "#697276"}
                strokeWidth={i === 0 ? 5 : 2}
              />
              <text
                x={55 + (i - 0.5) * 77}
                y="21"
                textAnchor="middle"
                fill="#91a1b0"
                fontSize="14"
              >
                {i ? first + i : ""}
              </text>
            </g>
          ))}
          {tuning.map((pitch, i) => (
            <g key={pitch}>
              <text x="18" y={40 + i * 30} fill="#aebac1" fontSize="14">
                {pitchName(pitch)}
              </text>
              <line
                x1="55"
                x2="985"
                y1={35 + i * 30}
                y2={35 + i * 30}
                stroke="#a7afaa"
                strokeWidth={1 + i * 0.35}
              />
            </g>
          ))}
          {[3, 5, 7, 9, 12, 15, 17, 19, 21, 24]
            .filter((fret) => fret > first && fret <= first + 12)
            .map((fret) => (
              <circle
                key={fret}
                cx={55 + (fret - first - 0.5) * 77}
                cy={50 + (tuning.length - 1) * 30}
                r="3"
                fill="#7b8577"
              />
            ))}
          {positions
            .filter(
              (p) => p.fret === 0 || (p.fret > first && p.fret <= first + 12),
            )
            .map((p, index) => (
              <g key={index}>
                <circle
                  cx={p.fret === 0 ? 38 : 55 + (p.fret - first - 0.5) * 77}
                  cy={35 + (p.string - 1) * 30}
                  r="12"
                  fill={mode === "notes" ? "#73d9cf" : "#c5f16d"}
                />
                <text
                  x={p.fret === 0 ? 38 : 55 + (p.fret - first - 0.5) * 77}
                  y={39 + (p.string - 1) * 30}
                  textAnchor="middle"
                  fill="#172016"
                  fontSize="11"
                  fontWeight="700"
                >
                  {pitchName(p.pitch)}
                </text>
              </g>
            ))}
        </svg>
      </div>
      <p className="field-help">
        {mode === "chord" && !bass
          ? "Digitação sugerida do acorde estimado. As bolinhas mostram as notas nas casas."
          : "Notas estimadas na faixa selecionada, acompanhando o áudio. Um trecho sem notas reconhecidas deixa o braço vazio."}
      </p>
    </div>
  );
}

export function CifraView({
  project,
  chords,
  time,
  selectedTrack,
  onTrack,
  onSeek,
  onGenerate,
  onLyric,
  onChange,
  busy,
}: {
  project: Project | null;
  chords: Chord[];
  time: number;
  selectedTrack: string;
  onTrack: (id: string) => void;
  onSeek: (time: number) => void;
  onGenerate: () => void;
  onLyric: () => void;
  onChange: (index: number, label: string) => void;
  busy: boolean;
}) {
  const instruments =
    project?.tracks.filter((track) =>
      ["guitar", "bass"].includes(track.kind),
    ) || [];
  const track =
    instruments.find((track) => track.id === selectedTrack) || instruments[0];
  const active = chords.find(
    (chord) => chord.start <= time && chord.end > time,
  );
  return (
    <div className="cifra-view">
      <div className="cifra-heading">
        <div>
          <h3>Cifra da música</h3>
          <p>Acordes e posições no braço acompanhando a gravação.</p>
        </div>
        <button
          className="button secondary compact"
          disabled={!project?.jobId || busy}
          onClick={onGenerate}
        >
          {busy
            ? "Processando…"
            : chords.length
              ? "Recalcular cifra"
              : "Gerar cifra"}
        </button>
      </div>
      <div className="cifra-current">
        <div className="current-diagram">
          {active ? (
            <ChordDiagram label={active.label} />
          ) : (
            <p>Sem acorde reconhecido neste trecho.</p>
          )}
        </div>
        <div className="cifra-neck">
          <label>
            Instrumento{" "}
            <select
              aria-label="Instrumento no braço"
              value={track?.id || ""}
              onChange={(e) => onTrack(e.target.value)}
            >
              {instruments.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <Fretboard track={track} chord={active} time={time} />
        </div>
      </div>
      {chords.length ? (
        <>
          <p className="field-help">
            Sequência reconhecida. Clique em um acorde para ouvir; edite o nome
            quando necessário.
          </p>
          <div className="chord-sequence">
            {chords.map((chord, index) => (
              <div
                key={`${chord.start}-${index}`}
                className={active === chord ? "active" : ""}
              >
                <button
                  aria-label={`Ouvir acorde ${chord.label} em ${formatTime(chord.start)}`}
                  onClick={() => onSeek(chord.start)}
                >
                  {formatTime(chord.start, true)}
                </button>
                <input
                  aria-label={`Acorde ${index + 1}`}
                  value={chord.label}
                  onChange={(e) => onChange(index, e.target.value)}
                />
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="cifra-empty">
          Nenhum acorde reconhecido ainda. Use Gerar cifra nas faixas já
          separadas ou importe sua cifra em TXT.
        </p>
      )}
      <button className="button ghost compact" onClick={onLyric}>
        Abrir letra e cifra
      </button>
    </div>
  );
}
