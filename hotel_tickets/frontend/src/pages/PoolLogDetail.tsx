import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { poolApi, userApi, type PoolLog, type UserRole } from "../api/client";

function valClass(val: number | null, low: number, high: number): string {
  if (val === null) return "text-gray-400";
  if (val < low || val > high) return "text-red-600 font-bold";
  return "text-green-700";
}

function Row({ label, value, className = "" }: { label: string; value: any; className?: string }) {
  return (
    <div className="flex justify-between py-2 border-b border-gray-100">
      <span className="text-gray-500">{label}</span>
      <span className={`font-medium ${className}`}>{value ?? "-"}</span>
    </div>
  );
}

type FieldDef = {
  key: string;
  label: string;
  type: "number" | "text";
  step?: string;
  valRange?: [number, number];
};

const EDITABLE_FIELDS: FieldDef[] = [
  { key: "water_temp", label: "Water temperatuur (°C)", type: "number", step: "0.1" },
  { key: "doorzicht", label: "Doorzicht", type: "text" },
  { key: "ph", label: "pH", type: "number", step: "0.01", valRange: [7.0, 7.6] },
  { key: "vbc_in", label: "VBC in", type: "number", step: "0.01", valRange: [0.5, 1.5] },
  { key: "vbc_uit", label: "VBC uit", type: "number", step: "0.01", valRange: [0.5, 1.5] },
  { key: "tbc", label: "TBC", type: "number", step: "0.01" },
  { key: "gbc", label: "Gebonden chloor", type: "number", step: "0.01", valRange: [0, 0.6] },
  { key: "ph_automaat", label: "pH automaat", type: "number", step: "0.01", valRange: [7.0, 7.6] },
  { key: "vbc_automaat", label: "VBC automaat", type: "number", step: "0.01", valRange: [0.5, 1.5] },
  { key: "watermeter", label: "Watermeter", type: "number", step: "0.1" },
  { key: "verbruik", label: "Verbruik", type: "number", step: "0.1" },
  { key: "flow", label: "Flow", type: "number", step: "0.01" },
  { key: "bezoekers", label: "Aantal zwemmers", type: "number", step: "1" },
  { key: "gemeten_door", label: "Gemeten door", type: "text" },
  { key: "notitie", label: "Notitie", type: "text" },
];

