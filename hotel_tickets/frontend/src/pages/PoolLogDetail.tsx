import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { poolApi, type PoolLog } from "../api/client";

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

export default function PoolLogDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [log, setLog] = useState<PoolLog | null>(null);

  useEffect(() => {
    if (id) poolApi.get(id).then((r) => setLog(r.data));
  }, [id]);

  if (!log) return <p className="text-gray-400 p-4">Laden...</p>;

  return (
    <div className="max-w-xl">
      <button onClick={() => navigate(-1)} className="text-blue-600 text-sm mb-4 hover:underline">
        ← Terug
      </button>

      <div className="bg-white rounded-2xl shadow p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold capitalize">{log.pool_id}</h1>
          <span className="text-gray-500 text-sm">{log.datum} {log.tijd}</span>
        </div>

        <Row label="Doorzicht" value={log.doorzicht} />
        <Row label="Water temperatuur" value={log.water_temp ? `${log.water_temp} °C` : null} />
        <Row label="pH" value={log.ph} className={valClass(log.ph, 7.0, 7.6)} />
        <Row label="VBC in" value={log.vbc_in} className={valClass(log.vbc_in, 0.5, 1.5)} />
        <Row label="VBC uit" value={log.vbc_uit} className={valClass(log.vbc_uit, 0.5, 1.5)} />
        <Row label="TBC" value={log.tbc} />
        <Row label="GBC" value={log.gbc} className={valClass(log.gbc, 0, 0.6)} />
        <Row label="pH automaat" value={log.ph_automaat} className={valClass(log.ph_automaat, 7.0, 7.6)} />
        <Row label="VBC automaat" value={log.vbc_automaat} className={valClass(log.vbc_automaat, 0.5, 1.5)} />
        <Row label="Watermeter" value={log.watermeter} />
        <Row label="Verbruik" value={log.verbruik} />
        <Row label="Filterspoeling" value={log.filterspoeling ? "Ja" : "Nee"} />
        <Row label="Bezoekers" value={log.bezoekers} />
        <Row label="Reiniging" value={log.reiniging ? "Ja" : "Nee"} />
        <Row label="Flow" value={log.flow} />
        <Row label="Chemicaliën" value={log.chemicalien} />
        <Row label="Gemeten door" value={log.gemeten_door} />
        {log.notitie && (
          <div className="mt-4 p-3 bg-yellow-50 rounded-lg text-sm">
            <span className="font-medium">Notitie:</span> {log.notitie}
          </div>
        )}
      </div>
    </div>
  );
}
