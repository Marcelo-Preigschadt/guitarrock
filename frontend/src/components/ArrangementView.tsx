import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Guitar,
  Music2,
  Settings2,
  X,
} from "lucide-react";
import {
  measureAt,
  measureGrid,
  normalizeNote,
  noteName,
  rhythm,
  staffStep,
} from "../arrangement";
import { formatTime } from "../sync";
import type { Cue, Measure, Note, Timing, Track } from "../types";

type Props = {
  tracks: Track[];
  cues: Cue[];
  timing?: Timing;
  bpm?: number;
  duration: number;
  time: number;
  selectedTrack: string;
  demo?: boolean;
  onSeek: (n: number) => void;
  onChangeNote: (trackId: string, index: number, note: Note | null) => void;
  onGrid: (bpm: number, numerator: number) => void;
};

export function ArrangementView({
  tracks,
  cues,
  timing,
  bpm,
  duration,
  time,
  selectedTrack,
  demo,
  onSeek,
  onChangeNote,
  onGrid,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(4);
  const [page, setPage] = useState(0);
  const [follow, setFollow] = useState(true);
  const [onlySelected, setOnlySelected] = useState(false);
  const [gridEdit, setGridEdit] = useState(false);
  const [tempo, setTempo] = useState(bpm || 120);
  const [numerator, setNumerator] = useState(4);
  const [edit, setEdit] = useState<{
    track: Track;
    index: number;
    note: Note;
  } | null>(null);
  const grid = useMemo(
    () => (timing?.measures.length ? timing : measureGrid(duration, bpm)),
    [timing, duration, bpm],
  );
  const current = measureAt(grid.measures, time),
    pageCount = Math.max(1, Math.ceil(grid.measures.length / columns));
  const pageIndex = follow
    ? Math.floor(current / columns)
    : Math.min(page, pageCount - 1);
  const bars = grid.measures.slice(
    pageIndex * columns,
    (pageIndex + 1) * columns,
  );
  const all = tracks.filter((t) => t.kind !== "original");
  const visible = all.filter(
    (t) => t.visible && (!onlySelected || t.id === selectedTrack),
  );
  useEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver((entries) =>
      setColumns(entries[0].contentRect.width < 700 ? 2 : 4),
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setPage(0);
    setFollow(true);
    setEdit(null);
  }, [duration, tracks.map((t) => t.id).join(",")]);
  useEffect(() => {
    setTempo(bpm || 120);
  }, [bpm]);

  if (!all.length)
    return (
      <div className="empty-notation arrangement-empty">
        <Guitar size={30} />
        <h3>Seu arranjo nasce da gravação.</h3>
        <p>
          Use Separar com IA para gerar os instrumentos, cifras e tablaturas. O
          arranjo aparecerá aqui automaticamente, acompanhando o áudio de cada
          pista.
        </p>
        <span className="arrangement-audio-label">
          Reprodução com as pistas de áudio da música
        </span>
      </div>
    );

  return (
    <div className="arrangement" ref={host}>
      <div className="arrangement-controls">
        <div>
          <span className="arrangement-audio-label">
            {demo ? "Demonstração sintetizada" : "Áudio real das pistas"}
          </span>
          <span className="arrangement-estimate">
            {grid.estimated
              ? "Grade e notas estimadas"
              : "Grade revisada · notas estimadas"}{" "}
            · {grid.measures[0]?.numerator || 4}/4
            {bpm ? ` · ${Math.round(bpm)} BPM` : ""}
          </span>
        </div>
        <div>
          <label>
            <input
              type="checkbox"
              checked={onlySelected}
              onChange={(e) => setOnlySelected(e.target.checked)}
            />{" "}
            Somente selecionada
          </label>
          <button
            className="button ghost compact"
            onClick={() => setGridEdit(!gridEdit)}
          >
            <Settings2 size={14} /> Grade
          </button>
        </div>
      </div>
      {gridEdit && (
        <form
          className="arrangement-grid-editor"
          onSubmit={(e) => {
            e.preventDefault();
            onGrid(tempo, numerator);
            setGridEdit(false);
          }}
        >
          <label>
            BPM da grade{" "}
            <input
              type="number"
              min="20"
              max="300"
              value={tempo}
              onChange={(e) => setTempo(Number(e.target.value))}
              required
            />
          </label>
          <label>
            Compasso{" "}
            <select
              value={numerator}
              onChange={(e) => setNumerator(Number(e.target.value))}
            >
              <option value={4}>4/4</option>
              <option value={3}>3/4</option>
              <option value={6}>6/4</option>
            </select>
          </label>
          <button className="button secondary compact" type="submit">
            Aplicar grade visual
          </button>
          <span>O áudio mantém a gravação original.</span>
        </form>
      )}
      <div className="arrangement-page-head">
        <div>
          <Music2 size={15} />
          <strong>
            Compassos {bars[0] ? bars[0].index + 1 : 1}–
            {bars.at(-1) ? bars.at(-1)!.index + 1 : 1}
          </strong>
          <span>
            {bars[0] ? formatTime(bars[0].start) : "00:00"} –{" "}
            {bars.at(-1) ? formatTime(bars.at(-1)!.end) : "00:00"}
          </span>
        </div>
        <label>
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
          />{" "}
          Seguir reprodução
        </label>
      </div>
      {!visible.length && (
        <div className="empty-notation">
          <p>
            A notação das faixas está escondida. Use o controle de olho no mixer
            para exibi-la.
          </p>
        </div>
      )}
      {visible.map((track) => {
        const notes = (track.notes || []).map(normalizeNote);
        return (
          <div
            key={track.id}
            className={`arrangement-track ${track.id === selectedTrack ? "selected" : ""}`}
            style={{ "--track": track.color } as React.CSSProperties}
          >
            <div className="arrangement-track-name">
              <strong>{track.name}</strong>
              <span>
                {track.kind === "drums"
                  ? `${notes.length} ataques detectados`
                  : `${notes.length} notas detectadas`}
              </span>
            </div>
            {notes.length ? (
              <div className="arrangement-paper">
                <svg
                  viewBox={`0 0 ${columns * 290} ${track.kind === "guitar" || track.kind === "bass" ? 250 : 152}`}
                  role="group"
                  aria-label={`Arranjo de ${track.name} em compassos`}
                >
                  {bars.map((bar, i) => (
                    <MeasureStaff
                      key={bar.index}
                      track={track}
                      notes={notes}
                      bar={bar}
                      x={i * 290}
                      active={bar.index === current}
                      time={time}
                      cues={cues}
                      onSeek={onSeek}
                      onEdit={(index) => {
                        const note = notes[index];
                        onSeek(note.start);
                        setEdit({ track, index, note: { ...note } });
                      }}
                    />
                  ))}
                </svg>
              </div>
            ) : (
              <div className="untranscribed-track">
                {track.kind === "other"
                  ? "Acompanhamento em áudio. Esta faixa pode conter vários instrumentos sobrepostos."
                  : "As notas desta pista não foram identificadas. Você pode importar um trecho em texto para sincronizar."}
              </div>
            )}
          </div>
        );
      })}
      <div className="arrangement-pagination">
        <button
          className="button ghost compact"
          disabled={pageIndex === 0}
          onClick={() => {
            setFollow(false);
            setPage(pageIndex - 1);
          }}
        >
          <ChevronLeft size={16} /> Anterior
        </button>
        <span>
          Página {pageIndex + 1} de {pageCount}
        </span>
        <button
          className="button ghost compact"
          disabled={pageIndex >= pageCount - 1}
          onClick={() => {
            setFollow(false);
            setPage(pageIndex + 1);
          }}
        >
          Próxima <ChevronRight size={16} />
        </button>
      </div>
      <p className="arrangement-help">
        Clique em uma nota ou casa para corrigir sua posição e duração. As
        cifras aparecem acima dos compassos; o cursor acompanha o áudio.
      </p>
      {edit && (
        <form
          className="note-editor"
          onSubmit={(e) => {
            e.preventDefault();
            if (edit.note.end <= edit.note.start || edit.note.end > duration)
              return;
            onChangeNote(edit.track.id, edit.index, edit.note);
            setEdit(null);
          }}
        >
          <div>
            <strong>Editar nota · {edit.track.name}</strong>
            <button
              type="button"
              className="icon-button"
              aria-label="Fechar edição da nota"
              onClick={() => setEdit(null)}
            >
              <X size={15} />
            </button>
          </div>
          <label>
            Início (s)
            <input
              aria-label="Início da nota"
              type="number"
              min="0"
              max={duration}
              step="0.0001"
              value={edit.note.start}
              onChange={(e) =>
                setEdit({
                  ...edit,
                  note: { ...edit.note, start: Number(e.target.value) },
                })
              }
              required
            />
          </label>
          <label>
            Fim (s)
            <input
              aria-label="Fim da nota"
              type="number"
              min={edit.note.start + 0.01}
              max={duration}
              step="0.0001"
              value={edit.note.end}
              onChange={(e) =>
                setEdit({
                  ...edit,
                  note: { ...edit.note, end: Number(e.target.value) },
                })
              }
              required
            />
          </label>
          {edit.track.kind === "guitar" || edit.track.kind === "bass" ? (
            <>
              <label>
                Corda
                <select
                  aria-label="Corda da nota"
                  value={edit.note.string || 1}
                  onChange={(e) => {
                    const string = Number(e.target.value),
                      tuning =
                        edit.track.kind === "bass"
                          ? [43, 38, 33, 28]
                          : [64, 59, 55, 50, 45, 40];
                    setEdit({
                      ...edit,
                      note: {
                        ...edit.note,
                        string,
                        pitch: tuning[string - 1] + (edit.note.fret || 0),
                      },
                    });
                  }}
                >
                  {Array.from(
                    { length: edit.track.kind === "bass" ? 4 : 6 },
                    (_, n) => (
                      <option key={n} value={n + 1}>
                        {n + 1}
                      </option>
                    ),
                  )}
                </select>
              </label>
              <label>
                Casa
                <input
                  aria-label="Casa da nota"
                  type="number"
                  min="0"
                  max="24"
                  value={edit.note.fret || 0}
                  onChange={(e) => {
                    const fret = Number(e.target.value),
                      tuning =
                        edit.track.kind === "bass"
                          ? [43, 38, 33, 28]
                          : [64, 59, 55, 50, 45, 40],
                      string = edit.note.string || 1;
                    setEdit({
                      ...edit,
                      note: {
                        ...edit.note,
                        fret,
                        string,
                        pitch: tuning[string - 1] + fret,
                      },
                    });
                  }}
                />
              </label>
            </>
          ) : (
            edit.track.kind !== "drums" && (
              <label>
                Altura · {noteName(edit.note.pitch)}
                <input
                  aria-label="Altura da nota"
                  type="number"
                  min="21"
                  max="108"
                  value={edit.note.pitch}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      note: { ...edit.note, pitch: Number(e.target.value) },
                    })
                  }
                />
              </label>
            )
          )}
          <div>
            <button
              type="button"
              className="button ghost compact"
              onClick={() => {
                onChangeNote(edit.track.id, edit.index, null);
                setEdit(null);
              }}
            >
              Excluir nota
            </button>
            <button type="submit" className="button primary compact">
              Salvar correção
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function MeasureStaff({
  track,
  notes,
  bar,
  x,
  active,
  time,
  cues,
  onSeek,
  onEdit,
}: {
  track: Track;
  notes: Note[];
  bar: Measure;
  x: number;
  active: boolean;
  time: number;
  cues: Cue[];
  onSeek: (n: number) => void;
  onEdit: (i: number) => void;
}) {
  const tab = track.kind === "guitar" || track.kind === "bass",
    drums = track.kind === "drums";
  const strings =
    track.kind === "bass"
      ? ["G", "D", "A", "E"]
      : ["e", "B", "G", "D", "A", "E"];
  const left = x + 34,
    width = 244,
    top = 53,
    staffBottom = top + 40;
  const toX = (n: number) =>
    left +
    12 +
    Math.max(0, Math.min(1, (n - bar.start) / (bar.end - bar.start))) *
      (width - 24);
  const chords = cues.filter(
    (c) =>
      c.barIndex === undefined &&
      c.start !== null &&
      c.start < bar.end &&
      (c.start >= bar.start || (c.end !== undefined && c.end > bar.start)),
  );
  const bass = track.kind === "bass",
    transpose = tab ? 12 : 0;
  return (
    <g>
      {active && (
        <rect
          x={x + 2}
          y="4"
          width="286"
          height={tab ? 240 : 140}
          rx="4"
          fill="#d6e6b9"
          opacity=".4"
        />
      )}
      <text
        x={x + 10}
        y="17"
        fontSize="11"
        fill="#737f6c"
        onClick={() => onSeek(bar.start)}
        className="score-bar-label"
      >
        {bar.index + 1}
      </text>
      {chords.slice(0, 4).map((c) => (
        <text
          key={c.id}
          x={toX(c.start!)}
          y="32"
          fill="#3b5a22"
          fontSize="14"
          fontWeight="700"
        >
          {c.text.split("\n")[0].slice(0, 12)}
        </text>
      ))}
      {!drums && (
        <text
          x={x + 4}
          y={bass ? top + 29 : top + 36}
          className="music-clef"
          fontSize={bass ? "34" : "45"}
          fill="#293b23"
        >
          {bass ? "\uE062" : "\uE050"}
        </text>
      )}
      {drums ? (
        <line
          x1={left}
          x2={left + width}
          y1={top + 20}
          y2={top + 20}
          stroke="#8b9483"
        />
      ) : (
        Array.from({ length: 5 }, (_, i) => (
          <line
            key={i}
            x1={left}
            x2={left + width}
            y1={top + i * 10}
            y2={top + i * 10}
            stroke="#919887"
            strokeWidth=".8"
          />
        ))
      )}
      <line
        x1={left + width}
        x2={left + width}
        y1={top}
        y2={tab ? 165 + (strings.length - 1) * 12 : top + 40}
        stroke="#7f8975"
      />
      {Array.from({ length: bar.numerator - 1 }, (_, i) => (
        <line
          key={i}
          x1={left + 12 + ((i + 1) * (width - 24)) / bar.numerator}
          x2={left + 12 + ((i + 1) * (width - 24)) / bar.numerator}
          y1={top - 3}
          y2={tab ? 171 + (strings.length - 1) * 12 : top + 45}
          stroke="#a3ad951e"
        />
      ))}
      {tab &&
        strings.map((s, i) => (
          <g key={s}>
            <text x={x + 12} y={169 + i * 12} fontSize="10" fill="#78836c">
              {s}
            </text>
            <line
              x1={left}
              x2={left + width}
              y1={165 + i * 12}
              y2={165 + i * 12}
              stroke="#8e9884"
              strokeWidth=".7"
            />
          </g>
        ))}
      {!drums && !notes.some((n) => n.start < bar.end && n.end > bar.start) && (
        <rect
          x={left + width / 2 - 5}
          y={top + 10}
          width="10"
          height="4"
          fill="#515d46"
        />
      )}
      {notes
        .map((n, index) => ({ n, index }))
        .filter(({ n }) => n.start >= bar.start && n.start < bar.end)
        .map(({ n, index }) => {
          const nx = toX(n.start);
          let writtenPitch = n.pitch + transpose,
            octaveShift = 0;
          while (staffStep(writtenPitch, bass) > 14) {
            writtenPitch -= 12;
            octaveShift++;
          }
          while (staffStep(writtenPitch, bass) < -8) {
            writtenPitch += 12;
            octaveShift--;
          }
          const step = staffStep(writtenPitch, bass),
            ny = drums ? top + 20 : staffBottom - step * 5;
          const beatLength = rhythm(n, bar),
            current = n.start <= time && n.end > time,
            color = current ? "#427819" : "#283023";
          return (
            <g key={index}>
              <g
                role="button"
                tabIndex={0}
                aria-label={`Editar ${drums ? "ataque" : noteName(n.pitch)} em ${formatTime(n.start, true)} de ${track.name}`}
                className="arrangement-note"
                onClick={() => onEdit(index)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onEdit(index);
                  }
                }}
              >
                <rect
                  x={nx - 8}
                  y={ny - 6}
                  width="16"
                  height="12"
                  fill="transparent"
                />
                {drums ? (
                  <path
                    d={`M${nx - 4} ${ny - 4} l8 8 m0 -8 l-8 8`}
                    stroke={color}
                    strokeWidth="2"
                  />
                ) : (
                  <ellipse
                    cx={nx}
                    cy={ny}
                    rx="5"
                    ry="3.5"
                    transform={`rotate(-18 ${nx} ${ny})`}
                    fill={beatLength >= 2 ? "#f3f5ed" : color}
                    stroke={color}
                    strokeWidth="1.5"
                  />
                )}
              </g>
              <g pointerEvents="none">
                {beatLength < 4 && (
                  <line
                    x1={nx + 4}
                    x2={nx + 4}
                    y1={ny}
                    y2={ny - 26}
                    stroke={color}
                    strokeWidth="1.3"
                  />
                )}
                {beatLength <= 0.5 && (
                  <path
                    d={`M${nx + 4} ${ny - 26} q13 9 2 15`}
                    fill="none"
                    stroke={color}
                    strokeWidth="1.5"
                  />
                )}
                {beatLength <= 0.25 && (
                  <path
                    d={`M${nx + 4} ${ny - 20} q13 9 2 15`}
                    fill="none"
                    stroke={color}
                    strokeWidth="1.5"
                  />
                )}
                {!drums && [1, 3, 6, 8, 10].includes(n.pitch % 12) && (
                  <text x={nx - 13} y={ny + 4} fontSize="12" fill={color}>
                    ♯
                  </text>
                )}
                {!drums &&
                  Array.from(
                    {
                      length:
                        step < -1
                          ? Math.floor(-step / 2)
                          : step > 9
                            ? Math.floor((step - 8) / 2)
                            : 0,
                    },
                    (_, ledger) => {
                      const y =
                        step < 0
                          ? staffBottom + (ledger + 1) * 10
                          : top - (ledger + 1) * 10;
                      return (
                        <line
                          key={ledger}
                          x1={nx - 8}
                          x2={nx + 8}
                          y1={y}
                          y2={y}
                          stroke={color}
                        />
                      );
                    },
                  )}
                {!drums && octaveShift !== 0 && (
                  <text x={nx - 8} y={ny + 14} fontSize="8" fill="#69745f">
                    {Math.abs(octaveShift) > 1 ? "15" : "8"}
                    {octaveShift > 0 ? "va" : "vb"}
                  </text>
                )}
              </g>
              {tab && n.string && n.fret !== undefined && (
                <g
                  role="button"
                  tabIndex={0}
                  className="arrangement-note"
                  aria-label={`Editar casa ${n.fret} na corda ${n.string} em ${formatTime(n.start, true)} de ${track.name}`}
                  onClick={() => onEdit(index)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onEdit(index);
                    }
                  }}
                >
                  <rect
                    x={nx - 7}
                    y={158 + (n.string - 1) * 12}
                    width="16"
                    height="14"
                    rx="2"
                    fill={current ? "#c8e5a5" : "#f3f5ed"}
                  />
                  <text
                    x={nx + 1}
                    y={169 + (n.string - 1) * 12}
                    textAnchor="middle"
                    fontSize="12"
                    fontWeight="600"
                    fill={color}
                  >
                    {n.fret}
                  </text>
                </g>
              )}
            </g>
          );
        })}
      {active && (
        <line
          x1={toX(time)}
          x2={toX(time)}
          y1="39"
          y2={tab ? 170 + (strings.length - 1) * 12 : 130}
          stroke="#78ac42"
          pointerEvents="none"
          strokeWidth="2"
          opacity=".8"
        />
      )}
    </g>
  );
}
