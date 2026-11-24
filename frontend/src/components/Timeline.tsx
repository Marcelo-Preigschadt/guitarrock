import { useMemo, useRef, useState } from "react";
import { formatTime } from "../sync";
import type { Cue } from "../types";

type Props = {
  samples: number[];
  time: number;
  duration: number;
  cues: Cue[];
  loop: [number, number] | null;
  onSeek: (time: number) => void;
  onMoveCue: (id: string, time: number) => void;
};
export function Timeline({
  samples,
  time,
  duration,
  cues,
  loop,
  onSeek,
  onMoveCue,
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ id: string; time: number } | null>(null);
  const positions = useMemo(
    () => Array.from({ length: 7 }, (_, i) => (duration * i) / 6),
    [duration],
  );
  const position = (x: number) => {
    const bounds = container.current!.getBoundingClientRect();
    return Math.max(
      0,
      Math.min(duration, ((x - bounds.left) / bounds.width) * duration),
    );
  };
  return (
    <div className="timeline-block">
      <div className="time-ruler">
        {positions.map((n, i) => (
          <span key={i}>{formatTime(n)}</span>
        ))}
      </div>
      <div
        className="timeline"
        ref={container}
        onPointerDown={(e) => {
          if (duration) onSeek(position(e.clientX));
        }}
      >
        {loop && (
          <div
            className="loop-region"
            style={{
              left: `${(loop[0] / duration) * 100}%`,
              width: `${((loop[1] - loop[0]) / duration) * 100}%`,
            }}
          />
        )}
        <svg
          viewBox="0 0 1100 92"
          preserveAspectRatio="none"
          className="waveform"
          aria-hidden="true"
        >
          {(samples.length
            ? samples
            : Array.from({ length: 220 }, () => 0.025)
          ).map((v, i, arr) => (
            <rect
              key={i}
              x={(i * 1100) / arr.length}
              y={46 - Math.max(1, v * 39)}
              width={Math.max(1, 1100 / arr.length - 1.6)}
              height={Math.max(2, v * 78)}
              rx="1"
              fill={
                duration && i / arr.length <= time / duration
                  ? "#c5f16d"
                  : "#465334"
              }
            />
          ))}
        </svg>
        {cues
          .filter((c) => c.start !== null)
          .slice(0, 120)
          .map((cue) => (
            <button
              key={cue.id}
              className="cue-pin"
              title={`${cue.text.split("\n")[0]} · ${formatTime(cue.start!, true)} — arraste para ajustar`}
              aria-label={`Mover marcador ${cue.text.split("\n")[0]}`}
              style={{
                left: `${((drag?.id === cue.id ? drag.time : cue.start!) / Math.max(1, duration)) * 100}%`,
              }}
              onPointerDown={(e) => {
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                setDrag({ id: cue.id, time: cue.start! });
              }}
              onPointerMove={(e) => {
                if (drag?.id === cue.id)
                  setDrag({ id: cue.id, time: position(e.clientX) });
              }}
              onPointerUp={(e) => {
                e.stopPropagation();
                if (drag) onMoveCue(cue.id, position(e.clientX));
                setDrag(null);
              }}
              onPointerCancel={() => setDrag(null)}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  onMoveCue(
                    cue.id,
                    Math.max(
                      0,
                      Math.min(
                        duration,
                        cue.start! + (e.key === "ArrowLeft" ? -0.1 : 0.1),
                      ),
                    ),
                  );
                }
              }}
            />
          ))}
        {duration > 0 && (
          <div
            className="playhead"
            style={{ left: `${(time / duration) * 100}%` }}
          >
            <span />
          </div>
        )}
      </div>
      <input
        className="sr-only"
        type="range"
        min={0}
        max={duration || 1}
        step={0.01}
        value={time}
        onChange={(e) => onSeek(Number(e.target.value))}
        aria-label="Posição da reprodução"
      />
    </div>
  );
}