export default function PoolLogDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [log, setLog] = useState<PoolLog | null>(null);
  const [me, setMe] = useState<UserRole | null>(null);
  const [editing, setEditing] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, any>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (id) poolApi.get(id).then((r) => setLog(r.data));
    userApi.me().then((r) => setMe(r.data)).catch(() => {});
  }, [id]);

  const isAdmin = me?.role === "admin" || me?.role === "supervisor";

  function startEdit() {
    if (!log) return;
    const vals: Record<string, any> = {};
    for (const f of EDITABLE_FIELDS) {
      vals[f.key] = log[f.key as keyof PoolLog] ?? "";
    }
    vals.datum = log.datum;
    vals.tijd = log.tijd;
    vals.filterspoeling = log.filterspoeling;
    setEditValues(vals);
    setEditing(true);
    setError("");
  }

  function setVal(key: string, val: any) {
    setEditValues((v) => ({ ...v, [key]: val }));
  }

  async function handleSave() {
    if (!id || !log) return;
    setSaving(true);
    setError("");

    const payload: Record<string, any> = {
      datum: editValues.datum,
      tijd: editValues.tijd,
    };

    for (const f of EDITABLE_FIELDS) {
      const v = editValues[f.key];
      if (f.type === "number") {
        payload[f.key] = v !== undefined && v !== "" ? Number(v) : null;
      } else {
        payload[f.key] = v || null;
      }
    }

    payload.filterspoeling = editValues.filterspoeling || null;

    try {
      const r = await poolApi.update(id, payload as any);
      setLog(r.data);
      setEditing(false);
    } catch {
      setError("Opslaan mislukt");
    }
    setSaving(false);
  }

  if (!log) return <p className="text-gray-400 p-4">Laden...</p>;

  return (
    <div className="max-w-xl">
      <button onClick={() => navigate(-1)} className="text-blue-600 text-sm mb-4 hover:underline">
        &larr; Terug
      </button>

      <div className="bg-white rounded-2xl shadow p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold capitalize">{log.pool_id}</h1>
          <div className="flex items-center gap-3">
            {editing ? (
              <div className="flex items-center gap-2">
                {/* Datum/tijd bewerkbaar */}
                <input
                  type="date"
                  className="border rounded-lg px-2 py-1 text-sm"
                  value={editValues.datum}
                  onChange={(e) => setVal("datum", e.target.value)}
                />
                <input
                  type="time"
                  className="border rounded-lg px-2 py-1 text-sm"
                  value={editValues.tijd}
                  onChange={(e) => setVal("tijd", e.target.value)}
                />
              </div>
            ) : (
              <span className="text-gray-500 text-sm">{log.datum} {log.tijd}</span>
            )}
          </div>
        </div>

        {editing ? (
          /* Bewerkformulier */
          <div className="space-y-2">
            {EDITABLE_FIELDS.map((f) => (
              <div key={f.key} className="flex items-center justify-between py-1.5 border-b border-gray-100">
                <label className="text-gray-500 text-sm">{f.label}</label>
                <input
                  type={f.type}
                  step={f.step}
                  className="border rounded-lg px-2 py-1 text-sm w-40 text-right"
                  value={editValues[f.key] ?? ""}
                  onChange={(e) => setVal(f.key, e.target.value)}
                />
              </div>
            ))}

            <div className="flex items-center justify-between py-1.5 border-b border-gray-100">
              <label className="text-gray-500 text-sm">Filterspoeling</label>
              <select
                className="border rounded-lg px-2 py-1 text-sm w-40 text-right"
                value={editValues.filterspoeling || ""}
                onChange={(e) => setVal("filterspoeling", e.target.value || null)}
              >
                <option value="">Nee</option>
                {log?.pool_id === "zwembad" ? (
                  <>
                    <option value="L">Links (L)</option>
                    <option value="R">Rechts (R)</option>
                  </>
                ) : (
                  <option value="X">Ja</option>
                )}
              </select>
            </div>

            {error && <p className="text-red-600 text-sm mt-2">{error}</p>}

            <div className="flex gap-2 pt-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Opslaan..." : "Opslaan"}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="border px-5 py-2 rounded-lg text-sm hover:bg-gray-50"
              >
                Annuleren
              </button>
            </div>
          </div>
        ) : (
          /* Weergave */
          <>
            <Row label="Doorzicht" value={log.doorzicht} />
            <Row label="Water temperatuur" value={log.water_temp ? `${log.water_temp} °C` : null} />
            <Row label="pH" value={log.ph} className={valClass(log.ph, 7.0, 7.6)} />
            <Row label="VBC in" value={log.vbc_in} className={valClass(log.vbc_in, 0.5, 1.5)} />
            <Row label="VBC uit" value={log.vbc_uit} className={valClass(log.vbc_uit, 0.5, 1.5)} />
            <Row label="TBC" value={log.tbc} />
            <Row label="Gebonden chloor" value={log.gbc} className={valClass(log.gbc, 0, 0.6)} />
            <Row label="pH automaat" value={log.ph_automaat} className={valClass(log.ph_automaat, 7.0, 7.6)} />
            <Row label="VBC automaat" value={log.vbc_automaat} className={valClass(log.vbc_automaat, 0.5, 1.5)} />
            <Row label="Watermeter" value={log.watermeter} />
            <Row label="Verbruik" value={log.verbruik} />
            <Row label="Flow" value={log.flow} />
            <Row label="Filterspoeling" value={log.filterspoeling || "Nee"} />
            <Row label="Aantal zwemmers" value={log.bezoekers} />
            <Row label="Gemeten door" value={log.gemeten_door} />
            {log.notitie && (
              <div className="mt-4 p-3 bg-yellow-50 rounded-lg text-sm">
                <span className="font-medium">Notitie:</span> {log.notitie}
              </div>
            )}

            {isAdmin && (
              <div className="mt-4 pt-3 border-t border-gray-100">
                <button
                  onClick={startEdit}
                  className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-blue-700"
                >
                  Aanpassen
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
