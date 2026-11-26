import { AMP_PROFILE_IDS, type AmpProfileId } from "./ampProfiles";
export const EFFECT_KINDS = [
  "gate",
  "compressor",
  "boost",
  "overdrive",
  "distortion",
  "fuzz",
  "amp",
  "cabinet",
  "eq",
  "chorus",
  "phaser",
  "flanger",
  "tremolo",
  "delay",
  "reverb",
] as const;
export type EffectKind = (typeof EFFECT_KINDS)[number];
export type Effect = {
  kind: EffectKind;
  enabled: boolean;
  params: Record<string, number>;
};
export type RigPreset = {
  version: 1;
  name: string;
  inputDb: number;
  outputDb: number;
  bypass: boolean;
  amp: "clean" | "crunch" | "highgain" | "nam";
  cabinet: "1x12" | "2x12" | "4x12" | "ir";
  ampProfile?: AmpProfileId;
  factoryVariant?: "base" | "solo";
  namAsset?: string;
  irAsset?: string;
  effects: Effect[];
};
export type RigState = {
  version: 1;
  current: RigPreset;
  a?: RigPreset;
  b?: RigPreset;
  saved: { id: string; preset: RigPreset }[];
  reference?: { trackId: string; start: number; seconds: number };
  calibrationAsset?: string;
};
export type RigAssets = Record<
  string,
  { name: string; kind: "ir" | "nam" | "di"; blob: Blob }
>;
export type Control = {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  initial: number;
  unit?: string;
};
const control = (
  key: string,
  label: string,
  min: number,
  max: number,
  step: number,
  initial: number,
  unit = "",
): Control => ({ key, label, min, max, step, initial, unit });
export const EFFECTS: Record<
  EffectKind,
  { name: string; color: string; controls: Control[] }
