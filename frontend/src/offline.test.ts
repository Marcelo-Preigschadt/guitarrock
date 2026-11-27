import { afterEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { configureOfflineCaching } from "./offline";
// @ts-expect-error This build helper is also used directly by Node.
import { offlineWorkerSource } from "../scripts/offline-worker.mjs";

afterEach(() => vi.unstubAllGlobals());

describe("recuperação do cache da interface", () => {
  it("desregistra apenas o worker do aplicativo no Codespaces", async () => {
    vi.stubGlobal("location", new URL("https://studio-8000.app.github.dev/"));
    const unregister = vi.fn(async () => true);
    const unrelated = vi.fn(async () => true);
    const register = vi.fn();
    vi.stubGlobal("navigator", { serviceWorker: {
      register,
      getRegistrations: async () => [
        { active: { scriptURL: "https://studio-8000.app.github.dev/sw.js" }, unregister },
        { active: { scriptURL: "https://studio-8000.app.github.dev/other/sw.js" }, unregister: unrelated },
      ],
    }});
    await configureOfflineCaching("./");
    expect(unregister).toHaveBeenCalledTimes(1);
    expect(unrelated).not.toHaveBeenCalled();
    expect(register).not.toHaveBeenCalled();
  });

  it("mantém o cache offline em outros hosts, respeitando o subdiretório", async () => {
    vi.stubGlobal("location", new URL("https://example.github.io/guitarrock/"));
    const update = vi.fn(async () => undefined);
    const register = vi.fn(async () => ({ update }));
    vi.stubGlobal("navigator", { serviceWorker: { register }});
    await configureOfflineCaching("./");
    expect(register).toHaveBeenCalledWith("https://example.github.io/guitarrock/sw.js", { updateViaCache: "none" });
    expect(update).toHaveBeenCalledTimes(1);
  });
});

function worker(host = "https://example.com/") {
  const handlers: Record<string, (event: unknown) => void> = {};
  const fetch = vi.fn(async () => { throw new TypeError("offline"); });
  const match = vi.fn(async (): Promise<Response | undefined> => undefined);
  runInNewContext(offlineWorkerSource("riffsync-test", ["index.html"]), {
    self: { location: new URL("sw.js", host), addEventListener: (name: string, handler: (event: unknown) => void) => { handlers[name] = handler; } },
    fetch, caches: { match }, URL, Response,
  });
  return { handlers, fetch, match };
}

describe("respostas do worker offline", () => {
  it("retorna HTTP 503 quando a rede cai sem cópia offline", async () => {
    const { handlers } = worker();
    let response: Promise<Response> | undefined;
    handlers.fetch({request:{url:"https://example.com/",method:"GET",mode:"navigate"},respondWith:(value:Promise<Response>) => { response = value; }});
    expect((await response)?.status).toBe(503);
  });

  it("reutiliza a cópia offline quando ela existe", async () => {
    const { handlers, match } = worker();
    match.mockResolvedValue(new Response("<html>RiffSync</html>"));
    let response: Promise<Response> | undefined;
    handlers.fetch({request:{url:"https://example.com/",method:"GET",mode:"navigate"},respondWith:(value:Promise<Response>) => { response = value; }});
    expect(await (await response)?.text()).toBe("<html>RiffSync</html>");
  });

  it("deixa o navegador tratar a navegação autenticada do Codespaces", () => {
    const { handlers, fetch } = worker("https://studio-8000.app.github.dev/");
    const respondWith = vi.fn();
    handlers.fetch({request:{url:"https://studio-8000.app.github.dev/",method:"GET",mode:"navigate"},respondWith});
    expect(respondWith).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("mantém a recuperação fora da interceptação das versões antigas", () => {
    const { handlers, fetch } = worker();
    const respondWith = vi.fn();
    handlers.fetch({request:{url:"https://example.com/api/recover",method:"GET",mode:"navigate"},respondWith});
    expect(respondWith).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
