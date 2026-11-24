import type { Job } from "./types";

export type Health = {
  status: string;
  worker_online: boolean;
  separation_available: boolean;
  transcription_available: boolean;
  device: string;
};
export function serverBase(): string {
  return localStorage.getItem("riffsync-api") || "";
}
function workspaceKey() {
  let key = localStorage.getItem("riffsync-workspace");
  if (!key) {
    key = crypto.randomUUID() + crypto.randomUUID();
    localStorage.setItem("riffsync-workspace", key);
  }
  return key;
}
export async function request<T>(
  base: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${base.replace(/\/$/, "")}/api${path}`, {
    ...init,
    headers: { ...init.headers, "X-Workspace-Key": workspaceKey() },
    signal: init.signal || AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    let message = `Erro ${response.status}`;
    try {
      const body = await response.json();
      if (typeof body.detail === "string") message = body.detail;
    } catch {
      /* use HTTP status */
    }
    throw new Error(message);
  }
  return response.json();
}
export const health = (base: string) =>
  request<Health>(base, "/health", { signal: AbortSignal.timeout(5000) });
export async function createJob(
  base: string,
  file: Blob,
  name: string,
  model: string,
  transcribe: boolean,
) {
  const body = new FormData();
  body.append("file", file, name);
  body.append("model", model);
  body.append("transcribe", String(transcribe));
  return request<Job>(base, "/jobs", {
    method: "POST",
    body,
    signal: AbortSignal.timeout(180000),
  });
}
export const getJob = (base: string, id: string) =>
  request<Job>(base, `/jobs/${id}`);
export const cancelJob = (base: string, id: string) =>
  request<Job>(base, `/jobs/${id}/cancel`, { method: "POST" });
export const retryJob = (base: string, id: string) =>
  request<Job>(base, `/jobs/${id}/retry`, { method: "POST" });
export async function artifact(
  base: string,
  id: string,
  file: string,
  signal?: AbortSignal,
  playback = false,
) {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    let response: Response;
    try {
      const timeout = AbortSignal.timeout(180000);
      response = await fetch(
        `${base.replace(/\/$/, "")}/api/jobs/${id}/files/${encodeURIComponent(file)}${playback ? "?format=m4a" : ""}`,
        {
          headers: { "X-Workspace-Key": workspaceKey() },
          credentials: "same-origin",
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        },
      );
    } catch (error) {
      signal?.throwIfAborted();
      if (attempt < 1) continue;
      throw new Error(
        `${file}: conexão interrompida ou tempo de download excedido. ${error instanceof Error ? error.message : ""}`,
      );
    }
    if (!response.ok) {
      if (response.status >= 500 && attempt < 1) continue;
      let detail = "";
      try {
        const body = await response.json();
        if (typeof body.detail === "string") detail = body.detail;
      } catch {
        /* proxy response */
      }
      if (response.status === 401 || response.status === 403)
        detail ||=
          "A sessão de acesso ao servidor expirou. Reabra a aba do aplicativo e recupere o resultado.";
      throw new Error(
        `${file}: HTTP ${response.status}${detail ? ` — ${detail}` : ""}`,
      );
    }
    const type = response.headers.get("content-type") || "";
    if (type.includes("text/html") || type.includes("application/json"))
      throw new Error(
        `${file}: o servidor retornou uma página em vez do áudio. Reabra a aba do aplicativo para conferir a sessão de acesso.`,
      );
    try {
      const blob = await response.blob();
      const expected = Number(response.headers.get("content-length"));
      if (
        !response.headers.get("content-encoding") &&
        expected > 0 &&
        expected !== blob.size
      )
        throw new Error("Download incompleto");
      const header = new TextDecoder("ascii").decode(
        await blob.slice(0, 12).arrayBuffer(),
      );
      const wav = blob.size >= 44 && /^(RIFF|RF64)[\s\S]{4}WAVE$/.test(header);
      const m4a = playback && blob.size >= 16 && header.slice(4, 8) === "ftyp";
      if (!wav && !m4a)
        throw new Error(
          "O áudio recebido está incompleto ou tem formato inválido",
        );
      return blob;
    } catch (error) {
      signal?.throwIfAborted();
      if (attempt < 1) continue;
      throw new Error(
        `${file}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
