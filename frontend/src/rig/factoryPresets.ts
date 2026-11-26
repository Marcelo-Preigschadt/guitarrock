import { ampProfile, type AmpProfileId } from "./ampProfiles";
import { defaultPreset, effect, type RigPreset } from "./types";
export function classicPreset(
  id: AmpProfileId,
  variant: "base" | "solo" = "base",
): RigPreset {
  const profile = ampProfile(id)!;
  const preset = defaultPreset(
    `${profile.brand} ${profile.model} · ${variant === "solo" ? "Solo com delay" : "Base"}`,
  );
  preset.amp = profile.amp;
  preset.ampProfile = id;
  preset.factoryVariant = variant;
  preset.cabinet = profile.cabinet;
  const keys = ["gain", "bass", "mid", "treble", "presence", "master"];
  keys.forEach((key, i) => {
    effect(preset, "amp").params[key] = profile.tone[i];
  });
  effect(preset, "gate").params.threshold = -60;
  effect(preset, "cabinet").params.highcut =
    profile.brand === "Fender"
      ? 7300
      : profile.brand === "Gibson"
        ? 5500
        : profile.brand === "Orange"
          ? 5800
          : 6500;
  if (profile.reverb) {
    effect(preset, "reverb").enabled = true;
    effect(preset, "reverb").params.mix = profile.reverb;
    effect(preset, "reverb").params.decay = 1.3;
  }
  if (id === "gibson-falcon") {
    effect(preset, "tremolo").enabled = true;
    effect(preset, "tremolo").params.depth = 0.17;
    effect(preset, "tremolo").params.rate = 3.5;
  }
  if (id === "mesa-mark-iic") {
    Object.assign(effect(preset, "eq").params, {
      low: 2,
      lowmid: -1,
      mid: -2,
      highmid: 1.5,
      high: 0,
    });
  }
  if (variant === "solo") {
    effect(preset, "amp").params.gain = Math.min(
      10,
      effect(preset, "amp").params.gain + 0.8,
    );
    effect(preset, "amp").params.mid = Math.min(
      12,
      effect(preset, "amp").params.mid + 1.5,
    );
    effect(preset, "delay").enabled = true;
    Object.assign(effect(preset, "delay").params, {
      time: 375,
      feedback: 0.27,
      mix: 0.18,
    });
    effect(preset, "reverb").enabled = true;
    effect(preset, "reverb").params.mix = Math.max(profile.reverb, 0.09);
  }
  return preset;
}
