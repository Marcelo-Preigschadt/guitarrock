import { ArrowDown, ArrowUp, Power } from "lucide-react";
import { Knob } from "./ControlKnob";
import {
  EFFECTS,
  effect,
  type EffectKind,
  type RigAssets,
  type RigPreset,
} from "./types";
type Props = {
  preset: RigPreset;
  assets: RigAssets;
  change: (preset: RigPreset) => void;
  select: (kind: EffectKind) => void;
};
export function GearRack({ preset, assets, change, select }: Props) {
  const amp = effect(preset, "amp"),
    cab = effect(preset, "cabinet");
  const toggle = (kind: EffectKind) =>
    change({
      ...preset,
      effects: preset.effects.map((e) =>
        e.kind === kind ? { ...e, enabled: !e.enabled } : e,
      ),
    });
  const move = (kind: EffectKind, direction: number) => {
    const list = [...preset.effects],
      at = list.findIndex((e) => e.kind === kind),
      to = at + direction;
    if (to < 0 || to >= list.length) return;
    [list[at], list[to]] = [list[to], list[at]];
    change({ ...preset, effects: list });
  };
  const order = (kind: EffectKind) => (
    <div className="rig-rack-order">
      <span>
        Posição {preset.effects.findIndex((e) => e.kind === kind) + 1} na cadeia
      </span>
      <button
        title="Mover antes"
        aria-label={`Mover ${EFFECTS[kind].name} antes`}
        disabled={preset.effects[0].kind === kind}
        onClick={() => move(kind, -1)}
      >
        <ArrowUp size={12} />
      </button>
      <button
        title="Mover depois"
        aria-label={`Mover ${EFFECTS[kind].name} depois`}
        disabled={preset.effects.at(-1)?.kind === kind}
        onClick={() => move(kind, 1)}
      >
        <ArrowDown size={12} />
      </button>
    </div>
  );
  const cabs = ["1x12", "2x12", "4x12"] as const;
  return (
    <div className="rig-stage" aria-label="Amplificador e caixas de guitarra">
      <div className={`rig-amp-head ${amp.enabled ? "powered" : ""}`}>
        <div className="rig-amp-handle" aria-hidden="true" />
        <div className="rig-amp-grille">
          <span className="rig-amp-logo">
            riff<span>sync</span>
          </span>
          <span className="rig-amp-model">
            {preset.amp === "nam"
              ? "NEURAL CAPTURE"
              : preset.amp === "highgain"
                ? "HIGH GAIN"
                : preset.amp.toUpperCase()}
          </span>
          <span className="rig-amp-badge">AMPLIFICADOR VIRTUAL</span>
        </div>
        <div className="rig-amp-controls">
          <div className="rig-amp-toprow">
            <div className="rig-amp-models" aria-label="Tipos de amplificador">
              {(
                [
                  ["clean", "Clean"],
                  ["crunch", "Crunch"],
                  ["highgain", "High gain"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  aria-pressed={preset.amp === value}
                  className={preset.amp === value ? "active" : ""}
                  onClick={() => change({ ...preset, amp: value })}
                >
                  {label}
                </button>
              ))}
              {Object.values(assets).some((a) => a.kind === "nam") && (
                <button
                  className={preset.amp === "nam" ? "active" : ""}
                  aria-pressed={preset.amp === "nam"}
                  onClick={() => {
                    const id =
                      preset.namAsset ||
                      Object.keys(assets).find(
                        (id) => assets[id].kind === "nam",
                      );
                    change({ ...preset, amp: "nam", namAsset: id });
                  }}
                >
                  NAM
                </button>
              )}
            </div>
            <button
              className="rig-amp-power"
              aria-label={`${amp.enabled ? "Desligar" : "Ligar"} Amplificador`}
              aria-pressed={amp.enabled}
              onClick={() => toggle("amp")}
            >
              <i />
              <Power size={15} />
            </button>
          </div>
          <div className="rig-amp-knobs">
            {EFFECTS.amp.controls.map((c) => (
              <Knob
                key={c.key}
                control={c}
                value={amp.params[c.key]}
                onChange={(value) =>
                  change({
                    ...preset,
                    effects: preset.effects.map((e) =>
                      e.kind === "amp"
                        ? { ...e, params: { ...e.params, [c.key]: value } }
                        : e,
                    ),
                  })
                }
              />
            ))}
          </div>
          {order("amp")}
          <button className="rig-rack-details" onClick={() => select("amp")}>
            Capturas NAM e opções do amplificador ↓
          </button>
        </div>
      </div>
      <div className="rig-cabinets">
        <div className="rig-cabinets-heading">
          <div>
            <span>CAIXAS ACÚSTICAS</span>
            <h3>Escolha seu gabinete</h3>
          </div>
          <button
            className="rig-cab-power"
            aria-label={`${cab.enabled ? "Desligar" : "Ligar"} Caixa / gabinete`}
            aria-pressed={cab.enabled}
            onClick={() => toggle("cabinet")}
          >
            <Power size={14} />
            {cab.enabled ? "Ligada" : "Bypass"}
          </button>
        </div>
        <div className="rig-cab-options">
          {cabs.map((model) => (
            <button
              className={`rig-cab-option ${preset.cabinet === model ? "selected" : ""}`}
              key={model}
              aria-label={`Caixa ${model.replace("x", "×")}`}
              aria-pressed={preset.cabinet === model}
              onClick={() => change({ ...preset, cabinet: model })}
            >
              <span
                className={`rig-cab-box speakers-${model[0]}`}
                aria-hidden="true"
              >
                <span className="rig-cab-mark">RS</span>
                <span className="rig-speakers">
                  {Array.from({ length: Number(model[0]) }, (_, i) => (
                    <i key={i}>
                      <b />
                    </i>
                  ))}
                </span>
                <span className="rig-cab-corner top-left" />
                <span className="rig-cab-corner bottom-right" />
              </span>
              <strong>{model.replace("x", "×")}</strong>
              <small>
                {preset.cabinet === model ? "Selecionada" : "Selecionar caixa"}
              </small>
            </button>
          ))}
        </div>
        {preset.cabinet === "ir" && (
          <p className="rig-current-ir">
            IR selecionado:{" "}
            {assets[preset.irAsset || ""]?.name || "Escolha um arquivo"}
          </p>
        )}
        {order("cabinet")}
        <button className="rig-rack-details" onClick={() => select("cabinet")}>
          Importar IR e ajustar a caixa ↓
        </button>
      </div>
      <div className="rig-signal-order">
        <span>ORDEM DO SINAL</span>
        <ol>
          {preset.effects
            .filter((e) => e.enabled)
            .map((e) => (
              <li key={e.kind}>
                <button onClick={() => select(e.kind)}>
                  {EFFECTS[e.kind].name}
                </button>
              </li>
            ))}
        </ol>
      </div>
    </div>
  );
}
