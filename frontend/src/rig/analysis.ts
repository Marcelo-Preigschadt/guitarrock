export type ToneFeatures = {
  spectrum: number[];
  crest: number;
  spread: number;
  rms: number;
  peak: number;
};
export function signalLevel(samples: Float32Array) {
  let energy = 0,
    peak = 0;
  for (const s of samples) {
    if (!Number.isFinite(s)) throw new Error("Áudio com amostras inválidas.");
    energy += s * s;
    peak = Math.max(peak, Math.abs(s));
  }
  return { rms: Math.sqrt(energy / Math.max(1, samples.length)), peak };
}
function fft(real: Float64Array, imag: Float64Array) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
    }
  }
  for (let length = 2; length <= n; length <<= 1) {
    const angle = (-2 * Math.PI) / length,
      wr = Math.cos(angle),
      wi = Math.sin(angle);
    for (let i = 0; i < n; i += length) {
      let ur = 1,
        ui = 0;
      for (let j = 0; j < length / 2; j++) {
        const a = i + j,
          b = a + length / 2,
          vr = real[b] * ur - imag[b] * ui,
          vi = real[b] * ui + imag[b] * ur;
        real[b] = real[a] - vr;
        imag[b] = imag[a] - vi;
        real[a] += vr;
        imag[a] += vi;
        const nr = ur * wr - ui * wi;
        ui = ur * wi + ui * wr;
        ur = nr;
      }
    }
  }
}
// Normalized log-band energy: intentionally insensitive to absolute playback level.
export function toneFeatures(
  samples: Float32Array,
  sampleRate: number,
): ToneFeatures {
  const level = signalLevel(samples);
  if (level.rms < 0.0001)
    throw new Error(
      "O trecho está silencioso. Escolha um trecho com guitarra tocando.",
    );
  const n = 2048,
    bands = 24,
    real = new Float64Array(n),
    imag = new Float64Array(n),
    energy = new Float64Array(bands),
    frames: number[] = [];
  const high = Math.min(14000, sampleRate * 0.48),
    ratio = Math.log(high / 65);
  let count = 0;
  const hop = Math.max(1024, Math.floor((samples.length - n) / 120));
  for (let offset = 0; offset + n <= samples.length; offset += hop) {
    let rms = 0;
    for (let i = 0; i < n; i++) {
      const value = samples[offset + i];
      rms += value * value;
      real[i] = value * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
      imag[i] = 0;
    }
    rms = Math.sqrt(rms / n);
    if (rms < level.rms * 0.2) continue;
    frames.push(rms);
    fft(real, imag);
    count++;
    for (let k = 1; k < n / 2; k++) {
      const hz = (k * sampleRate) / n;
      if (hz < 65 || hz >= high) continue;
      const b = Math.min(
        bands - 1,
        Math.floor((Math.log(hz / 65) / ratio) * bands),
      );
      energy[b] += real[k] ** 2 + imag[k] ** 2;
    }
  }
  if (!count) throw new Error("Trecho muito curto para analisar o timbre.");
  const total = energy.reduce((a, b) => a + b, 0),
    spectrum = Array.from(energy, (e) =>
      Math.max(-55, 10 * Math.log10(e / Math.max(total, 1e-20) + 1e-10)),
    );
  const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
  const spread =
    Math.sqrt(frames.reduce((a, b) => a + (b - avg) ** 2, 0) / frames.length) /
    avg;
  return {
    spectrum,
    crest: 20 * Math.log10(level.peak / level.rms),
    spread,
    ...level,
  };
}
export function toneDistance(a: ToneFeatures, b: ToneFeatures) {
  return (
    Math.sqrt(
      a.spectrum.reduce((sum, v, i) => sum + (v - b.spectrum[i]) ** 2, 0) /
        a.spectrum.length,
    ) +
    0.12 * Math.abs(a.crest - b.crest) +
    0.25 * Math.abs(a.spread - b.spread)
  );
}
export function calibrationWindow(
  samples: Float32Array,
  rate: number,
  seconds = 3,
) {
  const size = Math.min(samples.length, Math.floor(rate * seconds));
  if (size < rate * 1.5)
    throw new Error("Grave ao menos 2 segundos de guitarra limpa.");
  let best = 0,
    energy = -1;
  for (
    let offset = 0;
    offset + size <= samples.length;
    offset += Math.max(1, Math.floor(rate / 2))
  ) {
    let e = 0;
    for (let i = offset; i < offset + size; i += 8) e += samples[i] ** 2;
    if (e > energy) {
      energy = e;
      best = offset;
    }
  }
  return samples.slice(best, best + size);
}
