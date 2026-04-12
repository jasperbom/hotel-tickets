import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { poolApi, type PoolLog } from "../api/client";

function valClass(val: number | null, low: number, high: number): string {
  if (val === null) return "";
  if (val < low || val > high) return "bg-red-100 text-red-700 font-bold";
  return "";
}

export default function PoolLogboek() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [logs, setLogs] = useState<PoolLog[]>([]);
  const [loading, setLoading] = useState(true);

  const pool = searchParams.get("pool") || "";
  const datumVan = searchParams.get("datum_van") || "";
  const datumTot = searchParams.get("datum_tot") || "";

  useEffect(() => {
    const params: Record<string, string> = {};
    if (pool) params.pool_id = pool;
    if (datumVan) params.datum_van = datumVan;
    if (datumTot) params.datum_tot = datumTot;
    poolApi.list(params).then((r) => { setLogs(r.data); setLoading(false); });
  }, [pool, datumVan, datumTot]);

  function setFilter(key: string, val: string) {
    const p = new URLSearchParams(searchParams);
    if (val) p.set(key, val);
    else p.delete(key);
    setSearchParams(p);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Logboek</h1>
        <button
          onClick={() => navigate("/pools/nieuw")}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700"
        >
          + Nieuwe meting
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <select
          className="border rounded-lg px-3 py-2 text-sm"
          value={pool}
          onChange={(e) => setFilter("pool", e.target.value)}
        >
          <option value="">Alle baden</option>
          <option value="wellness">Wellness</option>
          <option value="zwembad">Zwembad</option>
        </select>
        <input
          type="date"
          className="border rounded-lg px-3 py-2 text-sm"
          value={datumVan}
          onChange={(e) => setFilter("datum_van", e.target.value)}
          placeholder="Van"
        />
        <input
          type="date"
          className="border rounded-lg px-3 py-2 text-sm"
          value={datumTot}
          onChange={(e) => setFilter("datum_tot", e.target.value)}
          placeholder="Tot"
        />
      </div>

      {loading ? (
        <p className="text-gray-400">Laden...</p>
      ) : logs.length === 0 ? (
        <p className="text-gray-400">Geen metingen gevonden.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm bg-white rounded-xl shadow">
            <thead>
              <tr className="bg-gray-100 text-left">
                <th className="px-3 py-2">Bad</th>
                <th className="px-3 py-2">Datum</th>
                <th className="px-3 py-2">Tijd</th>
                <th className="px-3 py-2">Temp</th>
                <th className="px-3 py-2">pH</th>
                <th className="px-3 py-2">VBC in</th>
                <th className="px-3 py-2">VBC uit</th>
                <th className="px-3 py-2">GBC</th>
                <th className="px-3 py-2">pH aut.</th>
                <th className="px-3 py-2">VBC aut.</th>
                <th className="px-3 py-2">Flow</th>
                <th className="px-3 py-2">Bezoekers</th>
                <th className="px-3 py-2">Gemeten door</th>
                <th className="px-3 py-2">Notitie</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr
                  key={l.id}
                  className="border-t hover:bg-gray-50 cursor-pointer"
                  onClick={() => navigate(`/pools/log/${l.id}`)}
                >
                  <td className="px-3 py-2 capitalize">{l.pool_id}</td>
                  <td className="px-3 py-2">{l.datum}</td>
                  <td className="px-3 py-2">{l.tijd}</td>
                  <td className="px-3 py-2">{l.water_temp ?? "-"}</td>
                  <td className={`px-3 py-2 ${valClass(l.ph, 7.0, 7.6)}`}>{l.ph ?? "-"}</td>
                  <td className={`px-3 py-2 ${valClass(l.vbc_in, 0.5, 1.5)}`}>{l.vbc_in ?? "-"}</td>
                  <td className={`px-3 py-2 ${valClass(l.vbc_uit, 0.5, 1.5)}`}>{l.vbc_uit ?? "-"}</td>
                  <td className={`px-3 py-2 ${valClass(l.gbc, 0, 0.6)}`}>{l.gbc ?? "-"}</td>
                  <td className={`px-3 py-2 ${valClass(l.ph_automaat, 7.0, 7.6)}`}>{l.ph_automaat ?? "-"}</td>
                  <td className={`px-3 py-2 ${valClass(l.vbc_automaat, 0.5, 1.5)}`}>{l.vbc_automaat ?? "-"}</td>
                  <td className="px-3 py-2">{l.flow ?? "-"}</td>
                  <td className="px-3 py-2">{l.bezoekers ?? "-"}</td>
                  <td className="px-3 py-2">{l.gemeten_door}</td>
                  <td className="px-3 py-2 max-w-[200px] truncate">{l.notitie || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
