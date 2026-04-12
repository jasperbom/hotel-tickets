import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { poolApi, userApi, type PoolId, type PoolLog } from "../api/client";

type FieldDef = { key: string; label: string; type: "number" | "text"; step?: string };

const WAARDES: FieldDef[] = [
  { key: "water_temp", label: "Water temperatuur (°C)", type: "number", step: "0.1" },
  { key: "doorzicht", label: "Doorzicht", type: "text" },
  { key: "ph", label: "pH", type: "number", step: "0.01" },
  { key: "vbc_in", label: "VBC in", type: "number", step: "0.01" },
  { key: "vbc_uit", label: "VBC uit", type: "number", step: "0.01" },
  { key: "tbc", label: "TBC", type: "number", step: "0.01" },
];

const AUTOMATEN: FieldDef[] = [
  { key: "ph_automaat", label: "pH", type: "number", step: "0.01" },
  { key: "vbc_automaat", label: "VBC", type: "number", step: "0.01" },
  { key: "watermeter", label: "Watermeter", type: "number", step: "0.1" },
  { key: "flow", label: "Flow", type: "number", step: "0.01" },
];

const ALL_INPUT_FIELDS = [...WAARDES, ...AUTOMATEN];

export default function PoolNieuweMeting() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialPool = (["wellness", "zwembad"].includes(searchParams.get("pool") || "")
    ? searchParams.get("pool")
    : "wellness") as PoolId;
  const now = new Date();
  const [poolId, setPoolId] = useState<PoolId>(initialPool);
  const [datum, setDatum] = useState(now.toISOString().slice(0, 10));
  const [tijd, setTijd] = useState(now.toTimeString().slice(0, 5));
  const [values, setValues] = useState<Record<string, any>>({
    doorzicht: "Helder",
    gemeten_door: "",
  });
  const [prevLog, setPrevLog] = useState<PoolLog | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    poolApi.list({ pool_id: poolId, limit: "1" }).then((r) => {
      setPrevLog(r.data.length > 0 ? r.data[0] : null);
    });
  }, [poolId]);

  useEffect(() => {
    userApi.me().then((r) => {
      setValues((v) => v.gemeten_door ? v : { ...v, gemeten_door: r.data.display_name });
    }).catch(() => {});
  }, []);

  function set(key: string, val: any) {
    setValues((v) => ({ ...v, [key]: val }));
  }

  function getPlaceholder(key: string): string {
    if (!prevLog) return "";
    const val = prevLog[key as keyof PoolLog];
    if (val === null || val === undefined) return "";
    return String(val);
  }

  // Berekende waardes
  const tbc = values.tbc !== undefined && values.tbc !== "" ? Number(values.tbc) : null;
  const vbcUit = values.vbc_uit !== undefined && values.vbc_uit !== "" ? Number(values.vbc_uit) : null;
  const gebondenChloor = tbc !== null && vbcUit !== null ? Math.round((tbc - vbcUit) * 100) / 100 : null;

  const watermeter = values.watermeter !== undefined && values.watermeter !== "" ? Number(values.watermeter) : null;
  const prevWatermeter = prevLog?.watermeter ?? null;
  const verbruik = watermeter !== null && prevWatermeter !== null ? Math.round((watermeter - prevWatermeter) * 10) / 10 : null;

  const isAfter17 = now.getHours() >= 17;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!values.gemeten_door?.trim()) {
      setError("Vul in wie de meting doet");
      return;
    }
    setSaving(true);
    setError("");

    const payload: Record<string, any> = {
      pool_id: poolId,
      datum,
      tijd,
    };

    for (const f of ALL_INPUT_FIELDS) {
      const v = values[f.key];
      if (f.type === "number") {
        payload[f.key] = v !== undefined && v !== "" ? Number(v) : null;
      } else {
        payload[f.key] = v || null;
      }
    }

    // Berekende velden
    payload.gbc = gebondenChloor;
    payload.verbruik = verbruik;

    // Administratie
    payload.bezoekers = isAfter17 && values.bezoekers !== undefined && values.bezoekers !== ""
      ? Number(values.bezoekers) : null;
    payload.gemeten_door = values.gemeten_door?.trim() || null;
    payload.notitie = values.notitie || null;

    // Niet-getoonde velden op standaard
    payload.filterspoeling = false;
    payload.reiniging = false;
    payload.chemicalien = null;

    try {
      await poolApi.create(payload as any);
      navigate("/pools/logboek?pool=" + poolId);
    } catch {
      setError("Opslaan mislukt");
      setSaving(false);
    }
  }

  function renderField(f: FieldDef) {
    return (
      <div key={f.key}>
        <label className="block text-xs font-medium text-gray-600 mb-0.5">{f.label}</label>
        <input
          type={f.type}
          step={f.step}
          className="w-full border rounded-lg px-2 py-1.5 text-sm"
          value={values[f.key] ?? ""}
          placeholder={getPlaceholder(f.key)}
          onChange={(e) => set(f.key, e.target.value)}
        />
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-4">Nieuwe meting</h1>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Algemeen */}
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Algemeen</h2>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-0.5">Bad</label>
              <select
                className="w-full border rounded-lg px-2 py-1.5 text-sm"
                value={poolId}
                onChange={(e) => setPoolId(e.target.value as PoolId)}
              >
                <option value="wellness">Wellness</option>
                <option value="zwembad">Zwembad</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-0.5">Datum</label>
              <input
                type="date"
                className="w-full border rounded-lg px-2 py-1.5 text-sm"
                value={datum}
                onChange={(e) => setDatum(e.target.value)}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-0.5">Tijd</label>
              <input
                type="time"
                className="w-full border rounded-lg px-2 py-1.5 text-sm"
                value={tijd}
                onChange={(e) => setTijd(e.target.value)}
                required
              />
            </div>
          </div>
        </section>

        {/* Waardes */}
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Waardes</h2>
          <div className="grid grid-cols-3 gap-x-3 gap-y-2">
            {WAARDES.map(renderField)}
            {/* Gebonden chloor – berekend */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-0.5">Gebonden chloor</label>
              <div className="w-full border rounded-lg px-2 py-1.5 text-sm bg-gray-50 text-gray-700">
                {gebondenChloor !== null ? gebondenChloor : <span className="text-gray-400">TBC − VBC uit</span>}
              </div>
            </div>
          </div>
        </section>

        {/* Automaten */}
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Automaten</h2>
          <div className="grid grid-cols-3 gap-x-3 gap-y-2">
            {AUTOMATEN.map(renderField)}
            {/* Verbruik – berekend */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-0.5">Verbruik</label>
              <div className="w-full border rounded-lg px-2 py-1.5 text-sm bg-gray-50 text-gray-700">
                {verbruik !== null ? verbruik : <span className="text-gray-400">vorige − huidige</span>}
              </div>
            </div>
          </div>
        </section>

        {/* Administratie */}
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Administratie</h2>
          <div className="grid grid-cols-3 gap-x-3 gap-y-2">
            {isAfter17 && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-0.5">Aantal zwemmers</label>
                <input
                  type="number"
                  step="1"
                  className="w-full border rounded-lg px-2 py-1.5 text-sm"
                  value={values.bezoekers ?? ""}
                  placeholder={getPlaceholder("bezoekers")}
                  onChange={(e) => set("bezoekers", e.target.value)}
                />
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-0.5">Gemeten door</label>
              <input
                type="text"
                className="w-full border rounded-lg px-2 py-1.5 text-sm"
                value={values.gemeten_door ?? ""}
                placeholder={getPlaceholder("gemeten_door")}
                onChange={(e) => set("gemeten_door", e.target.value)}
              />
            </div>
            <div className={isAfter17 ? "" : "col-span-2"}>
              <label className="block text-xs font-medium text-gray-600 mb-0.5">Notitie</label>
              <input
                type="text"
                className="w-full border rounded-lg px-2 py-1.5 text-sm"
                value={values.notitie ?? ""}
                placeholder={getPlaceholder("notitie")}
                onChange={(e) => set("notitie", e.target.value)}
              />
            </div>
          </div>
        </section>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="flex gap-3 pt-1">
          <button
            type="submit"
            disabled={saving}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Opslaan..." : "Opslaan"}
          </button>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="border px-6 py-2 rounded-lg hover:bg-gray-50"
          >
            Annuleren
          </button>
        </div>
      </form>
    </div>
  );
}
