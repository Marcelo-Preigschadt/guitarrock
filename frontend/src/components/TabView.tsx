import { Guitar } from "lucide-react";
import { formatTime } from "../sync";
import type { Track } from "../types";

export function TabView({
  tracks,
  time,
  onSeek,
}: {
  tracks: Track[];
  time: number;
  onSeek: (n: number) => void;
}) {
  const start = Math.floor(time / 8) * 8;
  const visible = tracks.filter(
    (t) => t.visible && (t.kind === "guitar" || t.kind === "bass"),
  );
  if (!visible.some((t) => t.notes?.some((n) => n.string !== undefined)))
    return (
      <div className="empty-notation">
        <Guitar size={30} />
        <h3>Sua próxima nota começa aqui.</h3>
        <p>
          As notas estimadas de guitarra e baixo aparecerão após a análise. Você
          também pode importar uma tablatura TXT ou um arquivo Guitar Pro.
        </p>
      </div>
    );
  return (
    <div className="tabs-rendered">
      <div className="notation-explainer">
        Notas estimadas · afinação padrão · revise as digitações{" "}
        <span>
          {formatTime(start)} – {formatTime(start + 8)}
        </span>
      </div>
      {visible.map((t) => {
        const strings =
          t.kind === "bass"
            ? ["G", "D", "A", "E"]
            : ["e", "B", "G", "D", "A", "E"];
        return (
          <div className="tab-track" key={t.id}>
            <strong style={{ color: t.color }}>{t.name}</strong>
            <svg
              viewBox={`0 0 1000 ${strings.length * 25 + 35}`}
              role="img"
              aria-label={`Tablatura de ${t.name}`}
            >
              {strings.map((s, i) => (
                <g key={i}>
                  <text x="6" y={34 + i * 25} fill="#99a1ad" fontSize="15">
                    {s}
                  </text>
                  <line
                    x1="38"
                    x2="990"
                    y1={30 + i * 25}
                    y2={30 + i * 25}
                    stroke="#3a3f45"
                  />
                </g>
              ))}
              {Array.from({ length: 9 }, (_, i) => (
                <g key={i}>
                  <line
                    x1={40 + i * 118}
                    x2={40 + i * 118}
                    y1="25"
                    y2={30 + (strings.length - 1) * 25}
                    stroke="#2d3238"
                  />
                  <text x={40 + i * 118} y="13" fill="#7a8491" fontSize="11">
                    {formatTime(start + i)}
                  </text>
                </g>
              ))}
              {t.notes
                ?.filter(
                  (n) => n.string && n.start >= start && n.start < start + 8,
                )
                .map((n, i) => {
                  const x = 40 + (n.start - start) * 118,
                    y = 30 + (n.string! - 1) * 25,
                    active = n.start <= time && n.end > time;
                  return (
                    <g
                      key={i}
                      onClick={() => onSeek(n.start)}
                      className="tab-note"
                    >
                      <rect
                        x={x - 9}
                        y={y - 11}
                        width="22"
                        height="22"
                        rx="4"
                        fill={active ? t.color : "#1b1e22"}
                      />
                      <text
                        x={x + 2}
                        y={y + 5}
                        textAnchor="middle"
                        fill={active ? "#15200c" : "#e9ecdf"}
                        fontSize="16"
                      >
                        {n.fret}
                      </text>
                    </g>
                  );
                })}
              <line
                x1={40 + (time - start) * 118}
                x2={40 + (time - start) * 118}
                y1="22"
                y2={strings.length * 25 + 20}
                stroke="#c5f16d"
                opacity="0.8"
              />
            </svg>
          </div>
        );
      })}
    </div>
  );
}