> = {
  gate: {
    name: "Noise gate",
    color: "#879dad",
    controls: [
      control("threshold", "Limiar", -80, -15, 1, -55, "dB"),
      control("release", "Release", 20, 400, 5, 100, "ms"),
    ],
  },
  compressor: {
    name: "Compressor",
    color: "#b9b2eb",
    controls: [
      control("threshold", "Limiar", -50, -3, 1, -22, "dB"),
      control("ratio", "Ratio", 1, 12, 0.5, 4),
      control("attack", "Ataque", 1, 80, 1, 12, "ms"),
      control("release", "Release", 30, 500, 10, 150, "ms"),
    ],
  },
  boost: {
    name: "Boost",
    color: "#f5cc7a",
    controls: [control("gain", "Ganho", 0, 18, 0.5, 4, "dB")],
  },
  overdrive: {
    name: "Overdrive",
    color: "#9bd68e",
    controls: [
      control("drive", "Drive", 0, 10, 0.1, 3),
      control("tone", "Tone", 500, 9000, 100, 4500, "Hz"),
      control("level", "Level", -24, 6, 0.5, -5, "dB"),
    ],
  },
  distortion: {
    name: "Distorção",
    color: "#efa189",
    controls: [
      control("drive", "Drive", 0, 10, 0.1, 5),
      control("tone", "Tone", 500, 10000, 100, 6000, "Hz"),
      control("level", "Level", -24, 6, 0.5, -8, "dB"),
    ],
  },
  fuzz: {
    name: "Fuzz",
    color: "#dfa6dc",
    controls: [
      control("drive", "Fuzz", 0, 10, 0.1, 5),
      control("tone", "Tone", 500, 9000, 100, 4000, "Hz"),
      control("level", "Level", -24, 6, 0.5, -10, "dB"),
    ],
  },
  amp: {
    name: "Amplificador",
    color: "#c5f16d",
    controls: [
      control("gain", "Gain", 0, 10, 0.1, 3),
      control("bass", "Graves", -12, 12, 0.5, 0, "dB"),
      control("mid", "Médios", -12, 12, 0.5, 0, "dB"),
      control("treble", "Agudos", -12, 12, 0.5, 0, "dB"),
      control("presence", "Presença", -10, 10, 0.5, 0, "dB"),
      control("master", "Master", -24, 3, 0.5, -5, "dB"),
    ],
  },
  cabinet: {
    name: "Caixa / gabinete",
    color: "#e1bc8a",
    controls: [
      control("lowcut", "Corte grave", 40, 250, 5, 75, "Hz"),
      control("highcut", "Corte agudo", 2500, 12000, 100, 6500, "Hz"),
    ],
  },
  eq: {
    name: "Equalizador",
    color: "#7bc9d6",
    controls: [
      control("low", "120 Hz", -15, 15, 0.5, 0, "dB"),
      control("lowmid", "400 Hz", -15, 15, 0.5, 0, "dB"),
      control("mid", "1 kHz", -15, 15, 0.5, 0, "dB"),
      control("highmid", "2,5 kHz", -15, 15, 0.5, 0, "dB"),
      control("high", "6 kHz", -15, 15, 0.5, 0, "dB"),
    ],
  },
  chorus: {
    name: "Chorus",
    color: "#89c1f1",
    controls: [
      control("rate", "Rate", 0.1, 6, 0.1, 0.8, "Hz"),
      control("depth", "Depth", 0, 1, 0.01, 0.45),
      control("mix", "Mix", 0, 0.7, 0.01, 0.25),
    ],
  },
  phaser: {
    name: "Phaser",
    color: "#e0a1ef",
    controls: [
      control("rate", "Rate", 0.1, 5, 0.1, 0.6, "Hz"),
      control("depth", "Depth", 0, 1, 0.01, 0.5),
      control("mix", "Mix", 0, 0.8, 0.01, 0.35),
    ],
  },
  flanger: {
    name: "Flanger",
    color: "#84d1c0",
    controls: [
      control("rate", "Rate", 0.1, 5, 0.1, 0.4, "Hz"),
      control("depth", "Depth", 0, 1, 0.01, 0.5),
      control("feedback", "Feedback", 0, 0.8, 0.01, 0.25),
      control("mix", "Mix", 0, 0.7, 0.01, 0.3),
    ],
  },
  tremolo: {
    name: "Tremolo",
    color: "#d5bc8d",
    controls: [
      control("rate", "Rate", 0.2, 12, 0.1, 4, "Hz"),
      control("depth", "Depth", 0, 1, 0.01, 0.4),
    ],
  },
  delay: {
    name: "Delay",
    color: "#a8c8f6",
    controls: [
      control("time", "Tempo", 30, 1800, 5, 375, "ms"),
      control("feedback", "Repetições", 0, 0.8, 0.01, 0.28),
      control("mix", "Mix", 0, 0.65, 0.01, 0.18),
    ],
  },
  reverb: {
    name: "Reverb",
    color: "#c0a9dc",
    controls: [
      control("decay", "Cauda", 0.2, 4, 0.1, 1.4, "s"),
      control("mix", "Mix", 0, 0.65, 0.01, 0.15),
    ],
  },
};
export function defaultPreset(name = "Meu timbre"): RigPreset {
  return {
    version: 1,
    name,
    inputDb: 0,
    outputDb: -12,
    bypass: false,
    amp: "clean",
    cabinet: "2x12",
    effects: EFFECT_KINDS.map((kind) => ({
      kind,
      enabled: ["gate", "amp", "cabinet", "eq"].includes(kind),
      params: Object.fromEntries(
        EFFECTS[kind].controls.map((c) => [c.key, c.initial]),
      ),
    })),
  };
}
export function defaultRig(): RigState {
  return { version: 1, current: defaultPreset(), saved: [] };
}
export function validatePreset(value: unknown): RigPreset {
  const p = value as RigPreset;
  if (
    !p ||
    p.version !== 1 ||
    typeof p.name !== "string" ||
    p.name.length > 120 ||
    !["clean", "crunch", "highgain", "nam"].includes(p.amp) ||
    !["1x12", "2x12", "4x12", "ir"].includes(p.cabinet) ||
    !Number.isFinite(p.inputDb) ||
    p.inputDb < -24 ||
    p.inputDb > 24 ||
    !Number.isFinite(p.outputDb) ||
    p.outputDb < -60 ||
    p.outputDb > 3 ||
    typeof p.bypass !== "boolean" ||
    !Array.isArray(p.effects) ||
    p.effects.length !== EFFECT_KINDS.length ||
    new Set(p.effects.map((e) => e.kind)).size !== EFFECT_KINDS.length
  )
    throw new Error("Preset de timbre inválido.");
  for (const effect of p.effects) {
    if (
      !EFFECT_KINDS.includes(effect.kind) ||
      typeof effect.enabled !== "boolean" ||
      !effect.params
    )
      throw new Error("Efeito inválido.");
    for (const c of EFFECTS[effect.kind].controls)
      if (
        !Number.isFinite(effect.params[c.key]) ||
        effect.params[c.key] < c.min ||
        effect.params[c.key] > c.max
      )
        throw new Error(`Parâmetro inválido em ${EFFECTS[effect.kind].name}.`);
  }
  if (p.ampProfile !== undefined && !AMP_PROFILE_IDS.includes(p.ampProfile))
    throw new Error("Modelo de amplificador inválido.");
  if (
    p.factoryVariant !== undefined &&
    !["base", "solo"].includes(p.factoryVariant)
  )
    throw new Error("Variação de timbre inválida.");
  for (const id of [p.namAsset, p.irAsset])
    if (id !== undefined && !/^[\w-]{1,80}$/.test(id))
      throw new Error("Arquivo de timbre inválido.");
  return structuredClone(p);
}
export function validateRig(value: unknown): RigState {
  const state = value as RigState;
  if (
    !state ||
    state.version !== 1 ||
    !Array.isArray(state.saved) ||
    state.saved.length > 50
  )
    throw new Error("Biblioteca de timbres inválida.");
  validatePreset(state.current);
  if (state.a) validatePreset(state.a);
  if (state.b) validatePreset(state.b);
  for (const item of state.saved)
    if (typeof item.id !== "string" || !/^[\w-]{1,80}$/.test(item.id))
      throw new Error("Timbre salvo inválido.");
    else validatePreset(item.preset);
  if (new Set(state.saved.map((s) => s.id)).size !== state.saved.length)
    throw new Error("Timbres salvos duplicados.");
  if (
    state.calibrationAsset !== undefined &&
    !/^[\w-]{1,80}$/.test(state.calibrationAsset)
  )
    throw new Error("Calibração inválida.");
  if (
    state.reference &&
    (typeof state.reference.trackId !== "string" ||
      !Number.isFinite(state.reference.start) ||
      state.reference.start < 0 ||
      state.reference.start > 86400 ||
      !Number.isFinite(state.reference.seconds) ||
      state.reference.seconds < 1 ||
      state.reference.seconds > 20)
  )
    throw new Error("Referência de timbre inválida.");
  return structuredClone(state);
}
export function effect(preset: RigPreset, kind: EffectKind) {
  return preset.effects.find((e) => e.kind === kind)!;
}
export const dbGain = (db: number) => Math.pow(10, db / 20);

