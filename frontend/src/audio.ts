import type { Track } from "./types";

export class StudioAudio {
  private context?: AudioContext;
  private master?: GainNode;
  private sources: AudioBufferSourceNode[] = [];
  private gains = new Map<string, GainNode>();
  readonly buffers = new Map<string, AudioBuffer>();
  private offset = 0;
  private started = 0;
  private running = false;
  duration = 0;

  private init() {
    if (!this.context) {
      this.context = new AudioContext();
      this.master = this.context.createGain();
      const limiter = this.context.createDynamicsCompressor();
      limiter.threshold.value = -1;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.1;
      this.master.connect(limiter).connect(this.context.destination);
    }
    return this.context;
  }
  async decode(id: string, blob: Blob) {
    const buffer = await this.init().decodeAudioData(await blob.arrayBuffer());
    this.buffers.set(id, buffer);
    this.duration = Math.max(this.duration, buffer.duration);
    return buffer;
  }
  get playing() {
    return this.running;
  }
  get time() {
    return this.running && this.context
      ? Math.max(
          0,
          Math.min(
            this.duration,
            this.offset + this.context.currentTime - this.started,
          ),
        )
      : this.offset;
  }
  async play(tracks: Track[], at = this.offset) {
    const ctx = this.init();
    await ctx.resume();
    this.pause();
    this.offset = Math.max(0, Math.min(at, Math.max(0, this.duration - 0.001)));
    const when = ctx.currentTime + 0.025;
    this.started = when;
    for (const track of tracks) {
      const buffer = this.buffers.get(track.id);
      if (!buffer || this.offset >= buffer.duration) continue;
      const source = ctx.createBufferSource(),
        gain = ctx.createGain();
      source.buffer = buffer;
      source.connect(gain).connect(this.master!);
      this.gains.set(track.id, gain);
      this.sources.push(source);
      source.start(when, this.offset);
    }
    this.running = true;
    this.mix(tracks);
  }
  pause() {
    this.offset = this.time;
    this.running = false;
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
      source.disconnect();
    }
    for (const gain of this.gains.values()) gain.disconnect();
    this.sources = [];
    this.gains.clear();
  }
  async seek(time: number, tracks: Track[]) {
    const wasPlaying = this.running;
    this.pause();
    this.offset = Math.max(0, Math.min(this.duration, time));
    if (wasPlaying) await this.play(tracks, this.offset);
  }
  mix(tracks: Track[]) {
    const anySolo = tracks.some((t) => t.solo);
    for (const t of tracks) {
      const gain = this.gains.get(t.id);
      if (gain && this.context)
        gain.gain.setTargetAtTime(
          t.muted || (anySolo && !t.solo) ? 0 : t.volume,
          this.context.currentTime,
          0.012,
        );
    }
  }
  reset() {
    this.pause();
    this.offset = 0;
    this.duration = 0;
    this.buffers.clear();
  }
  async close() {
    this.reset();
    if (this.context) await this.context.close();
    this.context = undefined;
    this.master = undefined;
  }
}

export function peaks(buffer: AudioBuffer, count = 220): number[] {
  const data = buffer.getChannelData(0),
    step = Math.max(1, Math.floor(data.length / count));
  const result = Array.from({ length: count }, (_, i) => {
    let peak = 0;
    for (
      let j = i * step;
      j < Math.min(data.length, (i + 1) * step);
      j += Math.max(1, Math.floor(step / 100))
    )
      peak = Math.max(peak, Math.abs(data[j]));
    return peak;
  });
  const max = Math.max(...result, 0.001);
  return result.map((p) => p / max);
}

export function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels,
    length = buffer.length * channels * 2;
  const out = new ArrayBuffer(44 + length),
    view = new DataView(out);
  const str = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  view.setUint32(4, 36 + length, true);
  str(8, "WAVE");
  str(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  str(36, "data");
  view.setUint32(40, length, true);
  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++)
      view.setInt16(
        44 + (i * channels + ch) * 2,
        Math.max(-1, Math.min(1, data[i])) * 32767,
        true,
      );
  }
  return new Blob([out], { type: "audio/wav" });
}

export async function renderMix(
  buffers: Map<string, AudioBuffer>,
  tracks: Track[],
  duration: number,
): Promise<Blob> {
  const context = new OfflineAudioContext(
    2,
    Math.ceil(duration * 44100),
    44100,
  );
  const anySolo = tracks.some((t) => t.solo);
  for (const t of tracks) {
    const buffer = buffers.get(t.id);
    if (!buffer || t.muted || (anySolo && !t.solo)) continue;
    const source = context.createBufferSource(),
      gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = t.volume;
    source.connect(gain).connect(context.destination);
    source.start();
  }
  const rendered = await context.startRendering();
  let max = 1;
  for (let c = 0; c < rendered.numberOfChannels; c++) {
    const data = rendered.getChannelData(c);
    for (const value of data) max = Math.max(max, Math.abs(value));
  }
  if (max > 1)
    for (let c = 0; c < rendered.numberOfChannels; c++) {
      const data = rendered.getChannelData(c);
      for (let i = 0; i < data.length; i++) data[i] /= max;
    }
  return encodeWav(rendered);
}
