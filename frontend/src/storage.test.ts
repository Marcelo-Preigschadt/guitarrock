import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { importSession } from "./storage";
import { makeTrack } from "./types";

describe("arquivo de projeto portátil", () => {
  const track = makeTrack("guitar", "guitar-one");
  const project = {
    version: 1,
    id: "old-id",
    title: "Meu riff",
    filename: "riff.mp3",
    duration: 5,
    updated: 1,
    tracks: [track],
    cues: [{ id: "cue", text: "Em    C", start: 1.25, source: "manual" }],
    rawText: "Em    C",
    jobId: "old-job",
    jobBase: "https://external.example",
  };
  const file = (p: object, audio = true) =>
    new File(
      [
        new Uint8Array(
          zipSync({
            "project.json": strToU8(JSON.stringify(p)),
            ...(audio ? { "audio/guitar-one": new Uint8Array([1, 2, 3]) } : {}),
          }),
        ).buffer,
      ],
      "test.riffsync",
    );
  it("preserva texto, tempo e áudio e desativa tarefas externas na importação", async () => {
    const imported = await importSession(file(project));
    expect(imported.project.cues[0].text).toBe("Em    C");
    expect(imported.project.cues[0].start).toBe(1.25);
    expect(imported.files["guitar-one"].size).toBe(3);
    expect(imported.project.id).not.toBe("old-id");
    expect(imported.project.jobBase).toBeUndefined();
    expect(imported.project.jobId).toBeUndefined();
  });
  it("rejeita projeto sem o áudio declarado", async () => {
    await expect(importSession(file(project, false))).rejects.toThrow(
      "Áudio ausente",
    );
  });
  it("rejeita tempo inválido e parâmetros de mixer fora de faixa", async () => {
    await expect(
      importSession(file({ ...project, cues: [{ text: "Em", start: -1 }] })),
    ).rejects.toThrow("Marcadores inválidos");
    await expect(
      importSession(file({ ...project, tracks: [{ ...track, volume: 200 }] })),
    ).rejects.toThrow("Dados de áudio inválidos");
  });
});

import { packSession } from "./storage";
import { defaultRig } from "./rig/types";
import type { Session } from "./types";
describe("projeto com timbre portátil", () => {
  const rig = defaultRig();
  rig.current.irAsset = "cab";
  rig.current.cabinet = "ir";
  rig.calibrationAsset = "dry";
  rig.a = structuredClone(rig.current);
  const session: Session = {
    project: {
      version: 1,
      id: "old",
      title: "Guitarra",
      filename: "g.wav",
      duration: 5,
      updated: 1,
      tracks: [makeTrack("guitar", "g")],
      cues: [],
      rawText: "",
      rig,
    },
    files: { g: new Blob(["audio"]) },
    rigAssets: {
      cab: { kind: "ir", name: "Meu IR.wav", blob: new Blob(["impulse"]) },
      dry: { kind: "di", name: "DI.wav", blob: new Blob(["dry guitar"]) },
    },
  };
  it("exporta e reabre cadeia, A/B, IR e DI com os mesmos bytes", async () => {
    const blob = await packSession(session);
    const imported = await importSession(new File([blob], "song.riffsync"));
    expect(imported.project.rig).toEqual(rig);
    expect(await imported.rigAssets!.cab.blob.text()).toBe("impulse");
    expect(await imported.rigAssets!.dry.blob.text()).toBe("dry guitar");
  });
  it("recusa exportar timbre dependente de arquivos ausentes", async () => {
    await expect(packSession({ ...session, rigAssets: {} })).rejects.toThrow(
      "ausente",
    );
  });
});
