/* RiffSync real-time input metering, bounded DI capture, and a noise gate. */
class RigInput extends AudioWorkletProcessor {
  constructor() {
    super();
    this.alive = true;
    this.frames = 0;
    this.sum = 0;
    this.peak = 0;
    this.recording = null;
    this.offset = 0;
    this.port.onmessage = (event) => {
      if (event.data.type === "dispose") {
        this.alive = false;
        this.recording = null;
      }
      if (event.data.type === "record") {
        this.recording = new Float32Array(
          (Math.min(20, Math.max(1, event.data.seconds)) * sampleRate) | 0,
        );
        this.offset = 0;
      }
      if (event.data.type === "cancel") this.recording = null;
    };
  }
  process(inputs, outputs) {
    if (!this.alive) return false;
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;
    for (let i = 0; i < output.length; i++) {
      const x = input?.[i] || 0;
      output[i] = x;
      this.sum += x * x;
      this.peak = Math.max(this.peak, Math.abs(x));
      this.frames++;
      if (this.recording) {
        this.recording[this.offset++] = x;
        if (this.offset === this.recording.length) {
          const pcm = this.recording;
          this.recording = null;
          this.port.postMessage({ type: "recorded", pcm }, [pcm.buffer]);
        }
      }
    }
    if (this.frames >= 2048) {
      this.port.postMessage({
        type: "meter",
        rms: Math.sqrt(this.sum / this.frames),
        peak: this.peak,
      });
      this.frames = 0;
      this.sum = 0;
      this.peak = 0;
    }
    return true;
  }
}
class RigGate extends AudioWorkletProcessor {
  constructor() {
    super();
    this.alive = true;
    this.threshold = Math.pow(10, -55 / 20);
    this.release = 0.1;
    this.env = 0;
    this.gain = 0;
    this.port.onmessage = (e) => {
      if (e.data.type === "dispose") this.alive = false;
      if (e.data.type === "gate") {
        this.threshold = Math.pow(
          10,
          Math.max(-80, Math.min(-15, e.data.threshold)) / 20,
        );
        this.release = Math.max(0.02, Math.min(0.4, e.data.release / 1000));
      }
    };
  }
  process(inputs, outputs) {
    if (!this.alive) return false;
    const input = inputs[0]?.[0],
      output = outputs[0]?.[0];
    if (!output) return true;
    const release = Math.exp(-1 / (sampleRate * this.release));
    const attack = Math.exp(-1 / (sampleRate * 0.002));
    for (let i = 0; i < output.length; i++) {
      const x = input?.[i] || 0;
      this.env = Math.max(Math.abs(x), this.env * release);
      const target = this.env > this.threshold ? 1 : 0;
      const coefficient = target > this.gain ? attack : release;
      this.gain = target + (this.gain - target) * coefficient;
      output[i] = x * this.gain;
    }
    return true;
  }
}
registerProcessor("riffsync-rig-input", RigInput);
registerProcessor("riffsync-rig-gate", RigGate);
