import { get, set, del, entries, createStore } from "idb-keyval";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import type { Session } from "./types";
import {
  validateRig,
  validateRigAssets,
  type RigAssets,
  type RigState,
} from "./rig/types";
const rigStore = createStore("riffsync-live-rig", "draft");
export const loadRigDraft = () =>
  get<{ state: RigState; assets: RigAssets }>("rig", rigStore);
export const saveRigDraft = (state: RigState, assets: RigAssets) =>
  set("rig", { state, assets }, rigStore);

const store = createStore("riffsync", "sessions");
export const saveSession = (session: Session) =>
  set(session.project.id, session, store);
export const loadSession = (id: string) => get<Session>(id, store);
export const deleteSession = (id: string) => del(id, store);
export async function listSessions() {
  return (await entries<string, Session>(store))
    .map(([, s]) => s.project)
    .sort((a, b) => b.updated - a.updated);
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export async function exportSession(session: Session) {
  download(
    await packSession(session),
    `${session.project.title.replace(/[^\p{L}\p{N}_-]/gu, "_")}.riffsync`,
  );
}
export async function packSession(session: Session) {
  if (session.project.rig) validateRig(session.project.rig);
  validateRigAssets(session.project.rig, session.rigAssets || {});
  if (session.project.tracks.some((track) => !session.files[track.id]))
    throw new Error(
      "Recupere as pistas pendentes antes de exportar o projeto completo. As cifras e tablaturas já estão salvas neste dispositivo.",
    );
  if (
    Object.values(session.files).reduce(
      (n, b) => n + b.size,
      (session.score?.size || 0) +
        Object.values(session.rigAssets || {}).reduce(
          (sum, a) => sum + a.blob.size,
          0,
        ),
    ) >
    2 * 1024 ** 3 - 20 * 1024 ** 2
  )
    throw new Error(
      "O projeto excede o limite de exportação de 2 GB. Baixe as pistas individualmente.",
    );
  const files: Record<string, Uint8Array> = {
    "project.json": strToU8(JSON.stringify(session.project, null, 2)),
  };
  for (const [id, blob] of Object.entries(session.files))
    files[`audio/${id}`] = new Uint8Array(await blob.arrayBuffer());
  if (session.score)
    files["score.bin"] = new Uint8Array(await session.score.arrayBuffer());
  if (session.rigAssets && Object.keys(session.rigAssets).length) {
    files["rig-assets.json"] = strToU8(
      JSON.stringify(
        Object.fromEntries(
          Object.entries(session.rigAssets).map(([id, a]) => [
            id,
            { name: a.name, kind: a.kind },
          ]),
        ),
      ),
    );
    for (const [id, a] of Object.entries(session.rigAssets))
      files[`rig/${id}`] = new Uint8Array(await a.blob.arrayBuffer());
  }
  const zipped = zipSync(files, { level: 0 });
  return new Blob([new Uint8Array(zipped).buffer], { type: "application/zip" });
}
export async function importSession(file: File): Promise<Session> {
  if (file.size > 2 * 1024 ** 3)
    throw new Error("O projeto excede o limite de importação de 2 GB.");
  let totalSize = 0,
    rigBytes = 0,
    rigFiles = 0;
  // Inspect each entry before inflation to reject zip bombs.
  const unpacked = unzipSync(new Uint8Array(await file.arrayBuffer()), {
    filter: (entry) => {
      totalSize += entry.originalSize;
      if (/^rig\/[a-zA-Z0-9_-]{1,80}$/.test(entry.name)) {
        rigBytes += entry.originalSize;
        rigFiles++;
        if (
          entry.originalSize > 20 * 1024 ** 2 ||
          rigBytes > 100 * 1024 ** 2 ||
          rigFiles > 40
        )
          throw new Error("Arquivos de timbre excedem os limites do projeto.");
      }
      if (entry.name === "rig-assets.json" && entry.originalSize > 64000)
        throw new Error("Índice de timbres muito grande.");
      if (entry.originalSize > 500 * 1024 * 1024 || totalSize > 2 * 1024 ** 3)
        throw new Error("Arquivo interno muito grande.");
      return (
        entry.name === "project.json" ||
        entry.name === "score.bin" ||
        entry.name === "rig-assets.json" ||
        /^rig\/[a-zA-Z0-9_-]{1,80}$/.test(entry.name) ||
        /^audio\/[a-zA-Z0-9_-]+$/.test(entry.name)
      );
    },
  });
  if (
    !unpacked["project.json"] ||
    unpacked["project.json"].length > 10 * 1024 * 1024
  )
    throw new Error("Projeto inválido.");
  const p = JSON.parse(strFromU8(unpacked["project.json"]));
  if (
    p.version !== 1 ||
    !Array.isArray(p.tracks) ||
    !Array.isArray(p.cues) ||
    typeof p.title !== "string" ||
    p.tracks.length > 32 ||
    p.cues.length > 10000
  )
    throw new Error("Formato de projeto incompatível.");
  if (
    !Number.isFinite(p.duration) ||
    p.duration < 0 ||
    !p.tracks.every(
      (t: {
        id: unknown;
        volume: unknown;
        name: unknown;
        kind: unknown;
        color: unknown;
      }) =>
        typeof t.id === "string" &&
        /^[a-zA-Z0-9_-]+$/.test(t.id) &&
        typeof t.volume === "number" &&
        t.volume >= 0 &&
        t.volume <= 1 &&
        typeof t.name === "string" &&
        typeof t.kind === "string" &&
        typeof t.color === "string" &&
        /^#[0-9a-f]{6}$/i.test(t.color),
    )
  )
    throw new Error("Dados de áudio inválidos.");
  if (
    !p.cues.every(
      (c: { text: unknown; start: unknown }) =>
        typeof c.text === "string" &&
        (c.start === null ||
          (typeof c.start === "number" &&
            Number.isFinite(c.start) &&
            c.start >= 0)),
    )
  )
    throw new Error("Marcadores inválidos.");
  if (
    p.lyrics !== undefined &&
    (!Array.isArray(p.lyrics) ||
      p.lyrics.length > 10000 ||
      !p.lyrics.every(
        (line: {
          start: number;
          end: number;
          text: string;
          words?: { start: number; end: number; text: string }[];
        }) =>
          Number.isFinite(line.start) &&
          Number.isFinite(line.end) &&
          line.start >= 0 &&
          line.end > line.start &&
          typeof line.text === "string" &&
          (line.words === undefined ||
            (Array.isArray(line.words) &&
              line.words.every(
                (word) =>
                  Number.isFinite(word.start) &&
                  Number.isFinite(word.end) &&
                  typeof word.text === "string",
              ))),
      ))
  )
    throw new Error("Letra sincronizada inválida.");
  if (
    p.harmony !== undefined &&
    (!Array.isArray(p.harmony) ||
      p.harmony.length > 10000 ||
      !p.harmony.every(
        (chord: { start: number; end: number; label: string }) =>
          Number.isFinite(chord.start) &&
          Number.isFinite(chord.end) &&
          chord.start >= 0 &&
          chord.end > chord.start &&
          typeof chord.label === "string",
      ))
  )
    throw new Error("Cifra sincronizada inválida.");
  const rigAssets: RigAssets = {};
  if (unpacked["rig-assets.json"]) {
    if (unpacked["rig-assets.json"].length > 64000)
      throw new Error("Índice de timbres muito grande.");
    const metadata = JSON.parse(strFromU8(unpacked["rig-assets.json"]));
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
      throw new Error("Índice de timbres inválido.");
    for (const [id, value] of Object.entries(metadata)) {
      const a = value as { name: string; kind: "ir" | "nam" | "di" };
      const data = unpacked[`rig/${id}`];
      if (!a || !data) throw new Error("Arquivo de timbre ausente.");
      rigAssets[id] = { ...a, blob: new Blob([new Uint8Array(data).buffer]) };
    }
  }
  if (p.rig) p.rig = validateRig(p.rig);
  validateRigAssets(p.rig, rigAssets);
  p.lyricsPending = false;
  const files: Record<string, Blob> = {};
  for (const track of p.tracks) {
    const bytes = unpacked[`audio/${track.id}`];
    if (!bytes) throw new Error(`Áudio ausente: ${track.name}`);
    files[track.id] = new Blob([new Uint8Array(bytes).buffer], {
      type:
        track.playbackFormat === "m4a"
          ? "audio/mp4"
          : track.playbackFormat === "wav"
            ? "audio/wav"
            : "",
    });
  }
  p.id = crypto.randomUUID();
  p.updated = Date.now();
  p.jobId = undefined;
  p.jobBase = undefined;
  return {
    project: p,
    files,
    rigAssets,
    score: unpacked["score.bin"]
      ? new Blob([new Uint8Array(unpacked["score.bin"]).buffer])
      : undefined,
  };
}
