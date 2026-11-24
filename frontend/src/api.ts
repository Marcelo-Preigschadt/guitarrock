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
export async function artifact(base: string, id: string, file: string) {
  const response = await fetch(
    `${base.replace(/\/$/, "")}/api/jobs/${id}/files/${encodeURIComponent(file)}`,
    {
      headers: { "X-Workspace-Key": workspaceKey() },
      signal: AbortSignal.timeout(180000),
    },
  );
  if (!response.ok)
    throw new Error("Não foi possível baixar o áudio processado.");
  return response.blob();
}
