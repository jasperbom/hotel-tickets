import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { poolApi, type PoolId, type PoolLog } from "../api/client";

const FIELDS: { key: string; label: string; type: "number" | "text" | "checkbox"; step?: string }[] = [
  { key: "water_temp", label: "Water temperatuur (°C)", type: "number", step: "0.1" },
  { key: "doorzicht", label: "Doorzicht", type: "text" },
  { key: "ph", label: "pH", type: "number", step: "0.01" },
  { key: "vbc_in", label: "VBC in", type: "number", step: "0.01" },
  { key: "vbc_uit", label: "VBC uit", type: "number", step: "0.01" },
  { key: "tbc", label: "TBC", type: "number", step: "0.01" },
  { key: "gbc", label: "GBC", type: "number", step: "0.01" },
  { key: "ph_automaat", label: "pH automaat", type: "number", step: "0.01" },
  { key: "vbc_automaat", label: "VBC automaat", type: "number", step: "0.01" },
  { key: "watermeter", label: "Watermeter", type: "number", step: "0.1" },
  { key: "verbruik", label: "Verbruik", type: "number", step: "0.1" },
  { key: "filterspoeling", label: "Filterspoeling", type: "checkbox" },
  { key: "bezoekers", label: "Aantal bezoekers", type: "number", step: "1" },
  { key: "reiniging", label: "Reiniging", type: "checkbox" },
  { key: "flow", label: "Flow", type: "number", step: "0.01" },
  { key: "chemicalien", label: "Chemicaliën", type: "text" },
  { key: "gemeten_door", label: "Gemeten door", type: "text" },
  { key: "notitie", label: "Notitie", type: "text" },
];

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
    filterspoeling: false,
    reiniging: false,
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

  function set(key: string, val: any) {
    setValues((v) => ({ ...v, [key]: val }));
  }

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

    for (const f of FIELDS) {
      const v = values[f.key];
      if (f.type === "checkbox") {
        payload[f.key] = !!v;
      } else if (f.type === "number") {
        payload[f.key] = v !== undefined && v !== "" ? Number(v) : null;
      } else {
        payload[f.key] = v || null;
      }
    }

    try {
      await poolApi.create(payload as any);
      navigate("/pools/logboek?pool=" + poolId);
    } catch {
      setError("Opslaan mislukt");
      setSaving(false);
    }
  }

  function getPlaceholder(key: string): string {
    if (!prevLog) return "";
    const val = prevLog[key as keyof PoolLog];
    if (val === null || val === undefined) return "";
    return String(val);
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-xl font-bold mb-4">Nieuwe meting</h1>

      <form onSubmit={handleSubmit} className="space-y-3">
        {/* Bad selectie + datum/tijd */}
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

        {/* Meetvelden in 3-koloms grid */}
        <div className="grid grid-cols-3 gap-x-3 gap-y-2">
          {FIELDS.map((f) =>
            f.type === "checkbox" ? (
              <label key={f.key} className="flex items-center gap-2 py-1">
                <input
                  type="checkbox"
                  checked={!!values[f.key]}
                  onChange={(e) => set(f.key, e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-sm">{f.label}</span>
                {prevLog && (
                  <span className="text-xs text-gray-400">
                    (vorige: {prevLog[f.key as keyof PoolLog] ? "Ja" : "Nee"})
                  </span>
                )}
              </label>
            ) : (
              <div key={f.key} className={f.key === "notitie" ? "col-span-3" : ""}>
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
            )
          )}
        </div>

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
