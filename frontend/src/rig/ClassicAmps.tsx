import { useState } from "react";
import {
  ampProfile,
  CLASSIC_AMPS,
  CLASSIC_BRANDS,
  type AmpProfileId,
} from "./ampProfiles";
import { classicPreset } from "./factoryPresets";
import type { RigPreset } from "./types";
export function ClassicAmps({
  preset,
  change,
}: {
  preset: RigPreset;
  change: (p: RigPreset) => void;
}) {
  const selected =
    preset.amp !== "nam" ? ampProfile(preset.ampProfile) : undefined;
  const [brand, setBrand] =
    useState<(typeof CLASSIC_BRANDS)[number]>("Marshall");
  const active = selected?.brand || brand,
    variant = preset.factoryVariant || "base";
  const choose = (id: AmpProfileId, mode: "base" | "solo" = variant) => {
    const next = classicPreset(id, mode);
    next.inputDb = preset.inputDb;
    next.outputDb = preset.outputDb;
    change(next);
  };
  return (
    <div
      className="rig-classics"
      aria-label="Amplificadores valvulados clássicos"
    >
      <div className="rig-classics-title">
        <div>
          <span>VALVULADOS CLÁSSICOS</span>
          <h3>Escolha o caráter do seu amplificador</h3>
        </div>
        <div className="rig-classic-variants">
          <button
            aria-pressed={variant === "base"}
            onClick={() => selected && choose(selected.id, "base")}
            disabled={!selected}
          >
            Base
          </button>
          <button
            aria-pressed={variant === "solo"}
            onClick={() => selected && choose(selected.id, "solo")}
            disabled={!selected}
          >
            Solo com delay
          </button>
        </div>
      </div>
      <div className="rig-classic-brands" aria-label="Marcas de referência">
        {CLASSIC_BRANDS.map((name) => (
          <button
            key={name}
            aria-label={`Timbres ${name}`}
            aria-pressed={selected?.brand === name}
            className={active === name ? "selected" : ""}
            onClick={() => {
              setBrand(name);
              if (selected?.brand !== name)
                choose(CLASSIC_AMPS.find((p) => p.brand === name)!.id);
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="rig-classic-models">
        {CLASSIC_AMPS.filter((p) => p.brand === active).map((model) => (
          <button
            key={model.id}
            aria-label={`Aplicar ${model.brand} ${model.model}`}
            aria-pressed={selected?.id === model.id}
            className={selected?.id === model.id ? "selected" : ""}
            onClick={() => choose(model.id)}
          >
            <span
              className="rig-classic-swatch"
              style={{ background: model.panel }}
            />
            <span>
              <strong>{model.model}</strong>
              <small>{model.character}</small>
            </span>
            <span className="rig-classic-cab">
              {model.cabinet.replace("x", "×")}
            </span>
          </button>
        ))}
      </div>
      <p>
        {selected
          ? `${selected.brand} ${selected.model} · ${variant === "solo" ? "solo com delay" : "base"}. Ajuste os controles abaixo e salve sua versão.`
          : "Selecione uma marca ou modelo para carregar o timbre completo."}{" "}
        <span>
          Presets DSP inspirados; não são capturas oficiais dos fabricantes.
        </span>
      </p>
    </div>
  );
}
