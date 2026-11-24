import {
  AudioLines,
  Drum,
  Eye,
  EyeOff,
  Guitar,
  Mic2,
  Piano,
  Volume2,
  VolumeX,
  Download,
  RotateCcw,
} from "lucide-react";
import type { Track } from "../types";
import { download } from "../storage";

type Props = {
  track: Track;
  samples: number[];
  selected: boolean;
  file?: Blob;
  onSelect: () => void;
  onChange: (changes: Partial<Track>) => void;
  onRetry?: () => void;
  onDownload?: () => void;
};
export function TrackRow({
  track: t,
  samples,
  selected,
  file,
  onSelect,
  onChange,
  onRetry,
  onDownload,
}: Props) {
  const Icon =
    (
      {
        vocals: Mic2,
        drums: Drum,
        bass: Guitar,
        guitar: Guitar,
        piano: Piano,
      } as const
    )[t.kind as "vocals"] || AudioLines;
  return (
    <div
      className={`track-row ${selected ? "selected" : ""} ${t.muted ? "muted" : ""}`}
      style={{ "--track": t.color } as React.CSSProperties}
    >
      <button
        className="track-identity"
        onClick={onSelect}
        title={`Selecionar ${t.name}`}
      >
        <span className="instrument-icon">
          <Icon size={19} />
        </span>
        <span>
          <strong>{t.name}</strong>
          <small>
            {t.loadState === "loading"
              ? "Carregando áudio…"
              : t.loadState === "pending"
                ? "Áudio aguardando carregamento"
                : t.loadState === "error"
                  ? "Falha ao carregar áudio"
                  : t.kind === "original"
                    ? "Áudio importado"
                    : "Pista de instrumento"}
          </small>
        </span>
      </button>
      <svg
        viewBox="0 0 300 36"
        preserveAspectRatio="none"
        className="track-wave"
        aria-hidden="true"
      >
        {samples
          .filter((_, i) => i % 2 === 0)
          .map((v, i, arr) => (
            <rect
              key={i}
              x={(i * 300) / arr.length}
              y={18 - Math.max(1, v * 15)}
              width="1.5"
              height={Math.max(2, v * 30)}
              rx="0.6"
            />
          ))}
      </svg>
      <div className="volume-control">
        <Volume2 size={14} />
        <input
          aria-label={`Volume de ${t.name}`}
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={t.volume}
          onChange={(e) => onChange({ volume: Number(e.target.value) })}
        />
        <span>{Math.round(t.volume * 100)}</span>
      </div>
      <div className="track-buttons">
        <button
          aria-label={`Silenciar ${t.name}`}
          aria-pressed={t.muted}
          className={`mini-button ${t.muted ? "active-mute" : ""}`}
          onClick={() => onChange({ muted: !t.muted })}
          title="Silenciar áudio"
        >
          {t.muted ? <VolumeX size={15} /> : "M"}
        </button>
        <button
          aria-label={`Ouvir somente ${t.name}`}
          aria-pressed={t.solo}
          className={`mini-button ${t.solo ? "active-solo" : ""}`}
          onClick={() => onChange({ solo: !t.solo })}
          title="Ouvir isoladamente"
        >
          S
        </button>
        <button
          aria-label={`Mostrar notação de ${t.name}`}
          aria-pressed={t.visible}
          className={`mini-button eye ${!t.visible ? "off" : ""}`}
          onClick={() => onChange({ visible: !t.visible })}
          title="Mostrar ou esconder notação"
        >
          {t.visible ? <Eye size={15} /> : <EyeOff size={15} />}
        </button>
        {t.loadState === "error" && onRetry && (
          <button
            className="mini-button"
            aria-label={`Recuperar áudio de ${t.name}`}
            onClick={onRetry}
            title="Recuperar áudio já separado"
          >
            <RotateCcw size={15} />
          </button>
        )}
        {(file || onDownload) && (
          <button
            className="mini-button download-track"
            aria-label={`Baixar áudio de ${t.name}`}
            title={onDownload ? "Baixar WAV original" : "Baixar pista"}
            onClick={() =>
              onDownload
                ? onDownload()
                : file &&
                  download(
                    file,
                    t.playbackFormat === "m4a"
                      ? `${t.name}.m4a`
                      : t.filename || `${t.name}.wav`,
                  )
            }
          >
            <Download size={15} />
          </button>
        )}
      </div>
      {t.loadError && <p className="track-load-error">{t.loadError}</p>}
    </div>
  );
}
