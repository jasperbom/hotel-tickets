import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { poolApi, type PoolStatus } from "../api/client";

/** Kleurcodering conform BAL-normen */
function valClass(val: number | null, low: number, high: number): string {
  if (val === null) return "";
  if (val < low || val > high) return "text-red-600 font-bold";
  return "text-green-700";
}

function StatusCard({ pool }: { pool: PoolStatus }) {
  const navigate = useNavigate();
  const l = pool.latest;

  return (
    <div
      className="bg-white rounded-2xl shadow p-5 cursor-pointer hover:shadow-lg transition-shadow"
      onClick={() => navigate(`/pools/logboek?pool=${pool.pool_id}`)}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">{pool.label}</h2>
        <span
          className={`px-3 py-1 rounded-full text-sm font-semibold ${
            pool.compliant
              ? "bg-green-100 text-green-800"
              : "bg-red-100 text-red-800"
          }`}
        >
          {pool.measurements_today}/2 metingen
        </span>
      </div>

      {l ? (
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <span className="text-gray-500 block">Datum</span>
            <span className="font-medium">{l.datum} {l.tijd}</span>
          </div>
          <div>
            <span className="text-gray-500 block">Water temp</span>
            <span className="font-medium">{l.water_temp ?? "-"} °C</span>
          </div>
          <div>
            <span className="text-gray-500 block">Doorzicht</span>
            <span className="font-medium">{l.doorzicht ?? "-"}</span>
          </div>
          <div>
            <span className="text-gray-500 block">pH</span>
            <span className={`font-medium ${valClass(l.ph, 7.0, 7.6)}`}>{l.ph ?? "-"}</span>
          </div>
          <div>
            <span className="text-gray-500 block">VBC in</span>
            <span className={`font-medium ${valClass(l.vbc_in, 0.5, 1.5)}`}>{l.vbc_in ?? "-"}</span>
          </div>
          <div>
            <span className="text-gray-500 block">VBC uit</span>
            <span className={`font-medium ${valClass(l.vbc_uit, 0.5, 1.5)}`}>{l.vbc_uit ?? "-"}</span>
          </div>
          <div>
            <span className="text-gray-500 block">GBC</span>
            <span className={`font-medium ${valClass(l.gbc, 0, 0.6)}`}>{l.gbc ?? "-"}</span>
          </div>
          <div>
            <span className="text-gray-500 block">Flow</span>
            <span className="font-medium">{l.flow ?? "-"}</span>
          </div>
          <div>
            <span className="text-gray-500 block">Gemeten door</span>
            <span className="font-medium">{l.gemeten_door}</span>
          </div>
        </div>
      ) : (
        <p className="text-gray-400 italic">Nog geen metingen</p>
      )}

      {/* Nieuwe meting knop */}
      <div className="mt-4 pt-3 border-t border-gray-100">
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/pools/nieuw?pool=${pool.pool_id}`);
          }}
          className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          + Nieuwe meting
        </button>
      </div>
    </div>
  );
}

export default function PoolOverzicht() {
  const [status, setStatus] = useState<PoolStatus[]>([]);
  const [loading, setLoading] = useState(true);

  function loadStatus() {
    poolApi.status().then((r) => { setStatus(r.data); setLoading(false); });
  }

  useEffect(() => { loadStatus(); }, []);

  if (loading) return <p className="p-4 text-gray-400">Laden...</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Zwembaden overzicht</h1>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {status.map((p) => (
          <StatusCard key={p.pool_id} pool={p} />
        ))}
      </div>
    </div>
  );
}
