import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  AudioLines,
  Guitar,
  LoaderCircle,
  Mic,
  Play,
  Power,
  Save,
  Square,
  Trash2,
  Upload,
  WandSparkles,
  X,
} from "lucide-react";
import { download } from "../storage";
import type { Track } from "../types";
import { calibrationWindow, signalLevel } from "./analysis";
import { audioBufferFrom, LiveRig, mono, pcmWav } from "./engine";
import { matchTone } from "./matcher";
import {
  defaultPreset,
  EFFECTS,
  type EffectKind,
  type RigAssets,
  type RigPreset,
  type RigState,
  validatePreset,
} from "./types";
import { Knob } from "./ControlKnob";
import { GearRack } from "./GearRack";
import "./rig.css";

type Props = {
  state: RigState;
  assets: RigAssets;
  tracks: Track[];
  time: number;
  onChange: (state: RigState) => void;
  onAssets: (assets: RigAssets) => void;
  routing: () => { context: AudioContext; destination: AudioNode };
  reference: (
    trackId: string,
    start: number,
    seconds: number,
    signal: AbortSignal,
  ) => Promise<AudioBuffer>;
  muteReference: (id: string) => void;
};
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
export function RigPanel({
  state,
  assets,
  tracks,
  time,
  onChange,
  onAssets,
  routing,
  reference,
  muteReference,
}: Props) {
  const rig = useRef<LiveRig | undefined>(undefined);
  const mounted = useRef(true),
    matching = useRef<AbortController | undefined>(undefined);
  const [error, setError] = useState(""),
    [status, setStatus] = useState(""),
    [connected, setConnected] = useState(false),
    [monitoring, setMonitoring] = useState(false),
    [working, setWorking] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [device, setDevice] = useState(""),
    [channel, setChannel] = useState(0),
    [output, setOutput] = useState(""),
    [latency, setLatency] = useState(0);
  const [meter, setMeter] = useState({ rms: 0, peak: 0 }),
    [progress, setProgress] = useState(0),
    [report, setReport] = useState("");
  const [selected, setSelected] = useState<EffectKind>("amp"),
    [compare, setCompare] = useState<"A" | "B" | null>(null);
  const [referenceReady, setReferenceReady] = useState(false),
    [referenceName, setReferenceName] = useState("");
  const target = useRef<AudioBuffer | undefined>(undefined);
  const calibration = useRef<{ id: string; buffer: AudioBuffer } | undefined>(
    undefined,
  );
  const preset = state.current,
    fx = preset.effects.find((e) => e.kind === selected)!;
  const refTrack =
    state.reference?.trackId ||
    tracks.find((t) => t.kind === "guitar")?.id ||
    "";
  const start = state.reference?.start || 0,
    seconds = state.reference?.seconds || 8;
  const assetInput = useRef<HTMLInputElement>(null),
    refInput = useRef<HTMLInputElement>(null),
    presetInput = useRef<HTMLInputElement>(null),
    importKind = useRef<"ir" | "nam" | "di">("ir");
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      matching.current?.abort();
      void rig.current?.dispose();
      rig.current = undefined;
    };
  }, []);
  useEffect(() => {
    if (!rig.current) return;
    void rig.current
      .apply(preset, assets)
      .then(() => {
        if (mounted.current) setMonitoring(rig.current?.monitoring || false);
      })
      .catch((e) => {
        rig.current?.setMonitor(false);
        if (mounted.current) {
          setMonitoring(false);
          setError(errorText(e));
        }
      });
  }, [preset, assets]);
  const ensure = () => {
    if (!rig.current) {
      const route = routing();
      const live = new LiveRig(route.context, route.destination);
      live.onMonitor = (enabled) => {
        if (mounted.current) setMonitoring(enabled);
      };
      live.onMeter = (level) => {
        if (mounted.current) setMeter(level);
      };
      live.onDisconnect = () => {
        if (mounted.current) {
          setConnected(false);
          setMonitoring(false);
          setStatus("Entrada desconectada.");
        }
      };
      rig.current = live;
    }
    return rig.current;
  };
  const run = async (label: string, fn: () => Promise<void>) => {
    setError("");
    setWorking(label);
    try {
      await fn();
    } catch (e) {
      if (
        mounted.current &&
        !(e instanceof DOMException && e.name === "AbortError")
      )
        setError(errorText(e));
    } finally {
      if (mounted.current) setWorking("");
    }
  };
  const change = (next: RigPreset) => {
    onChange({ ...state, current: next });
    setCompare(null);
  };
  const param = (key: string, value: number) =>
    change({
      ...preset,
      effects: preset.effects.map((e) =>
        e.kind === selected
          ? { ...e, params: { ...e.params, [key]: value } }
          : e,
      ),
    });
  const scan = async () => {
    if (!navigator.mediaDevices?.enumerateDevices)
      throw new Error("Entrada de áudio indisponível. Use HTTPS.");
    setDevices(await navigator.mediaDevices.enumerateDevices());
  };
  const connect = () =>
    run("Conectando entrada", async () => {
      const live = ensure();
      await live.connect(device, channel, preset, assets);
      if (!mounted.current) return;
      setConnected(live.connected);
      setMonitoring(false);
      setLatency(live.outputLatency);
      await scan();
      setStatus(
        "Entrada conectada. Ative o retorno para ouvir a guitarra com os efeitos.",
      );
    });
  const disconnect = () => {
    rig.current?.disconnect();
    setConnected(false);
    setMonitoring(false);
    setMeter({ rms: 0, peak: 0 });
  };
  const selectReference = (id: string, left = start, length = seconds) => {
    onChange({
      ...state,
      reference: { trackId: id, start: left, seconds: length },
    });
    target.current = undefined;
    setReferenceReady(false);
    setReport("");
  };
  const loadReference = async () => {
    if (!refTrack)
      throw new Error(
        "Selecione a pista da guitarra ou importe um trecho de referência.",
      );
    const controller = new AbortController();
    matching.current = controller;
    const buffer = await reference(refTrack, start, seconds, controller.signal);
    if (!mounted.current) return;
    const samples = mono(buffer);
    if (signalLevel(samples).rms < 0.0001)
      throw new Error("O trecho de referência está silencioso.");
    target.current = buffer;
    setReferenceReady(true);
    setReferenceName(
      `${tracks.find((t) => t.id === refTrack)?.name || "Guitarra"} · ${start.toFixed(1)}–${(start + seconds).toFixed(1)} s`,
    );
  };
  const getDI = async () => {
    const id = state.calibrationAsset,
      asset = assets[id || ""];
    if (!id || !asset)
      throw new Error(
        "Grave ou importe primeiro uma guitarra limpa para calibração.",
      );
    if (calibration.current?.id === id) return calibration.current.buffer;
    const live = ensure();
    const buffer = await live.context.decodeAudioData(
      await asset.blob.arrayBuffer(),
    );
    calibration.current = { id, buffer };
    return buffer;
  };
  const saveDI = async (buffer: AudioBuffer, name: string) => {
    const pcm = mono(buffer);
    const level = signalLevel(pcm);
    if (level.rms < 0.001)
      throw new Error(
        "Entrada muito baixa ou silenciosa. Aumente o ganho da interface e grave novamente.",
      );
    if (level.peak >= 0.99)
      throw new Error(
        "A gravação está clipando. Reduza o ganho da interface e grave novamente.",
      );
    calibrationWindow(pcm, buffer.sampleRate);
    const id = crypto.randomUUID(),
      next = { ...assets };
    if (state.calibrationAsset) delete next[state.calibrationAsset];
    next[id] = { name, kind: "di", blob: pcmWav(pcm, buffer.sampleRate) };
    calibration.current = { id, buffer };
    onAssets(next);
    onChange({ ...state, calibrationAsset: id });
    setStatus(
      "Calibração limpa salva. Use acordes e notas próximos ao trecho de referência.",
    );
  };
  const importAsset = async (file: File) => {
    const kind = importKind.current;
    if (!file.size || file.size > 20 * 1024 ** 2)
      throw new Error("Use um arquivo de até 20 MB.");
    const live = ensure();
    if (kind === "di") {
      const buffer = await live.context.decodeAudioData(
        await file.arrayBuffer(),
      );
      if (buffer.duration > 20)
        throw new Error("Importe uma gravação limpa de 2 a 20 segundos.");
      await saveDI(buffer, file.name);
      return;
    }
    if (
      Object.keys(assets).length >= 40 ||
      Object.values(assets).reduce((sum, a) => sum + a.blob.size, 0) +
        file.size >
        100 * 1024 ** 2
    )
      throw new Error(
        "O limite de arquivos de timbre é 100 MB ou 40 arquivos. Remova os arquivos sem uso.",
      );
    if (kind === "nam") {
      if (!file.name.toLowerCase().endsWith(".nam"))
        throw new Error("Selecione uma captura .nam.");
      const data = JSON.parse(await file.text());
      if (!data || typeof data.architecture !== "string" || !data.weights)
        throw new Error("Captura NAM inválida.");
    } else {
      const audio = await live.context.decodeAudioData(
        await file.arrayBuffer(),
      );
      if (audio.duration > 5 || audio.numberOfChannels > 2)
        throw new Error("Use um IR mono/estéreo com até 5 segundos.");
    }
    const id = crypto.randomUUID();
    onAssets({ ...assets, [id]: { name: file.name, kind, blob: file } });
    change({
      ...preset,
      ...(kind === "nam"
        ? { amp: "nam", namAsset: id }
        : { cabinet: "ir", irAsset: id }),
      effects: preset.effects.map((e) =>
        e.kind === (kind === "nam" ? "amp" : "cabinet")
          ? { ...e, enabled: true }
          : e,
      ),
    });
    setStatus(
      `${file.name} importado. O retorno fica desligado durante a carga de modelos.`,
    );
  };
  const filePicker = (kind: "ir" | "nam" | "di") => {
    importKind.current = kind;
    assetInput.current!.accept = kind === "nam" ? ".nam" : "audio/*,.wav,.flac";
    assetInput.current?.click();
  };
  const startMatch = () =>
    run("Comparando timbres", async () => {
      setReport("");
      setProgress(0);
      const controller = new AbortController();
      matching.current = controller;
      const live = ensure();
      const wasMonitoring = live.monitoring;
      live.setMonitor(false);
      setMonitoring(false);
      try {
        const buffer = await getDI();
        controller.signal.throwIfAborted();
        if (!target.current) {
          await loadReference();
          matching.current = controller;
          controller.signal.throwIfAborted();
        }
        const ref = target.current!;
        const result = await matchTone(
          mono(buffer),
          mono(ref),
          buffer.sampleRate,
          preset,
          controller.signal,
          (p) => {
            if (mounted.current)
              setProgress(Math.min(99, Math.round((p.done / p.total) * 100)));
          },
        );
        controller.signal.throwIfAborted();
        onChange({
          ...state,
          a: structuredClone(preset),
          b: structuredClone(result.preset),
          current: result.preset,
        });
        setCompare("B");
        setProgress(100);
        setReport(
          `Distância sonora: ${result.initial.toFixed(2)} → ${result.distance.toFixed(2)} · redução de ${result.improvement.toFixed(1)}% em ${result.evaluations} comparações. Isso mede os descritores analisados, não uma porcentagem de fidelidade.`,
        );
        setStatus(
          "A guarda seu timbre anterior; B guarda o ajuste encontrado. Compare e refine os pedais.",
        );
      } finally {
        if (mounted.current && wasMonitoring && live.connected) {
          live.setMonitor(true);
          setMonitoring(true);
        }
      }
    });
  const savePreset = () => {
    if (state.saved.length >= 50) {
      setError("Limite de 50 timbres por música.");
      return;
    }
    onChange({
      ...state,
      saved: [
        ...state.saved,
        { id: crypto.randomUUID(), preset: structuredClone(preset) },
      ],
    });
    setStatus(
      `“${preset.name}” salvo ${tracks.length ? "nesta música" : "na pedaleira"}.`,
    );
  };
  const switchAB = (slot: "A" | "B") => {
    const next = slot === "A" ? state.a : state.b;
    if (next) {
      onChange({ ...state, current: structuredClone(next) });
      setCompare(slot);
    }
  };
  const move = (kind: EffectKind, direction: number) => {
    const list = [...preset.effects],
      index = list.findIndex((e) => e.kind === kind),
      to = index + direction;
    if (to < 0 || to >= list.length) return;
    [list[index], list[to]] = [list[to], list[index]];
    change({ ...preset, effects: list });
  };
  const inUse = (id: string) =>
    state.calibrationAsset === id ||
    [state.current, state.a, state.b, ...state.saved.map((s) => s.preset)].some(
      (p) => p?.namAsset === id || p?.irAsset === id,
    );
  return (
    <section className="rig-section" id="live-rig">
      <div className="section-heading">
        <div>
          <h2>
            <Guitar size={19} /> Pedaleira e timbre
          </h2>
          <p>
            Monte seu equipamento e ajuste o timbre. Conecte a guitarra quando
            quiser tocar.
          </p>
        </div>
      </div>
      <div className="rig-body">
        <input
          hidden
          ref={assetInput}
          type="file"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void run("Importando arquivo", () => importAsset(file));
          }}
        />
        <input
          hidden
          ref={refInput}
          type="file"
          accept="audio/*,.wav,.mp3,.flac"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file)
              void run("Abrindo referência", async () => {
                if (file.size > 20 * 1024 ** 2)
                  throw new Error(
                    "Use um trecho de referência de até 20 MB e 20 segundos.",
                  );
                const buffer = await ensure().context.decodeAudioData(
                  await file.arrayBuffer(),
                );
                if (buffer.duration > 20 || buffer.duration < 1)
                  throw new Error(
                    "Use um trecho de referência entre 1 e 20 segundos.",
                  );
                if (signalLevel(mono(buffer)).rms < 0.0001)
                  throw new Error("O trecho está silencioso.");
                target.current = buffer;
                setReferenceName(file.name);
                setReferenceReady(true);
                setReport("");
              });
          }}
        />
        <input
          hidden
          ref={presetInput}
          type="file"
          accept=".json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file)
              void run("Importando preset", async () => {
                if (file.size > 100000) throw new Error("Preset muito grande.");
                const next = validatePreset(JSON.parse(await file.text()));
                if (
                  (next.namAsset && !assets[next.namAsset]) ||
                  (next.irAsset && !assets[next.irAsset])
                )
                  throw new Error(
                    "Esse preset usa arquivos externos. Importe o projeto .riffsync para transferir NAM e IR junto.",
                  );
                change(next);
              });
          }}
        />
        <div className="rig-topline">
          <span className="rig-tag">
            <span className={connected ? "live-dot" : "offline-dot"} />
            {connected ? "ENTRADA AO VIVO" : "ESTÚDIO DE GUITARRA"}
          </span>
          <span>
            Áudio local ·{" "}
            {latency
              ? `48 kHz · saída estimada ${latency.toFixed(1)} ms`
              : "48 kHz"}
          </span>
        </div>
        <fieldset disabled={!!working} className="rig-fieldset">
          <p className="rig-preview-note">
            Pedais, amplificador e caixas disponíveis sem conectar nenhum
            dispositivo.
          </p>
          <GearRack
            preset={preset}
            assets={assets}
            change={change}
            select={(kind) => {
              setSelected(kind);
              setTimeout(
                () =>
                  document
                    .getElementById("rig-controls")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                25,
              );
            }}
          />
          <div className="rig-board-heading">
            <span>SEUS PEDAIS</span>
            <p>
              Gire os controles ou pise no botão para ligar. As setas mudam a
              ordem do sinal.
            </p>
          </div>
          <div className="rig-pedalboard" aria-label="Pedais de guitarra">
            {preset.effects.map((e, index) =>
              ["amp", "cabinet"].includes(e.kind) ? null : (
                <div
                  key={e.kind}
                  className={`rig-pedal ${e.enabled ? "enabled" : ""} ${selected === e.kind ? "selected" : ""}`}
                  style={
                    {
                      "--pedal-color": EFFECTS[e.kind].color,
                    } as React.CSSProperties
                  }
                >
                  <button
                    className="rig-pedal-face"
                    onClick={() => setSelected(e.kind)}
                    aria-pressed={selected === e.kind}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{EFFECTS[e.kind].name}</strong>
                    <i aria-hidden="true" />
                  </button>
                  <div className="rig-mini-knobs">
                    {EFFECTS[e.kind].controls.slice(0, 3).map((c) => (
                      <Knob
                        key={c.key}
                        control={c}
                        scope={EFFECTS[e.kind].name}
                        value={e.params[c.key]}
                        onChange={(value) =>
                          change({
                            ...preset,
                            effects: preset.effects.map((item) =>
                              item.kind === e.kind
                                ? {
                                    ...item,
                                    params: { ...item.params, [c.key]: value },
                                  }
                                : item,
                            ),
                          })
                        }
                      />
                    ))}
                  </div>
                  <div className="rig-pedal-foot">
                    <button
                      aria-label={`${e.enabled ? "Desligar" : "Ligar"} ${EFFECTS[e.kind].name}`}
                      aria-pressed={e.enabled}
                      onClick={() =>
                        change({
                          ...preset,
                          effects: preset.effects.map((item) =>
                            item.kind === e.kind
                              ? { ...item, enabled: !item.enabled }
                              : item,
                          ),
                        })
                      }
                    >
                      <Power size={14} />
                    </button>
                    <button
                      aria-label={`Mover ${EFFECTS[e.kind].name} antes`}
                      disabled={index === 0}
                      onClick={() => move(e.kind, -1)}
                    >
                      <ArrowUp size={12} />
                    </button>
                    <button
                      aria-label={`Mover ${EFFECTS[e.kind].name} depois`}
                      disabled={index === preset.effects.length - 1}
                      onClick={() => move(e.kind, 1)}
                    >
                      <ArrowDown size={12} />
                    </button>
                  </div>
                </div>
              ),
            )}
          </div>
          <div className="rig-editor" id="rig-controls">
            <div className="rig-editor-head">
              <div>
                <span className="rig-label">AJUSTE MANUAL</span>
                <h3>{EFFECTS[selected].name}</h3>
              </div>
              <span>
                {fx.enabled ? "Ligado na cadeia" : "Desligado na cadeia"}
              </span>
            </div>
            {selected === "amp" && (
              <div className="rig-models">
                <label>
                  Amplificador
                  <select
                    aria-label="Modelo do amplificador"
                    value={preset.amp}
                    onChange={(e) =>
                      change({
                        ...preset,
                        amp: e.target.value as RigPreset["amp"],
                      })
                    }
                  >
                    <option value="clean">Clean · DSP</option>
                    <option value="crunch">Crunch · DSP</option>
                    <option value="highgain">High gain · DSP</option>
                    <option
                      value="nam"
                      disabled={
                        !Object.values(assets).some((a) => a.kind === "nam")
                      }
                    >
                      Captura neural · NAM
                    </option>
                  </select>
                </label>
                {preset.amp === "nam" && (
                  <label>
                    Captura
                    <select
                      aria-label="Captura NAM"
                      value={preset.namAsset || ""}
                      onChange={(e) =>
                        change({ ...preset, namAsset: e.target.value })
                      }
                    >
                      <option value="" disabled>
                        Escolha uma captura
                      </option>
                      {Object.entries(assets)
                        .filter(([, a]) => a.kind === "nam")
                        .map(([id, a]) => (
                          <option key={id} value={id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <button
                  className="button secondary"
                  onClick={() => filePicker("nam")}
                >
                  <Upload size={15} />
                  Importar .nam
                </button>
                <small>
                  Capturas compatíveis com o motor Neural Amp Modeler. Modelos
                  em 48 kHz; nenhum modelo comercial incluído.
                </small>
              </div>
            )}
            {selected === "cabinet" && (
              <div className="rig-models">
                <label>
                  Caixa
                  <select
                    aria-label="Modelo da caixa"
                    value={preset.cabinet}
                    onChange={(e) =>
                      change({
                        ...preset,
                        cabinet: e.target.value as RigPreset["cabinet"],
                      })
                    }
                  >
                    <option value="1x12">1×12 · DSP</option>
                    <option value="2x12">2×12 · DSP</option>
                    <option value="4x12">4×12 · DSP</option>
                    <option
                      value="ir"
                      disabled={
                        !Object.values(assets).some((a) => a.kind === "ir")
                      }
                    >
                      IR importado
                    </option>
                  </select>
                </label>
                {preset.cabinet === "ir" && (
                  <label>
                    Resposta a impulso
                    <select
                      aria-label="Resposta a impulso"
                      value={preset.irAsset || ""}
                      onChange={(e) =>
                        change({ ...preset, irAsset: e.target.value })
                      }
                    >
                      <option value="" disabled>
                        Escolha um IR
                      </option>
                      {Object.entries(assets)
                        .filter(([, a]) => a.kind === "ir")
                        .map(([id, a]) => (
                          <option key={id} value={id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </label>
                )}
                <button
                  className="button secondary"
                  onClick={() => filePicker("ir")}
                >
                  <Upload size={15} />
                  Importar IR
                </button>
                <small>
                  As caixas DSP são aproximações por filtros. Importe um IR para
                  usar uma resposta medida de caixa e microfone.
                </small>
              </div>
            )}
            <div className="rig-knobs">
              {selected !== "amp" &&
                EFFECTS[selected].controls.map((c) => (
                  <Knob
                    key={c.key}
                    control={c}
                    value={fx.params[c.key]}
                    onChange={(value) => param(c.key, value)}
                  />
                ))}
              <Knob
                control={{
                  key: "inputDb",
                  label: "Entrada geral",
                  min: -24,
                  max: 24,
                  step: 0.5,
                  initial: 0,
                  unit: "dB",
                }}
                value={preset.inputDb}
                onChange={(inputDb) => change({ ...preset, inputDb })}
              />
              <Knob
                control={{
                  key: "outputDb",
                  label: "Saída geral",
                  min: -60,
                  max: 3,
                  step: 0.5,
                  initial: -12,
                  unit: "dB",
                }}
                value={preset.outputDb}
                onChange={(outputDb) => change({ ...preset, outputDb })}
              />
            </div>
          </div>
          <div className="rig-presetbar">
            <label>
              Nome do timbre
              <input
                aria-label="Nome do timbre"
                maxLength={120}
                value={preset.name}
                onChange={(e) => change({ ...preset, name: e.target.value })}
              />
            </label>
            <button className="button secondary" onClick={savePreset}>
              <Save size={15} />
              Salvar timbre
            </button>
            <button
              className="button subtle"
              onClick={() => change(defaultPreset())}
            >
              Novo
            </button>
            <button
              className={`button ${preset.bypass ? "primary" : "secondary"}`}
              aria-pressed={preset.bypass}
              onClick={() => change({ ...preset, bypass: !preset.bypass })}
            >
              Bypass geral
            </button>
            <div className="rig-ab">
              {(["A", "B"] as const).map((slot) => (
                <div key={slot}>
                  <button
                    className={compare === slot ? "active" : ""}
                    disabled={!(slot === "A" ? state.a : state.b)}
                    onClick={() => switchAB(slot)}
                    aria-label={`Ouvir timbre ${slot}`}
                  >
                    {slot}
                  </button>
                  <button
                    title={`Guardar timbre em ${slot}`}
                    aria-label={`Guardar timbre em ${slot}`}
                    onClick={() => {
                      onChange({
                        ...state,
                        [slot.toLowerCase()]: structuredClone(preset),
                      });
                      setStatus(`Timbre atual guardado em ${slot}.`);
                    }}
                  >
                    +
                  </button>
                </div>
              ))}
            </div>
          </div>
          <div className="rig-connect-later">
            <div className="rig-connect-heading">
              <Mic size={18} />
              <div>
                <h3>Pronto para tocar?</h3>
                <p>
                  Os ajustes acima já ficam salvos. Conecte a entrada de áudio
                  para ouvir a guitarra.
                </p>
              </div>
            </div>
            <div className="rig-inputs">
              <label>
                Entrada
                <select
                  aria-label="Entrada da guitarra"
                  value={device}
                  disabled={connected}
                  onChange={(e) => setDevice(e.target.value)}
                >
                  <option value="">Dispositivo padrão</option>
                  {devices
                    .filter((d) => d.kind === "audioinput" && d.deviceId)
                    .map((d, i) => (
                      <option key={d.deviceId} value={d.deviceId}>
                        {d.label || `Entrada ${i + 1}`}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Canal
                <select
                  aria-label="Canal da guitarra"
                  disabled={connected}
                  value={channel}
                  onChange={(e) => setChannel(Number(e.target.value))}
                >
                  <option value={0}>1 · esquerdo / mono</option>
                  <option value={1}>2 · direito</option>
                </select>
              </label>
              <button
                className="button secondary"
                onClick={() => void run("Buscando entradas", scan)}
                disabled={connected}
              >
                Atualizar entradas
              </button>
              <button
                className={`button ${connected ? "secondary" : "primary"}`}
                onClick={() => (connected ? disconnect() : void connect())}
              >
                <Mic size={16} />
                {connected ? "Desconectar" : "Conectar guitarra"}
              </button>
              <button
                className={`button ${monitoring ? "primary" : "secondary"}`}
                disabled={!connected}
                onClick={() => {
                  const next = !monitoring;
                  ensure().setMonitor(next);
                  setMonitoring(next);
                }}
              >
                <Power size={16} />
                {monitoring ? "Desligar retorno" : "Ativar retorno"}
              </button>
            </div>
            <div className="rig-input-detail">
              <div
                className="rig-meter"
                role="meter"
                aria-label="Nível da entrada"
                aria-valuenow={Math.round(meter.peak * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <i
                  style={{
                    width: `${Math.min(100, meter.peak * 100)}%`,
                    background: meter.peak > 0.95 ? "#f18b78" : undefined,
                  }}
                />
              </div>
              <span>
                {connected
                  ? meter.peak > 0.95
                    ? "CLIP · reduza o ganho da interface"
                    : meter.rms > 0.002
                      ? `${(20 * Math.log10(meter.rms)).toFixed(0)} dBFS · sinal recebido`
                      : "Aguardando sinal da guitarra"
                  : "Retorno desligado até você ativar"}
              </span>
              {!!devices.filter((d) => d.kind === "audiooutput").length && (
                <label>
                  Saída
                  <select
                    aria-label="Saída de áudio"
                    value={output}
                    onChange={(e) => {
                      const id = e.target.value;
                      void run("Alterando saída", async () => {
                        const ctx = ensure().context as AudioContext & {
                          setSinkId?: (id: string) => Promise<void>;
                        };
                        if (!ctx.setSinkId)
                          throw new Error(
                            "Escolha a saída nas configurações de áudio do sistema; este navegador não oferece seleção de saída.",
                          );
                        await ctx.setSinkId(id);
                        setOutput(id);
                        setLatency(ensure().outputLatency);
                      });
                    }}
                  >
                    <option value="">Padrão do sistema</option>
                    {devices
                      .filter(
                        (d) =>
                          d.kind === "audiooutput" &&
                          d.deviceId &&
                          d.deviceId !== "default",
                      )
                      .map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || "Saída"}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            </div>
            <p className="rig-hint">
              Use a entrada de instrumento da interface e fones. Desative o
              monitoramento direto da interface para ouvir somente o som
              processado.
            </p>
          </div>
          <div className="rig-match">
            <div className="rig-match-heading">
              <WandSparkles size={21} />
              <div>
                <h3>Encontre o timbre da gravação</h3>
                <p>
                  Ajuste automático experimental por comparação de áudio. O
                  resultado é um ponto de partida para seus ajustes.
                </p>
              </div>
              <span className="rig-beta">EXPERIMENTAL</span>
            </div>
            <div className="rig-match-columns">
              <div>
                <span className="rig-step">01</span>
                <h4>Guitarra de referência</h4>
                <p>
                  Escolha um trecho com a guitarra isolada e pouca mistura de
                  outros instrumentos.
                </p>
                <label>
                  Pista
                  <select
                    aria-label="Pista de referência"
                    value={refTrack}
                    onChange={(e) => selectReference(e.target.value)}
                  >
                    <option value="">Selecione uma pista</option>
                    {tracks
                      .filter((t) => t.kind !== "original")
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </select>
                </label>
                <div className="rig-ref-times">
                  <label>
                    Início (s)
                    <input
                      type="number"
                      aria-label="Início da referência"
                      min={0}
                      step={0.1}
                      value={start}
                      onChange={(e) =>
                        selectReference(
                          refTrack,
                          Math.max(0, Number(e.target.value)),
                          seconds,
                        )
                      }
                    />
                  </label>
                  <label>
                    Duração (s)
                    <input
                      type="number"
                      aria-label="Duração da referência"
                      min={2}
                      max={20}
                      step={1}
                      value={seconds}
                      onChange={(e) =>
                        selectReference(
                          refTrack,
                          start,
                          Math.max(2, Math.min(20, Number(e.target.value))),
                        )
                      }
                    />
                  </label>
                  <button
                    className="button subtle"
                    onClick={() =>
                      selectReference(
                        refTrack,
                        Math.floor(time * 10) / 10,
                        seconds,
                      )
                    }
                  >
                    Usar posição atual
                  </button>
                </div>
                <div className="rig-actions">
                  <button
                    className="button secondary"
                    disabled={!refTrack}
                    onClick={() =>
                      void run("Extraindo referência", loadReference)
                    }
                  >
                    Carregar trecho
                  </button>
                  <button
                    className="button subtle"
                    onClick={() => refInput.current?.click()}
                  >
                    Importar trecho
                  </button>
                </div>
                <small>
                  {referenceReady
                    ? referenceName
                    : "Trechos de 2 a 20 segundos."}
                </small>
              </div>
              <div>
                <span className="rig-step">02</span>
                <h4>Sua guitarra limpa</h4>
                <p>
                  Grave 6 segundos sem efeitos, tocando notas e acordes
                  parecidos. A calibração usa o sinal direto da entrada.
                </p>
                <div className="rig-actions">
                  <button
                    className="button secondary"
                    disabled={!connected}
                    onClick={() =>
                      void run("Gravando 6 segundos", async () => {
                        const live = ensure();
                        const pcm = await live.record(6);
                        if (mounted.current)
                          await saveDI(
                            audioBufferFrom(
                              live.context,
                              pcm,
                              live.context.sampleRate,
                            ),
                            "Calibração · guitarra limpa.wav",
                          );
                      })
                    }
                  >
                    <Mic size={15} />
                    Gravar calibração
                  </button>
                  <button
                    className="button subtle"
                    onClick={() => filePicker("di")}
                  >
                    Importar DI limpa
                  </button>
                </div>
                <small>
                  {assets[state.calibrationAsset || ""]?.name ||
                    "Calibração ainda não gravada."}
                </small>
                <div className="rig-actions">
                  <button
                    className="button secondary"
                    disabled={!state.calibrationAsset}
                    onClick={() =>
                      void run("Abrindo calibração", async () => {
                        await ensure().playDI(await getDI(), preset, assets);
                        setMonitoring(ensure().monitoring);
                      })
                    }
                  >
                    <Play size={14} />
                    Ouvir com os efeitos
                  </button>
                  <button
                    className="button secondary"
                    disabled={!referenceReady}
                    onClick={() =>
                      void run("Ouvindo referência", async () => {
                        await ensure().playReference(target.current!);
                      })
                    }
                  >
                    <Play size={14} />
                    Ouvir referência
                  </button>
                  <button
                    className="button subtle"
                    onClick={() => ensure().stopPreview()}
                    aria-label="Parar comparação"
                  >
                    <Square size={14} />
                  </button>
                </div>
              </div>
            </div>
            <div className="rig-match-bottom">
              <button
                className="button primary"
                disabled={
                  !state.calibrationAsset || (!referenceReady && !refTrack)
                }
                onClick={() => void startMatch()}
              >
                <WandSparkles size={16} />
                Aproximar timbre
              </button>
              {!!refTrack && (
                <button
                  className="button secondary"
                  onClick={() => muteReference(refTrack)}
                >
                  <Guitar size={15} />
                  Silenciar guitarra da música
                </button>
              )}
              <p>
                Compara espectro e dinâmica de renders reais da cadeia DSP.
                Acordes, captadores, execução e vazamento da separação
                influenciam o resultado. Não identifica os pedais originais.
              </p>
            </div>
          </div>
          <div className="rig-library">
            <h3>
              <AudioLines size={17} /> Timbres salvos{" "}
              {tracks.length ? "nesta música" : "da pedaleira"}
            </h3>
            {state.saved.length ? (
              <div className="rig-saved">
                {state.saved.map((s) => (
                  <div key={s.id}>
                    <button onClick={() => change(structuredClone(s.preset))}>
                      {s.preset.name}
                      <small>
                        {s.preset.amp} · {s.preset.cabinet}
                      </small>
                    </button>
                    <button
                      aria-label={`Excluir timbre ${s.preset.name}`}
                      onClick={() =>
                        onChange({
                          ...state,
                          saved: state.saved.filter((item) => item.id !== s.id),
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p>
                Salve timbres de base, solo e outras variações para esta sessão.
              </p>
            )}
            <div className="rig-actions">
              <button
                className="button subtle"
                onClick={() =>
                  download(
                    new Blob([JSON.stringify(preset, null, 2)], {
                      type: "application/json",
                    }),
                    `${preset.name.replace(/[^\p{L}\p{N}_-]/gu, "_")}.json`,
                  )
                }
              >
                Exportar preset JSON
              </button>
              <button
                className="button subtle"
                onClick={() => presetInput.current?.click()}
              >
                Importar preset JSON
              </button>
              <small>
                O projeto .riffsync inclui também os arquivos NAM, IR e a
                calibração.
              </small>
            </div>
            {Object.entries(assets).some(([, a]) => a.kind !== "di") && (
              <details>
                <summary>Arquivos de timbre importados</summary>
                {Object.entries(assets)
                  .filter(([, a]) => a.kind !== "di")
                  .map(([id, a]) => (
                    <div key={id} className="rig-file">
                      <span>
                        {a.kind.toUpperCase()} · {a.name}
                      </span>
                      <button
                        className="button subtle"
                        disabled={inUse(id)}
                        title={
                          inUse(id)
                            ? "Usado pelo timbre atual, A/B ou um preset salvo"
                            : "Remover arquivo"
                        }
                        onClick={() => {
                          const next = { ...assets };
                          delete next[id];
                          onAssets(next);
                        }}
                      >
                        <X size={14} />
                        Remover
                      </button>
                    </div>
                  ))}
              </details>
            )}
          </div>
        </fieldset>
        {connected && !!working && (
          <div className="rig-emergency">
            <button className="button secondary" onClick={disconnect}>
              Desconectar entrada e retorno
            </button>
          </div>
        )}
        {working && (
          <div className="rig-working" role="status">
            <LoaderCircle size={16} className="spin" />
            {working}
            {working === "Comparando timbres" ? ` · ${progress}%` : "…"}
            {working === "Comparando timbres" && (
              <button
                className="button secondary"
                onClick={() => matching.current?.abort()}
              >
                Cancelar
              </button>
            )}
          </div>
        )}
        {error && (
          <div className="rig-error" role="alert">
            {error}
            <button
              aria-label="Fechar erro da pedaleira"
              onClick={() => setError("")}
            >
              <X size={14} />
            </button>
          </div>
        )}
        {report && <p className="rig-report">{report}</p>}
        {status && (
          <p className="rig-status" role="status">
            {status}
          </p>
        )}
      </div>
    </section>
  );
}
