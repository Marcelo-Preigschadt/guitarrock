import type { Control } from "./types";
export function Knob({
  control: c,
  value,
  onChange,
  scope,
}: {
  control: Control;
  scope?: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const percent = (value - c.min) / (c.max - c.min),
    angle = -135 + percent * 270;
  return (
    <label className="rig-knob">
      <span
        className="rig-knob-dial"
        style={{ "--knob-angle": `${angle}deg` } as React.CSSProperties}
      >
        <i />
      </span>
      <span>{c.label}</span>
      <output>
        {Number.isInteger(value) ? value : value.toFixed(c.step < 0.1 ? 2 : 1)}{" "}
        {c.unit}
      </output>
      <input
        type="range"
        aria-label={scope ? `${c.label} · ${scope}` : c.label}
        min={c.min}
        max={c.max}
        step={c.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
