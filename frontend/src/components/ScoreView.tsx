import { useEffect, useRef, useState } from "react";
import type { AlphaTabApi } from "@coderline/alphatab";
import type { Cue } from "../types";
import { activeCue } from "../sync";

export default function ScoreView({
  file,
  cues,
  time,
  onBars,
}: {
  file: Blob;
  cues: Cue[];
  time: number;
  onBars: (n: number) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const api = useRef<AlphaTabApi | null>(null);
  const onBarsRef = useRef(onBars);
  onBarsRef.current = onBars;
  const [error, setError] = useState("");
  const [trackNames, setTrackNames] = useState<string[]>([]);
  const [track, setTrack] = useState(0);
  const [rendered, setRendered] = useState(0);
  const [highlight, setHighlight] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        const { AlphaTabApi } = await import("@coderline/alphatab");
        if (disposed || !element.current) return;
        const instance = new AlphaTabApi(element.current, {
          core: {
            useWorkers: false,
            fontDirectory: `${import.meta.env.BASE_URL}alphatab/font/`,
          },
          player: { enablePlayer: false, enableCursor: false },
          display: { scale: 0.95, barsPerRow: 3 },
        });
        api.current = instance;
        instance.error.on((e) =>
          setError(`Não foi possível ler a partitura: ${e.message}`),
        );
        instance.scoreLoaded.on((score) => {
          setTrackNames(score.tracks.map((t) => t.name));
          onBarsRef.current(score.masterBars.length);
        });
        instance.renderFinished.on(() => setRendered((n) => n + 1));
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!disposed) instance.load(bytes, [0]);
      } catch (e) {
        if (!disposed)
          setError(
            e instanceof Error ? e.message : "Falha ao carregar a partitura.",
          );
      }
    })();
    return () => {
      disposed = true;
      api.current?.destroy();
      api.current = null;
    };
  }, [file]);
  useEffect(() => {
    const instance = api.current;
    if (instance?.score?.tracks[track])
      instance.renderTracks([instance.score.tracks[track]]);
  }, [track]);
  const current = cues.find(
    (c) =>
      c.id ===
      activeCue(
        cues.filter((c) => c.barIndex !== undefined),
        time,
      ),
  )?.barIndex;
  useEffect(() => {
    const bounds =
      current === undefined
        ? null
        : api.current?.renderer.boundsLookup?.findMasterBarByIndex(current)
            ?.realBounds;
    setHighlight(
      bounds ? { x: bounds.x, y: bounds.y, w: bounds.w, h: bounds.h } : null,
    );
  }, [current, rendered]);
  return (
    <div className="score-view">
      <div className="score-controls">
        <label>
          Instrumento{" "}
          <select
            value={track}
            onChange={(e) => setTrack(Number(e.target.value))}
          >
            {trackNames.map((name, i) => (
              <option key={i} value={i}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <span>Marque os compassos no editor para acompanhar o áudio.</span>
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <div className="score-paper">
        <div ref={element} />
        {highlight && (
          <div
            className="score-highlight"
            style={{
              left: highlight.x,
              top: highlight.y,
              width: highlight.w,
              height: highlight.h,
            }}
          />
        )}
      </div>
    </div>
  );
}
