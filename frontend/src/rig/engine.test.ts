import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./dsp", () => ({
  RigGraph: class {
    input = {};
    apply = vi.fn();
    dispose = vi.fn();
  },
}));
import { LiveRig } from "./engine";
import { defaultPreset } from "./types";
const node = () => ({
  gain: { value: 0, setTargetAtTime: vi.fn() },
  connect: vi.fn(),
  disconnect: vi.fn(),
  port: { postMessage: vi.fn(), onmessage: null },
  start: vi.fn(),
  stop: vi.fn(),
  onended: null,
});
function fixture() {
  const source = node(),
    split = node();
  const ctx = {
    sampleRate: 48000,
    currentTime: 0,
    baseLatency: 0.005,
    outputLatency: 0.01,
    audioWorklet: { addModule: vi.fn(async () => {}) },
    createGain: node,
    createBufferSource: node,
    createMediaStreamSource: () => source,
    createChannelSplitter: () => split,
    resume: vi.fn(async () => {}),
    close: vi.fn(),
  };
  vi.stubGlobal(
    "AudioWorkletNode",
    class {
      port = { postMessage: vi.fn(), onmessage: null };
      connect = vi.fn();
      disconnect = vi.fn();
    },
  );
  const stop = vi.fn(),
    track = { getSettings: () => ({ channelCount: 1 }), stop, onended: null };
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  return { ctx: ctx as unknown as AudioContext, stop, stream, source, split };
}
afterEach(() => vi.unstubAllGlobals());
describe("ciclo de vida da guitarra ao vivo", () => {
  it("só captura após conectar, inicia sem retorno e cancela a gravação ao desconectar", async () => {
    const f = fixture(),
      getUserMedia = vi.fn(async () => f.stream);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    const live = new LiveRig(f.ctx, {} as AudioNode);
    expect(getUserMedia).not.toHaveBeenCalled();
    await live.connect("interface", 0, defaultPreset(), {});
    expect(live.connected).toBe(true);
    expect(live.monitoring).toBe(false);
    expect(getUserMedia.mock.calls[0]).toBeDefined();
    const recording = live.record();
    live.disconnect();
    await expect(recording).rejects.toThrow("interrompida");
    expect(f.stop).toHaveBeenCalledOnce();
    await live.dispose();
    expect(f.ctx.close).not.toHaveBeenCalled();
  });
  it("libera uma permissão que chegou após desconectar", async () => {
    const f = fixture();
    let resolve!: (s: unknown) => void;
    const getUserMedia = vi.fn(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    const live = new LiveRig(f.ctx, {} as AudioNode),
      pending = live.connect("", 0, defaultPreset(), {});
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
    live.disconnect();
    resolve(f.stream);
    await pending;
    expect(live.connected).toBe(false);
    expect(f.stop).toHaveBeenCalledOnce();
    await live.dispose();
  });
  it("isola a entrada durante A/B e restaura o retorno anterior ao parar", async () => {
    const f = fixture();
    vi.stubGlobal("navigator", {
      mediaDevices: { getUserMedia: async () => f.stream },
    });
    const live = new LiveRig(f.ctx, {} as AudioNode);
    await live.connect("", 0, defaultPreset(), {});
    live.setMonitor(true);
    await live.playReference({} as AudioBuffer);
    expect(live.monitoring).toBe(false);
    expect(f.split.disconnect).toHaveBeenCalled();
    live.stopPreview();
    expect(live.monitoring).toBe(true);
    await live.playDI({} as AudioBuffer, defaultPreset(), {});
    live.disconnect();
    expect(live.monitoring).toBe(false);
    await live.dispose();
  });
  it("reutiliza o módulo AudioWorklet ao abrir outra música no mesmo contexto", async () => {
    const f = fixture();
    const one = new LiveRig(f.ctx, {} as AudioNode);
    await one.apply(defaultPreset(), {});
    await one.dispose();
    const two = new LiveRig(f.ctx, {} as AudioNode);
    await two.apply(defaultPreset(), {});
    expect(f.ctx.audioWorklet.addModule).toHaveBeenCalledOnce();
    await two.dispose();
  });
});
