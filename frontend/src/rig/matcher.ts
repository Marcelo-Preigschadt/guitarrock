import { CLASSIC_AMPS } from "./ampProfiles";
import { classicPreset } from "./factoryPresets";
import { calibrationWindow, toneDistance, toneFeatures } from "./analysis";
import { renderPreset } from "./dsp";
import { defaultPreset, effect, type RigPreset } from "./types";
export type MatchProgress = { done: number; total: number; distance: number };
export async function matchTone(
  di: Float32Array,
  reference: Float32Array,
  rate: number,
  current: RigPreset,
  signal: AbortSignal,
  onProgress: (p: MatchProgress) => void,
  render = renderPreset,
) {
  if (current.amp === "nam" || current.cabinet === "ir")
    throw new Error(
      "O ajuste automático usa amplificadores e caixas DSP. Escolha um modelo DSP antes de analisar; NAM e IR continuam disponíveis para ajuste manual.",
    );
  const input = calibrationWindow(di, rate),
    target = toneFeatures(reference, rate);
  let done = 0;
  const total = 63 + CLASSIC_AMPS.length;
  const evaluate = async (preset: RigPreset) => {
    signal.throwIfAborted();
    const audio = await render(input, rate, preset);
    signal.throwIfAborted();
    const distance = toneDistance(toneFeatures(audio, rate), target);
    done++;
    onProgress({ done, total, distance });
    await new Promise((r) => setTimeout(r, 0));
    return distance;
  };
  let best = structuredClone(current),
    distance = await evaluate(best);
  const initial = distance;
  const accept = async (preset: RigPreset) => {
    const value = await evaluate(preset);
    if (value < distance) {
      distance = value;
      best = preset;
    }
  };
  // Each candidate is actually rendered through the same DSP used for playing.
  for (const amp of ["clean", "crunch", "highgain"] as const)
    for (const cabinet of ["1x12", "2x12", "4x12"] as const)
      for (const gain of [1, 4, 8]) {
        const p = defaultPreset("Timbre por referência");
        p.inputDb = current.inputDb;
        p.outputDb = current.outputDb;
        p.amp = amp;
        p.cabinet = cabinet;
        effect(p, "amp").params.gain = gain;
        await accept(p);
      }
  for (const model of CLASSIC_AMPS) {
    const p = classicPreset(model.id);
    p.inputDb = current.inputDb;
    p.outputDb = current.outputDb;
    await accept(p);
  }
  for (const step of [5, 2])
    for (const control of ["bass", "mid", "treble", "presence"]) {
      const base = structuredClone(best);
      for (const direction of [-1, 1]) {
        const p = structuredClone(base);
        effect(p, "amp").params[control] = Math.max(
          -10,
          Math.min(10, effect(base, "amp").params[control] + direction * step),
        );
        await accept(p);
      }
    }
  for (const [kind, params] of [
    ["compressor", { threshold: -25, ratio: 4 }],
    ["overdrive", { drive: 2, level: -6 }],
    ["distortion", { drive: 4, level: -10 }],
    ["fuzz", { drive: 3, level: -12 }],
    ["chorus", { mix: 0.18 }],
    ["reverb", { mix: 0.12, decay: 0.9 }],
    ["reverb", { mix: 0.25, decay: 2.3 }],
    ["delay", { time: 250, mix: 0.12 }],
    ["delay", { time: 450, mix: 0.18 }],
  ] as const) {
    const p = structuredClone(best);
    const e = effect(p, kind);
    e.enabled = true;
    Object.assign(e.params, params);
    await accept(p);
  }
  for (const control of ["low", "lowmid", "mid", "highmid", "high"]) {
    const base = structuredClone(best);
    for (const direction of [-1, 1]) {
      const p = structuredClone(base);
      effect(p, "eq").enabled = true;
      effect(p, "eq").params[control] = Math.max(
        -15,
        Math.min(15, effect(base, "eq").params[control] + direction * 3),
      );
      await accept(p);
    }
  }
  best.name = "Timbre por referência";
  onProgress({ done, total: done, distance });
  return {
    preset: best,
    initial,
    distance,
    improvement:
      initial > 0 ? Math.max(0, (initial - distance) / initial) * 100 : 0,
    evaluations: done,
  };
}
