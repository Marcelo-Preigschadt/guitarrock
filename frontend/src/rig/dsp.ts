import {
  dbGain,
  EFFECTS,
  type Effect,
  type EffectKind,
  type RigPreset,
} from "./types";
export type RigContext = BaseAudioContext;
export type Block = {
  input: AudioNode;
  output: AudioNode;
  update: (params: Record<string, number>, preset: RigPreset) => void;
  dispose: () => void;
};
const smooth = (param: AudioParam, value: number, ctx: RigContext) =>
  param.setTargetAtTime(value, ctx.currentTime, 0.012);
function block(
  ctx: RigContext,
): Block & {
  input: GainNode;
  output: GainNode;
  nodes: AudioNode[];
  oscillators: OscillatorNode[];
} {
  const input = ctx.createGain(),
    output = ctx.createGain();
  const nodes: AudioNode[] = [input, output],
    oscillators: OscillatorNode[] = [];
  return {
    input,
    output,
    nodes,
    oscillators,
    update: () => {},
    dispose: () => {
      oscillators.forEach((o) => {
        try {
          o.stop();
        } catch {
          /* stopped */
        }
      });
      nodes.forEach((n) => n.disconnect());
    },
  };
}
function filter(
  ctx: RigContext,
  type: BiquadFilterType,
  frequency: number,
  q = 0.707,
): BiquadFilterNode {
  const node = ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = q;
  return node;
}
function chain(nodes: AudioNode[]) {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
}
export function driveCurve(
  kind: "soft" | "hard" | "fuzz",
): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(4096);
  for (let i = 0; i < curve.length; i++) {
    const x = (2 * i) / (curve.length - 1) - 1;
    curve[i] =
      kind === "soft"
        ? Math.tanh(2 * x) / Math.tanh(2)
        : kind === "hard"
          ? Math.max(-0.8, Math.min(0.8, x * 2)) / 0.8
          : Math.sign(x) * (1 - Math.exp(-4 * Math.abs(x)));
  }
  return curve;
}
export function reverbImpulse(ctx: RigContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(
    2,
    Math.ceil(ctx.sampleRate * seconds),
    ctx.sampleRate,
  );
  let seed = 937162;
  for (let ch = 0; ch < 2; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < data.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      data[i] =
        ((seed / 4294967296) * 2 - 1) *
        Math.pow(1 - i / data.length, 2.8) *
        0.025;
    }
  }
  return buffer;
}
export function createEffect(
  ctx: RigContext,
  kind: EffectKind,
  extras: { nam?: AudioNode; ir?: AudioBuffer; gate?: AudioNode } = {},
): Block {
  const b = block(ctx);
  const keep = (...nodes: AudioNode[]) => b.nodes.push(...nodes);
  if (kind === "gate") {
    if (extras.gate) {
      chain([b.input, extras.gate, b.output]);
      b.update = (p) => {
        const node = extras.gate as AudioWorkletNode;
        node.port.postMessage({
          type: "gate",
          threshold: p.threshold,
          release: p.release,
        });
      };
    } else {
      // Offline search: gate is omitted; it cannot infer a target timbre.
      b.input.connect(b.output);
    }
    return b;
  }
  if (kind === "boost") {
    b.input.connect(b.output);
    b.update = (p) => smooth(b.output.gain, dbGain(p.gain), ctx);
    return b;
  }
  if (kind === "compressor") {
    const node = ctx.createDynamicsCompressor();
    keep(node);
    chain([b.input, node, b.output]);
    b.update = (p) => {
      smooth(node.threshold, p.threshold, ctx);
      smooth(node.ratio, p.ratio, ctx);
      node.knee.value = 12;
      smooth(node.attack, p.attack / 1000, ctx);
      smooth(node.release, p.release / 1000, ctx);
    };
    return b;
  }
  if (["overdrive", "distortion", "fuzz", "amp"].includes(kind)) {
    const pre = ctx.createGain(),
      shaper = ctx.createWaveShaper(),
      low = filter(ctx, "lowpass", 6500),
      bass = filter(ctx, "lowshelf", 180),
      mid = filter(ctx, "peaking", 850, 0.8),
      treble = filter(ctx, "highshelf", 2600),
      presence = filter(ctx, "peaking", 4200, 0.7);
    shaper.oversample = "4x";
    let mode = "";
    keep(pre, shaper, low, bass, mid, treble, presence);
    // A NAM capture replaces the nonlinear amp stage; generic tone controls follow it.
    chain([
      b.input,
      pre,
      kind === "amp" && extras.nam ? extras.nam : shaper,
      bass,
      mid,
      treble,
      presence,
      low,
      b.output,
    ]);
    b.update = (p, preset) => {
      const selected = kind === "amp" ? preset.amp : kind;
      if (selected !== mode) {
        mode = selected;
        shaper.curve = driveCurve(
          selected === "fuzz"
            ? "fuzz"
            : selected === "distortion" || selected === "highgain"
              ? "hard"
              : "soft",
        );
      }
      const gain = kind === "amp" ? p.gain : p.drive;
      const amount =
        selected === "clean"
          ? 0.4 + gain * 0.16
          : selected === "nam"
            ? dbGain((gain - 3) * 2)
            : 1 +
              gain *
                (selected === "fuzz" ? 4 : selected === "highgain" ? 3 : 1.5);
      smooth(pre.gain, amount, ctx);
      smooth(
        b.output.gain,
        dbGain(kind === "amp" ? p.master : p.level) /
          (selected === "nam" ? 1 : Math.sqrt(Math.max(1, amount))),
        ctx,
      );
      smooth(low.frequency, kind === "amp" ? 11000 : p.tone, ctx);
      if (kind === "amp") {
        smooth(bass.gain, p.bass, ctx);
        smooth(mid.gain, p.mid, ctx);
        smooth(treble.gain, p.treble, ctx);
        smooth(presence.gain, p.presence, ctx);
      }
    };
    return b;
  }
  if (kind === "cabinet") {
    const hp = filter(ctx, "highpass", 75),
      lp = filter(ctx, "lowpass", 6500),
      body = filter(ctx, "peaking", 160, 0.9),
      notch = filter(ctx, "peaking", 1800, 0.7);
    keep(hp, lp, body, notch);
    if (extras.ir) {
      const convolution = ctx.createConvolver();
      convolution.normalize = true;
      convolution.buffer = extras.ir;
      keep(convolution);
      chain([b.input, convolution, hp, lp, b.output]);
    } else chain([b.input, hp, body, notch, lp, b.output]);
    b.update = (p, preset) => {
      smooth(hp.frequency, p.lowcut, ctx);
      smooth(lp.frequency, p.highcut, ctx);
      const [hz, gain, cut] =
        preset.cabinet === "1x12"
          ? [230, 1.5, -1]
          : preset.cabinet === "4x12"
            ? [130, 4, -3]
            : [180, 2.5, -2];
      smooth(body.frequency, hz, ctx);
      smooth(body.gain, gain, ctx);
      smooth(notch.gain, cut, ctx);
    };
    return b;
  }
  if (kind === "eq") {
    const nodes = [
      filter(ctx, "lowshelf", 120),
      filter(ctx, "peaking", 400, 0.8),
      filter(ctx, "peaking", 1000, 0.8),
      filter(ctx, "peaking", 2500, 0.8),
      filter(ctx, "highshelf", 6000),
    ];
    keep(...nodes);
    chain([b.input, ...nodes, b.output]);
    b.update = (p) =>
      ["low", "lowmid", "mid", "highmid", "high"].forEach((key, i) =>
        smooth(nodes[i].gain, p[key], ctx),
      );
    return b;
  }
  if (kind === "tremolo") {
    const gain = ctx.createGain(),
      lfo = ctx.createOscillator(),
      depth = ctx.createGain();
    b.oscillators.push(lfo);
    keep(gain, lfo, depth);
    chain([b.input, gain, b.output]);
    lfo.connect(depth).connect(gain.gain);
    lfo.start();
    b.update = (p) => {
      smooth(lfo.frequency, p.rate, ctx);
      smooth(depth.gain, p.depth * 0.5, ctx);
      smooth(gain.gain, 1 - p.depth * 0.5, ctx);
    };
    return b;
  }
  if (["chorus", "phaser", "flanger", "delay", "reverb"].includes(kind)) {
    const dry = ctx.createGain(),
      wet = ctx.createGain();
    keep(dry, wet);
    chain([b.input, dry, b.output]);
    wet.connect(b.output);
    let updateWet: (p: Record<string, number>) => void = () => {};
    if (kind === "reverb") {
      const conv = ctx.createConvolver();
      keep(conv);
      chain([b.input, conv, wet]);
      let last = 0;
      updateWet = (p) => {
        if (last !== p.decay) {
          last = p.decay;
          conv.buffer = reverbImpulse(ctx, p.decay);
        }
      };
    } else if (kind === "phaser") {
      const lfo = ctx.createOscillator(),
        depth = ctx.createGain(),
        stages = [500, 1000, 1800, 3200].map((hz) =>
          filter(ctx, "allpass", hz, 0.6),
        );
      keep(lfo, depth, ...stages);
      b.oscillators.push(lfo);
      chain([b.input, ...stages, wet]);
      lfo.connect(depth);
      stages.forEach((n) => depth.connect(n.frequency));
      lfo.start();
      updateWet = (p) => {
        smooth(lfo.frequency, p.rate, ctx);
        smooth(depth.gain, p.depth * 400, ctx);
      };
    } else {
      const delay = ctx.createDelay(3),
        feedback = ctx.createGain();
      keep(delay, feedback);
      chain([b.input, delay, wet]);
      delay.connect(feedback).connect(delay);
      if (kind === "delay")
        updateWet = (p) => {
          smooth(delay.delayTime, p.time / 1000, ctx);
          smooth(feedback.gain, Math.min(0.8, p.feedback), ctx);
        };
      else {
        const lfo = ctx.createOscillator(),
          depth = ctx.createGain();
        keep(lfo, depth);
        b.oscillators.push(lfo);
        lfo.connect(depth).connect(delay.delayTime);
        lfo.start();
        updateWet = (p) => {
          smooth(lfo.frequency, p.rate, ctx);
          smooth(delay.delayTime, kind === "chorus" ? 0.018 : 0.004, ctx);
          smooth(
            depth.gain,
            p.depth * (kind === "chorus" ? 0.004 : 0.002),
            ctx,
          );
          smooth(feedback.gain, kind === "flanger" ? p.feedback : 0, ctx);
        };
      }
    }
    b.update = (p) => {
      smooth(dry.gain, 1 - p.mix, ctx);
      smooth(wet.gain, p.mix, ctx);
      updateWet(p);
    };
    return b;
  }
  throw new Error(`Efeito não suportado: ${kind}`);
}
export class RigGraph {
  readonly input: GainNode;
  readonly output: GainNode;
  private blocks = new Map<EffectKind, Block>();
  private route = "";
  private disposed = false;
  constructor(
    readonly context: RigContext,
    readonly destination: AudioNode,
    readonly extras: {
      nam?: AudioNode;
      ir?: AudioBuffer;
      gate?: AudioNode;
    } = {},
  ) {
    this.input = context.createGain();
    this.output = context.createGain();
    this.output.connect(destination);
  }
  apply(preset: RigPreset) {
    if (this.disposed) return;
    const enabled = preset.bypass
      ? []
      : preset.effects.filter((e) => e.enabled);
    for (const e of enabled) {
      let b = this.blocks.get(e.kind);
      if (!b) {
        b = createEffect(this.context, e.kind, this.extras);
        this.blocks.set(e.kind, b);
      }
      b.update(e.params, preset);
    }
    const route = enabled.map((e) => e.kind).join("/");
    if (route !== this.route || this.route === "") {
      this.route = route;
      this.input.disconnect();
      this.blocks.forEach((b) => b.output.disconnect());
      let head: AudioNode = this.input;
      for (const e of enabled) {
        const b = this.blocks.get(e.kind)!;
        head.connect(b.input);
        head = b.output;
      }
      head.connect(this.output);
    }
    smooth(this.input.gain, dbGain(preset.inputDb), this.context);
    smooth(this.output.gain, dbGain(preset.outputDb), this.context);
  }
  dispose() {
    this.disposed = true;
    this.input.disconnect();
    this.output.disconnect();
    this.blocks.forEach((b) => b.dispose());
    this.blocks.clear();
  }
}
export async function renderPreset(
  samples: Float32Array,
  sampleRate: number,
  preset: RigPreset,
): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, samples.length, sampleRate);
  const buffer = ctx.createBuffer(1, samples.length, sampleRate);
  buffer.copyToChannel(new Float32Array(samples), 0);
  const graph = new RigGraph(ctx, ctx.destination);
  graph.apply(preset);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.connect(graph.input);
  source.start();
  try {
    return new Float32Array((await ctx.startRendering()).getChannelData(0));
  } finally {
    graph.dispose();
  }
}
export function defaultsFor(kind: EffectKind): Effect {
  return {
    kind,
    enabled: true,
    params: Object.fromEntries(
      EFFECTS[kind].controls.map((c) => [c.key, c.initial]),
    ),
  };
}
