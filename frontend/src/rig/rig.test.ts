import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { signalLevel, toneFeatures, toneDistance } from "./analysis";
import {
  defaultPreset,
  defaultRig,
  effect,
  validatePreset,
  validateRig,
  validateRigAssets,
} from "./types";
import { matchTone } from "./matcher";
function signal(rate = 48000) {
  return Float32Array.from(
    { length: rate * 2 },
    (_, i) =>
      0.2 * Math.sin((2 * Math.PI * 220 * i) / rate) +
      0.08 * Math.sin((2 * Math.PI * 1500 * i) / rate),
  );
}
describe("comparação real de descritores de timbre", () => {
  it("normaliza o volume sem apagar diferenças espectrais", () => {
    const samples = signal(),
      original = toneFeatures(samples, 48000),
      quieter = toneFeatures(
        samples.map((v) => v * 0.2),
        48000,
      ),
      bass = toneFeatures(
        Float32Array.from(
          samples,
          (_, i) => 0.2 * Math.sin((2 * Math.PI * 220 * i) / 48000),
        ),
        48000,
      );
    expect(toneDistance(original, quieter)).toBeLessThan(0.001);
    expect(toneDistance(original, bass)).toBeGreaterThan(5);
  });
  it("rejeita silêncio, clipping e calibração muito curta", () => {
    expect(() => toneFeatures(new Float32Array(48000), 48000)).toThrow(
      "silencioso",
    );
    expect(() => signalLevel(new Float32Array([NaN]))).toThrow("inválidas");
    expect(signalLevel(new Float32Array([0, 1, -1])).peak).toBe(1);
  });
  it("só aceita melhorias medidas e respeita cancelamento", async () => {
    const p = defaultPreset(),
      samples = signal();
    const target = samples.map(
      (v, i) => v + 0.2 * Math.sin((2 * Math.PI * 4200 * i) / 48000),
    );
    const result = await matchTone(
      samples,
      target,
      48000,
      p,
      new AbortController().signal,
      () => {},
      async (data, _rate, preset) =>
        data.map(
          (v, i) =>
            v +
            (preset.amp === "highgain" ? 0.2 : 0) *
              Math.sin((2 * Math.PI * 4200 * i) / 48000),
        ),
    );
    expect(result.preset.amp).toBe("highgain");
    expect(result.distance).toBeLessThan(result.initial);
    const controller = new AbortController();
    controller.abort();
    await expect(
      matchTone(samples, target, 48000, p, controller.signal, () => {}),
    ).rejects.toThrow();
  });
});
describe("preset e arquivos de timbre", () => {
  it("mantém os 15 efeitos, seus limites e a ordem editável", () => {
    const p = defaultPreset();
    p.effects.reverse();
    expect(validatePreset(p).effects[0].kind).toBe("reverb");
    effect(p, "delay").params.feedback = 1;
    expect(() => validatePreset(p)).toThrow("Parâmetro inválido");
  });
  it("rejeita arquivo ausente, tipo errado e referência fora dos limites", () => {
    const state = defaultRig();
    state.current.irAsset = "cab";
    expect(() => validateRigAssets(state, {})).toThrow("ausente");
    expect(() =>
      validateRigAssets(state, {
        cab: { name: "cab.wav", kind: "ir", blob: new Blob(["ir"]) },
      }),
    ).not.toThrow();
    state.reference = { trackId: "guitar", start: Infinity, seconds: 10 };
    expect(() => validateRig(state)).toThrow("Referência");
  });
});
describe("AudioWorklet de entrada e noise gate", () => {
  const processors = new Map<
    string,
    new () => {
      port: {
        onmessage: (e: { data: unknown }) => void;
        postMessage: (m: unknown) => void;
      };
      process: (i: Float32Array[][], o: Float32Array[][]) => boolean;
    }
  >();
  vm.runInNewContext(
    readFileSync(
      new URL("../../public/rig-worklet.js", import.meta.url),
      "utf8",
    ),
    {
      AudioWorkletProcessor: class {
        port = { postMessage: () => {}, onmessage: () => {} };
      },
      sampleRate: 48000,
      Float32Array,
      Math,
      registerProcessor: (name: string, processor: never) =>
        processors.set(name, processor),
    },
  );
  it("captura a DI original e não inclui efeitos na gravação", () => {
    const processor = new (processors.get("riffsync-rig-input")!)(),
      messages: unknown[] = [];
    processor.port.postMessage = (m) => messages.push(m);
    processor.port.onmessage({ data: { type: "record", seconds: 1 } });
    const input = new Float32Array(128).fill(0.25),
      output = new Float32Array(128);
    for (let i = 0; i < 375; i++) processor.process([[input]], [[output]]);
    const recorded = messages.find(
      (m) => !!(m as { pcm?: Float32Array }).pcm,
    ) as { pcm: Float32Array };
    expect(recorded.pcm.length).toBe(48000);
    expect(recorded.pcm[24000]).toBe(0.25);
    expect(output[0]).toBe(0.25);
  });
  it("o gate não cria sinal no silêncio e mantém amostras finitas", () => {
    const processor = new (processors.get("riffsync-rig-gate")!)(),
      output = new Float32Array(128);
    processor.process([[new Float32Array(128)]], [[output]]);
    expect(output.every((v) => v === 0)).toBe(true);
    for (let i = 0; i < 50; i++)
      processor.process([[new Float32Array(128).fill(0.5)]], [[output]]);
    expect(output.every((v) => Number.isFinite(v) && v >= 0 && v <= 0.5)).toBe(
      true,
    );
  });
  it("encerra os processadores ao trocar de sessão, sem manter áudio e medidores ativos", () => {
    for (const name of ["riffsync-rig-input", "riffsync-rig-gate"]) {
      const processor = new (processors.get(name)!)();
      processor.port.onmessage({ data: { type: "dispose" } });
      expect(
        processor.process([[new Float32Array(128)]], [[new Float32Array(128)]]),
      ).toBe(false);
    }
  });
});
