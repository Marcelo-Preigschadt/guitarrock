import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { artifact } from "./api";

function wav() {
  const bytes = new Uint8Array(46);
  bytes.set(new TextEncoder().encode("RIFF"));
  bytes.set(new TextEncoder().encode("WAVE"), 8);
  return new Response(bytes, {
    headers: { "content-type": "audio/wav", "content-length": "46" },
  });
}
beforeEach(() =>
  vi.stubGlobal("localStorage", { getItem: () => "a".repeat(64) }),
);
afterEach(() => vi.unstubAllGlobals());
describe("download de pistas autenticadas", () => {
  it("identifica HTML de autenticação em vez de enviá-lo ao decodificador", async () => {
    const fetch = vi.fn(
      async () =>
        new Response("<html>sign in</html>", {
          headers: { "content-type": "text/html" },
        }),
    );
    vi.stubGlobal("fetch", fetch);
    await expect(artifact("", "job", "guitar.wav")).rejects.toThrow(
      "página em vez do áudio",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("repete um erro transitório e mantém a chave fora da URL", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response("down", { status: 503 }))
      .mockResolvedValueOnce(wav());
    vi.stubGlobal("fetch", fetch);
    expect((await artifact("", "job", "guitar.wav")).size).toBe(46);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][0]).toBe("/api/jobs/job/files/guitar.wav");
    expect(fetch.mock.calls[0][1].headers["X-Workspace-Key"]).toHaveLength(64);
  });
  it("mostra arquivo e HTTP 401 sem repetir falhas de autorização", async () => {
    const fetch = vi.fn(async () => new Response("", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    await expect(artifact("", "job", "bass.wav")).rejects.toThrow(
      "bass.wav: HTTP 401",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejeita resposta truncada e aceita a reprodução M4A", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("x", {
            headers: { "content-type": "audio/wav", "content-length": "200" },
          }),
      ),
    );
    await expect(artifact("", "job", "guitar.wav")).rejects.toThrow(
      "Download incompleto",
    );
    const bytes = new Uint8Array(24);
    bytes.set(new TextEncoder().encode("ftyp"), 4);
    const fetch = vi.fn(
      async () =>
        new Response(bytes, { headers: { "content-type": "audio/mp4" } }),
    );
    vi.stubGlobal("fetch", fetch);
    expect(
      (await artifact("", "job", "guitar.wav", undefined, true)).type,
    ).toBe("audio/mp4");
    expect(fetch.mock.calls[0]?.length).toBeGreaterThan(0);
  });
});