export function validateRigAssets(
  state: RigState | undefined,
  assets: RigAssets,
) {
  if (Object.keys(assets).length > 40)
    throw new Error("Muitos arquivos de timbre.");
  let total = 0;
  for (const [id, a] of Object.entries(assets)) {
    if (
      !/^[\w-]{1,80}$/.test(id) ||
      !a ||
      typeof a.name !== "string" ||
      a.name.length > 240 ||
      !["ir", "nam", "di"].includes(a.kind) ||
      !(a.blob instanceof Blob) ||
      !a.blob.size ||
      a.blob.size > 20 * 1024 ** 2
    )
      throw new Error("Arquivo de timbre inválido.");
    total += a.blob.size;
  }
  if (total > 100 * 1024 ** 2)
    throw new Error("Os arquivos de timbre excedem 100 MB.");
  if (state) {
    for (const p of [
      state.current,
      state.a,
      state.b,
      ...state.saved.map((s) => s.preset),
    ])
      if (p) {
        if (
          (p.namAsset && assets[p.namAsset]?.kind !== "nam") ||
          (p.irAsset && assets[p.irAsset]?.kind !== "ir")
        )
          throw new Error("Arquivo NAM ou IR ausente no projeto.");
      }
    if (state.calibrationAsset && assets[state.calibrationAsset]?.kind !== "di")
      throw new Error("Calibração ausente no projeto.");
  }
}
