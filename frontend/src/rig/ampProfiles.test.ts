import { describe, expect, it } from "vitest";
import { CLASSIC_AMPS, CLASSIC_BRANDS, valveCurve } from "./ampProfiles";
import { classicPreset } from "./factoryPresets";
import { defaultPreset, effect, validatePreset } from "./types";
import { importSession, packSession } from "../storage";
import { makeTrack, type Session } from "../types";
describe("timbres clássicos", () => {
  it("fornece dois modelos por marca, com cadeias de base e solo válidas e independentes", () => {
    expect(CLASSIC_AMPS).toHaveLength(12);
    expect(new Set(CLASSIC_AMPS.map((p) => p.id)).size).toBe(12);
    for (const brand of CLASSIC_BRANDS)
      expect(CLASSIC_AMPS.filter((p) => p.brand === brand)).toHaveLength(2);
    for (const model of CLASSIC_AMPS)
      for (const variant of ["base", "solo"] as const) {
        const p = classicPreset(model.id, variant);
        expect(() => validatePreset(p)).not.toThrow();
        expect(p.ampProfile).toBe(model.id);
        expect(p.effects).toHaveLength(15);
        expect(effect(p, "delay").enabled).toBe(variant === "solo");
        effect(p, "amp").params.gain = 0;
        expect(
          effect(classicPreset(model.id), "amp").params.gain,
        ).toBeGreaterThan(0);
      }
  });
  it("mantém silêncio exato, saturação limitada e voicings não idênticos", () => {
    const curves = CLASSIC_AMPS.map((p) =>
      valveCurve(p.voice.drive, p.voice.bias),
    );
    for (const curve of curves) {
      expect(curve[2048]).toBe(0);
      expect(curve.every((v) => Number.isFinite(v) && Math.abs(v) <= 1)).toBe(
        true,
      );
    }
    expect(new Set(curves.map((c) => c[2300].toFixed(7))).size).toBe(12);
    const clean = curves[2],
      lead = curves[4];
    expect(Math.abs(lead[2300] - clean[2300])).toBeGreaterThan(0.05);
  });
  it("preserva projetos antigos e rejeita modelos desconhecidos", () => {
    expect(() => validatePreset(defaultPreset())).not.toThrow();
    const p = classicPreset("marshall-plexi");
    expect(() =>
      validatePreset({ ...p, ampProfile: "amplificador-inexistente" }),
    ).toThrow("Modelo de amplificador");
  });
  it("preserva modelo, knobs e solo com delay no projeto exportado", async () => {
    const p = classicPreset("mesa-mark-iic", "solo");
    effect(p, "amp").params.presence = 3.5;
    const session: Session = {
      project: {
        id: "old",
        version: 1,
        title: "Solo clássico",
        filename: "g.wav",
        duration: 3,
        updated: 1,
        tracks: [makeTrack("guitar", "g")],
        cues: [],
        rawText: "",
        rig: {
          version: 1,
          current: p,
          a: classicPreset("fender-twin"),
          saved: [{ id: "solo", preset: structuredClone(p) }],
        },
      },
      files: { g: new Blob(["audio"]) },
    };
    const reopened = await importSession(
      new File([await packSession(session)], "solo.riffsync"),
    );
    expect(reopened.project.rig).toEqual(session.project.rig);
  });
});
