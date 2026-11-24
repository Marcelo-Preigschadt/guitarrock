export type Note = {
  start: number;
  end: number;
  midi: number;
  velocity: number;
  string?: number;
  fret?: number;
};
export type Track = {
  id: string;
  name: string;
  kind: string;
  color: string;
  volume: number;
  muted: boolean;
  solo: boolean;
  visible: boolean;
  notes?: Note[];
  filename?: string;
};
export type Cue = {
  id: string;
  text: string;
  start: number | null;
  end?: number;
  barIndex?: number;
  source: "manual" | "ai";
};
export type Project = {
  version: 1;
  id: string;
  title: string;
  filename: string;
  duration: number;
  updated: number;
  tracks: Track[];
  cues: Cue[];
  rawText: string;
  bpm?: number;
  demo?: boolean;
  jobId?: string;
  jobBase?: string;
  jobApplied?: boolean;
  scoreName?: string;
};
export type Session = {
  project: Project;
  files: Record<string, Blob>;
  score?: Blob;
};
export type Job = {
  id: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  stage: string;
  progress: number;
  error?: string;
  warnings: string[];
  result?: {
    duration: number;
    bpm?: number;
    tracks: {
      id: string;
      name: string;
      kind: string;
      file: string;
      notes?: Note[];
    }[];
    chords: { start: number; end: number; label: string }[];
  };
};
export const PALETTE: Record<string, string> = {
  vocals: "#d6a1f3",
  drums: "#f4b969",
  bass: "#7ea9ff",
  guitar: "#c5f16d",
  piano: "#73d9cf",
  other: "#e399aa",
  original: "#a0a8b8",
};
export const NAMES: Record<string, string> = {
  vocals: "Voz",
  drums: "Bateria",
  bass: "Baixo",
  guitar: "Guitarra",
  piano: "Piano",
  other: "Outros",
  original: "Música original",
};
export function makeTrack(
  kind: string,
  id: string = crypto.randomUUID(),
): Track {
  return {
    id,
    kind,
    name: NAMES[kind] || kind,
    color: PALETTE[kind] || "#c5f16d",
    volume: 0.8,
    muted: false,
    solo: false,
    visible: true,
  };
}
