import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { poolApi, type PoolLog } from "../api/client";
import { valueClass } from "../components/PoolValueVisualization";

export default function PoolLogboek() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [logs, setLogs] = useState<PoolLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

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

  async function handleExport() {
    setExporting(true);
    try {
      const params: Record<string, string> = {};
      if (pool) params.pool_id = pool;
      if (datumVan) params.datum_van = datumVan;
      if (datumTot) params.datum_tot = datumTot;
      const r = await poolApi.exportCsv(params);
      const filename = pool ? `logboek_${pool}.csv` : "logboek_export.zip";
      const url = URL.createObjectURL(r.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  }

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
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="bg-white border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            {exporting ? "Exporteren..." : "Export CSV"}
          </button>
          <button
            onClick={() => navigate(`/pools/nieuw${pool ? `?pool=${pool}` : ""}`)}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700"
          >
            + Nieuwe meting
          </button>
        </div>
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
          <table className="w-full text-sm bg-white rounded-xl shadow border-separate border-spacing-0">
            <thead>
              <tr className="bg-gray-100 text-left text-xs text-gray-500 uppercase tracking-wide">
                <th className="px-3 py-2.5 rounded-tl-xl">Bad</th>
                <th className="px-3 py-2.5">Datum</th>
                <th className="px-3 py-2.5">Tijd</th>
                <th className="px-3 py-2.5 border-l border-gray-200">Temp</th>
                <th className="px-3 py-2.5">Doorzicht</th>
                <th className="px-3 py-2.5">pH</th>
                <th className="px-3 py-2.5">VBC in</th>
                <th className="px-3 py-2.5">VBC uit</th>
                <th className="px-3 py-2.5">TBC</th>
                <th className="px-3 py-2.5">Geb. chloor</th>
                <th className="px-3 py-2.5 border-l border-gray-200">pH aut.</th>
                <th className="px-3 py-2.5">VBC aut.</th>
                <th className="px-3 py-2.5">Watermeter</th>
                <th className="px-3 py-2.5">Verbruik</th>
                <th className="px-3 py-2.5">Flow</th>
                <th className="px-3 py-2.5">Filterspoeling</th>
                <th className="px-3 py-2.5 border-l border-gray-200">Bezoekers</th>
                <th className="px-3 py-2.5">Chemicaliën</th>
                <th className="px-3 py-2.5">Gemeten door</th>
                <th className="px-3 py-2.5 rounded-tr-xl">Notitie</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l, i) => (
                <tr
                  key={l.id}
                  className={`border-t border-gray-100 cursor-pointer hover:bg-blue-50 transition-colors ${i % 2 === 1 ? "bg-gray-50" : ""}`}
                  onClick={() => navigate(`/pools/log/${l.id}`)}
                >
                  <td className="px-3 py-2 capitalize font-medium">{l.pool_id}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{l.datum}</td>
                  <td className="px-3 py-2">{l.tijd}</td>
                  <td className="px-3 py-2 border-l border-gray-100">{l.water_temp ?? "-"}</td>
                  <td className="px-3 py-2">{l.doorzicht ?? "-"}</td>
                  <td className={`px-3 py-2 ${valueClass("ph", l.ph, "table")}`}>{l.ph ?? "-"}</td>
                  <td className={`px-3 py-2 ${valueClass("vbc_in", l.vbc_in, "table")}`}>{l.vbc_in ?? "-"}</td>
                  <td className={`px-3 py-2 ${valueClass("vbc_uit", l.vbc_uit, "table")}`}>{l.vbc_uit ?? "-"}</td>
                  <td className="px-3 py-2">{l.tbc ?? "-"}</td>
                  <td className={`px-3 py-2 ${valueClass("gbc", l.gbc, "table")}`}>{l.gbc ?? "-"}</td>
                  <td className={`px-3 py-2 border-l border-gray-100 ${valueClass("ph", l.ph_automaat, "table")}`}>{l.ph_automaat ?? "-"}</td>
                  <td className={`px-3 py-2 ${valueClass("vbc_in", l.vbc_automaat, "table")}`}>{l.vbc_automaat ?? "-"}</td>
                  <td className="px-3 py-2">{l.watermeter ?? "-"}</td>
                  <td className="px-3 py-2">{l.verbruik ?? "-"}</td>
                  <td className="px-3 py-2">{l.flow ?? "-"}</td>
                  <td className="px-3 py-2">{l.filterspoeling || "-"}</td>
                  <td className="px-3 py-2 border-l border-gray-100">{l.bezoekers ?? "-"}</td>
                  <td className="px-3 py-2 max-w-[220px] truncate">{l.chemicalien || "-"}</td>
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
