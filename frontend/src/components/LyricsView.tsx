import { useEffect, useRef } from "react";
import type { Cue, Lyric } from "../types";
import { chordsForLine } from "../lyrics";
import { formatTime } from "../sync";

export function LyricsView({
  lines,
  cues,
  time,
  follow,
  editing,
  onSeek,
  onChange,
  review,
}: {
  lines: Lyric[];
  cues: Cue[];
  time: number;
  follow: boolean;
  editing: boolean;
  onSeek: (time: number) => void;
  onChange: (index: number, line: Lyric) => void;
  review?: { start: number; end: number; reason: string }[];
}) {
  const active = lines.findIndex(
    (line) => time >= line.start && time < line.end,
  );
  const current = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (follow && !editing)
      current.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active, follow, editing]);
  return (
    <div className="lyrics-display">
      <p className="lyrics-caption">
        Transcrição estimada do áudio · confira as palavras ouvindo a música.
        Acordes estimados no acompanhamento. Clique no horário para ouvir.
      </p>
      {!!review?.length && (
        <div className="lyrics-review" role="status">
          {review.map((item, index) => (
            <p key={index}>
              <button className="cue-time" onClick={() => onSeek(item.start)}>
                {formatTime(item.start, true)}
              </button>{" "}
              {item.reason}. Ouça e complete esse trecho manualmente.
            </p>
          ))}
        </div>
      )}
      {lines.map((line, index) => (
        <div
          key={index}
          ref={index === active ? current : undefined}
          className={`lyric-line ${index === active ? "current" : ""}`}
        >
          <button className="cue-time" onClick={() => onSeek(line.start)}>
            {formatTime(line.start, true)}
          </button>
          <div className="lyric-content">
            <div className="lyric-chords">
              {chordsForLine(line, cues).map((cue) => (
                <button
                  key={cue.id}
                  title={formatTime(cue.start!)}
                  onClick={() => onSeek(cue.start!)}
                >
                  {cue.text}
                </button>
              ))}
            </div>
            {editing ? (
              <>
                <textarea
                  aria-label={`Letra do trecho ${index + 1}`}
                  value={line.text}
                  onChange={(e) =>
                    onChange(index, {
                      ...line,
                      text: e.target.value,
                      words: [],
                    })
                  }
                />
                <div className="lyric-timing">
                  <label>
                    Início (s){" "}
                    <input
                      type="number"
                      min={0}
                      max={line.end - 0.01}
                      step="0.01"
                      value={line.start}
                      onChange={(e) => {
                        const start = Number(e.target.value);
                        if (start >= 0 && start < line.end)
                          onChange(index, { ...line, start, words: [] });
                      }}
                    />
                  </label>
                  <label>
                    Fim (s){" "}
                    <input
                      type="number"
                      min={line.start + 0.01}
                      step="0.01"
                      value={line.end}
                      onChange={(e) => {
                        const end = Number(e.target.value);
                        if (end > line.start)
                          onChange(index, { ...line, end, words: [] });
                      }}
                    />
                  </label>
                </div>
              </>
            ) : (
              <p>
                {line.words?.length
                  ? line.words.map((word, i) => (
                      <span
                        key={i}
                        className={
                          time >= word.start && time < word.end
                            ? "current-word"
                            : ""
                        }
                      >
                        {word.text}{" "}
                      </span>
                    ))
                  : line.text}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
