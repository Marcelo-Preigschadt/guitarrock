import { RigGraph } from "./dsp";
import { type RigAssets, type RigPreset } from "./types";
import type { NamNode } from "neural-amp-modeler-wasm/engine";
const inputModules = new WeakMap<AudioContext, Promise<void>>();
function registerInput(context: AudioContext) {
  let pending = inputModules.get(context);
  if (!pending) {
    pending = context.audioWorklet
      .addModule(`${import.meta.env.BASE_URL}rig-worklet.js`)
      .catch((error) => {
        inputModules.delete(context);
        throw error;
      });
    inputModules.set(context, pending);
  }
  return pending;
}
export class LiveRig {
  private graph?: RigGraph;
  private graphKey = "";
  private source?: MediaStreamAudioSourceNode;
  private split?: ChannelSplitterNode;
  private stream?: MediaStream;
  private tap?: AudioWorkletNode;
  private gate?: AudioWorkletNode;
  private monitor: GainNode;
  private preview?: AudioBufferSourceNode;
  private nam?: NamNode;
  private worklets?: Promise<void>;
  private namKey = "";
  private irKey = "";
  private ir?: AudioBuffer;
  private recorder?: {
    timer: ReturnType<typeof setTimeout>;
    resolve: (samples: Float32Array) => void;
    reject: (error: Error) => void;
  };
  private generation = 0;
  private applying = 0;
  private disposed = false;
  private inputChannel = 0;
  private previewMonitor?: boolean;
  onMeter: (level: { rms: number; peak: number }) => void = () => {};
  onDisconnect: () => void = () => {};
  onMonitor: (enabled: boolean) => void = () => {};
  connected = false;
  monitoring = false;
  constructor(
    readonly context: AudioContext,
    readonly destination: AudioNode,
  ) {
    this.monitor = context.createGain();
    this.monitor.gain.value = 0;
    this.monitor.connect(destination);
  }
  private async ready() {
    if (!this.context.audioWorklet)
      throw new Error(
        "AudioWorklet indisponível. Abra o app por HTTPS em um navegador compatível.",
      );
    this.worklets ||= registerInput(this.context).catch((error) => {
      this.worklets = undefined;
      throw error;
    });
    await this.worklets;
    if (this.disposed)
      throw new DOMException("Pedaleira encerrada", "AbortError");
    if (!this.tap) {
      this.tap = new AudioWorkletNode(this.context, "riffsync-rig-input", {
        channelCount: 1,
        channelCountMode: "explicit",
        outputChannelCount: [1],
      });
      this.tap.port.onmessage = (e) => {
        if (e.data.type === "meter") this.onMeter(e.data);
        if (e.data.type === "recorded" && this.recorder) {
          clearTimeout(this.recorder.timer);
          this.recorder.resolve(e.data.pcm);
          this.recorder = undefined;
        }
      };
    }
    if (!this.gate)
      this.gate = new AudioWorkletNode(this.context, "riffsync-rig-gate", {
        channelCount: 1,
        channelCountMode: "explicit",
        outputChannelCount: [1],
      });
  }
  async apply(preset: RigPreset, assets: RigAssets) {
    const applying = ++this.applying,
      generation = this.generation;
    await this.ready();
    if (generation !== this.generation || applying !== this.applying) return;
    let nam: NamNode | undefined, ir: AudioBuffer | undefined;
    if (
      preset.amp === "nam" &&
      preset.effects.some((e) => e.kind === "amp" && e.enabled) &&
      !preset.bypass
    ) {
      const asset = assets[preset.namAsset || ""];
      if (!asset)
        throw new Error("Importe uma captura NAM para esse amplificador.");
      if (this.namKey !== preset.namAsset) {
        this.setMonitor(false);
        const { NamEngine } = await import("neural-amp-modeler-wasm/engine");
        const engine = await NamEngine.attach(this.context);
        const node = await engine.createNode();
        try {
          const info = await node.loadModel(await asset.blob.text());
          if (
            info.expectedSampleRate &&
            info.expectedSampleRate !== this.context.sampleRate
          )
            throw new Error(
              `A captura usa ${info.expectedSampleRate} Hz. Use uma captura de ${this.context.sampleRate} Hz.`,
            );
        } catch (error) {
          await node.dispose();
          throw error;
        }
        if (generation !== this.generation || applying !== this.applying) {
          await node.dispose();
          return;
        }
        await this.nam?.dispose();
        this.nam = node;
        this.namKey = preset.namAsset!;
      }
      nam = this.nam;
    }
    if (
      preset.cabinet === "ir" &&
      preset.effects.some((e) => e.kind === "cabinet" && e.enabled) &&
      !preset.bypass
    ) {
      const asset = assets[preset.irAsset || ""];
      if (!asset) throw new Error("Importe uma resposta a impulso de caixa.");
      if (this.irKey !== preset.irAsset) {
        const decoded = await this.context.decodeAudioData(
          await asset.blob.arrayBuffer(),
        );
        if (decoded.duration > 5 || decoded.numberOfChannels > 2)
          throw new Error(
            "Use um IR de caixa mono/estéreo com até 5 segundos.",
          );
        this.ir = decoded;
        this.irKey = preset.irAsset!;
      }
      ir = this.ir;
    }
    if (generation !== this.generation || applying !== this.applying) return;
    const key = `${nam ? this.namKey : "dsp"}/${ir ? this.irKey : "dsp"}`;
    if (!this.graph || key !== this.graphKey) {
      this.tap!.disconnect();
      this.graph?.dispose();
      this.nam?.disconnect();
      this.gate?.disconnect();
      this.graph = new RigGraph(this.context, this.monitor, {
        nam,
        ir,
        gate: this.gate,
      });
      this.tap!.connect(this.graph.input);
      this.graphKey = key;
    }
    this.graph.apply(preset);
  }
  async connect(
    deviceId: string,
    channel: number,
    preset: RigPreset,
    assets: RigAssets,
  ) {
    this.disconnect();
    const generation = this.generation;
    await this.context.resume();
    await this.apply(preset, assets);
    if (!navigator.mediaDevices?.getUserMedia)
      throw new Error("Entrada de áudio indisponível. Abra o app por HTTPS.");
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        channelCount: { ideal: 2 },
        sampleRate: { ideal: this.context.sampleRate },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    if (generation !== this.generation) {
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    try {
      const settings = stream.getAudioTracks()[0].getSettings();
      const channels = settings.channelCount || 2;
      if (channel >= channels)
        throw new Error(
          `Essa entrada tem ${channels} canal(is). Selecione o canal 1.`,
        );
      this.stream = stream;
      this.source = this.context.createMediaStreamSource(stream);
      this.split = this.context.createChannelSplitter(Math.max(2, channels));
      this.source.connect(this.split);
      this.split.connect(this.tap!, channel, 0);
      this.inputChannel = channel;
      this.connected = true;
      stream.getAudioTracks()[0].onended = () => {
        this.disconnect();
        this.onDisconnect();
      };
      return settings;
    } catch (error) {
      stream.getTracks().forEach((t) => t.stop());
      throw error;
    }
  }
  setMonitor(enabled: boolean) {
    this.monitoring = enabled;
    this.onMonitor(enabled);
    this.monitor.gain.setTargetAtTime(
      enabled ? 1 : 0,
      this.context.currentTime,
      0.012,
    );
  }
  record(seconds = 6): Promise<Float32Array> {
    if (!this.connected)
      return Promise.reject(
        new Error("Conecte a entrada da guitarra antes de gravar."),
      );
    if (this.recorder)
      return Promise.reject(new Error("A gravação já está em andamento."));
    return new Promise((resolve, reject) => {
      this.recorder = {
        resolve,
        reject,
        timer: setTimeout(
          () => {
            this.recorder = undefined;
            this.tap?.port.postMessage({ type: "cancel" });
            reject(
              new Error(
                "A captura de áudio foi interrompida. Confira se a aba e a entrada continuam ativas.",
              ),
            );
          },
          (seconds + 4) * 1000,
        ),
      };
      this.tap!.port.postMessage({ type: "record", seconds });
    });
  }
  private isolatePreview() {
    this.previewMonitor = this.monitoring;
    this.split?.disconnect();
  }
  async playDI(buffer: AudioBuffer, preset: RigPreset, assets: RigAssets) {
    await this.context.resume();
    await this.apply(preset, assets);
    this.stopPreview();
    this.isolatePreview();
    this.preview = this.context.createBufferSource();
    this.preview.buffer = buffer;
    this.preview.connect(this.tap!);
    this.preview.onended = () => this.stopPreview();
    this.preview.start();
    this.setMonitor(true);
  }
  async playReference(buffer: AudioBuffer) {
    await this.context.resume();
    this.stopPreview();
    this.isolatePreview();
    this.setMonitor(false);
    this.preview = this.context.createBufferSource();
    this.preview.buffer = buffer;
    this.preview.connect(this.destination);
    this.preview.onended = () => this.stopPreview();
    this.preview.start();
  }
  stopPreview() {
    if (this.preview) {
      this.preview.onended = null;
      try {
        this.preview.stop();
      } catch {
        /* ended */
      }
      this.preview.disconnect();
      this.preview = undefined;
    }
    if (this.previewMonitor !== undefined) {
      if (this.connected) this.split?.connect(this.tap!, this.inputChannel, 0);
      this.setMonitor(this.connected && this.previewMonitor);
      this.previewMonitor = undefined;
    }
  }
  disconnect() {
    this.generation++;
    this.applying++;
    this.connected = false;
    this.stopPreview();
    this.setMonitor(false);
    this.source?.disconnect();
    this.split?.disconnect();
    this.source = undefined;
    this.split = undefined;
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.stream = undefined;
    if (this.recorder) {
      clearTimeout(this.recorder.timer);
      this.recorder.reject(new Error("Gravação interrompida."));
      this.recorder = undefined;
    }
    this.tap?.port.postMessage({ type: "cancel" });
  }
  async dispose() {
    this.disposed = true;
    this.disconnect();
    this.tap?.port.postMessage({ type: "dispose" });
    this.gate?.port.postMessage({ type: "dispose" });
    this.tap?.disconnect();
    this.gate?.disconnect();
    this.graph?.dispose();
    this.monitor.disconnect();
    await this.nam?.dispose();
  }
  get outputLatency() {
    return (
      (this.context.baseLatency + (this.context.outputLatency || 0)) * 1000
    );
  }
}
export function audioBufferFrom(
  ctx: BaseAudioContext,
  samples: Float32Array,
  sampleRate: number,
) {
  const buffer = ctx.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(new Float32Array(samples), 0);
  return buffer;
}
export function mono(
  buffer: AudioBuffer,
  start = 0,
  seconds = buffer.duration,
): Float32Array {
  const left = Math.max(0, Math.floor(start * buffer.sampleRate)),
    length = Math.min(
      buffer.length - left,
      Math.floor(seconds * buffer.sampleRate),
    );
  if (length <= 0) throw new Error("O trecho de áudio está vazio.");
  const result = new Float32Array(length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i++)
      result[i] += data[left + i] / buffer.numberOfChannels;
  }
  return result;
}
export function pcmWav(samples: Float32Array, sampleRate: number): Blob {
  const bytes = new ArrayBuffer(44 + samples.length * 2),
    v = new DataView(bytes);
  const text = (at: number, s: string) =>
    [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  v.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  text(36, "data");
  v.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) =>
    v.setInt16(
      44 + i * 2,
      Math.round(Math.max(-1, Math.min(1, sample)) * 32767),
      true,
    ),
  );
  return new Blob([bytes], { type: "audio/wav" });
}
