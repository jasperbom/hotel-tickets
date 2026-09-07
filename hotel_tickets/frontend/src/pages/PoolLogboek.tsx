import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { poolApi, formatDateNL, type PoolLog } from "../api/client";
import { valueClass } from "../components/PoolValueVisualization";
import { PeriodeFilters, PeriodeKop, apiParams, laadAlleLogs, usePoolPeriode } from "../components/PoolPeriode";

/**
 * Logboek (zwembaden): de tabel met alle logregels van een periode. De
 * periodekeuze (knoppen, pijltjes, eigen datums) is dezelfde als op Inzicht,
 * en de selectie reist mee tussen de twee pagina's.
 */
export default function PoolLogboek() {
  const navigate = useNavigate();
  const p = usePoolPeriode();
  const [logs, setLogs] = useState<PoolLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let actueel = true;
    setFetching(true);
    laadAlleLogs(apiParams(p))
      .then((alles) => {
        if (actueel) setLogs(alles);
      })
      .finally(() => {
        if (!actueel) return;
        setLoading(false);
        setFetching(false);
      });
    return () => {
      actueel = false;
    };
  }, [p.pool, p.bereik.van, p.bereik.tot]);

  async function handleExport() {
    setExporting(true);
    try {
      const r = await poolApi.exportCsv(apiParams(p));
      const filename = p.pool ? `logboek_${p.pool}.csv` : "logboek_export.zip";
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

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Logboek</h1>
          <PeriodeKop p={p} />
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => navigate(`/pools/inzicht${p.query}`)}
            className="bg-paper-raised border border-ink-12 text-ink-70 px-4 py-2 rounded-lg text-sm hover:bg-ink-6"
          >
            Inzicht
          </button>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="bg-paper-raised border border-ink-12 text-ink-70 px-4 py-2 rounded-lg text-sm hover:bg-ink-6 disabled:opacity-50"
          >
            {exporting ? "Exporteren..." : "Export CSV"}
          </button>
          <button
            onClick={() => navigate(`/pools/nieuw${p.pool ? `?pool=${p.pool}` : ""}`)}
            className="bg-brand text-white px-4 py-2 rounded-lg text-sm hover:opacity-90"
          >
            + Nieuwe meting
          </button>
        </div>
      </div>

      <PeriodeFilters p={p} />

      {loading ? (
        <p className="text-ink-45">Laden...</p>
      ) : logs.length === 0 ? (
        <p className="text-ink-45">Geen logregels in deze periode.</p>
      ) : (
        <>
          <p className="meta mb-2">
            {logs.length} {logs.length === 1 ? "regel" : "regels"}
          </p>
          <div className={`overflow-x-auto transition-opacity ${fetching ? "opacity-60" : ""}`}>
            <table className="w-full text-sm bg-paper-raised rounded-xl shadow border-separate border-spacing-0">
              <thead>
                <tr className="bg-ink-6 text-left text-xs text-ink-45 uppercase tracking-wide">
                  <th className="px-3 py-2.5 rounded-tl-xl">Bad</th>
                  <th className="px-3 py-2.5">Datum</th>
                  <th className="px-3 py-2.5">Tijd</th>
                  <th className="px-3 py-2.5 border-l border-ink-12">Temp</th>
                  <th className="px-3 py-2.5">Doorzicht</th>
                  <th className="px-3 py-2.5">pH</th>
                  <th className="px-3 py-2.5">VBC in</th>
                  <th className="px-3 py-2.5">VBC uit</th>
                  <th className="px-3 py-2.5">TBC</th>
                  <th className="px-3 py-2.5">Geb. chloor</th>
                  <th className="px-3 py-2.5 border-l border-ink-12">pH aut.</th>
                  <th className="px-3 py-2.5">VBC aut.</th>
                  <th className="px-3 py-2.5">Watermeter</th>
                  <th className="px-3 py-2.5">Verbruik</th>
                  <th className="px-3 py-2.5">Flow</th>
                  <th className="px-3 py-2.5">Filterspoeling</th>
                  <th className="px-3 py-2.5 border-l border-ink-12">Bezoekers</th>
                  <th className="px-3 py-2.5">Chemicaliën</th>
                  <th className="px-3 py-2.5">Gemeten door</th>
                  <th className="px-3 py-2.5 rounded-tr-xl">Notitie</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l, i) => (
                  <tr
                    key={l.id}
                    className={`border-t border-ink-6 cursor-pointer hover:bg-ink-6 transition-colors ${i % 2 === 1 ? "bg-ink-6" : ""}`}
                    onClick={() => navigate(`/pools/log/${l.id}`)}
                  >
                    <td className="px-3 py-2 capitalize font-medium">{l.pool_id}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatDateNL(l.datum)}</td>
                    <td className="px-3 py-2">{l.tijd}</td>
                    <td className="px-3 py-2 border-l border-ink-6">{l.water_temp ?? "-"}</td>
                    <td className="px-3 py-2">{l.doorzicht ?? "-"}</td>
                    <td className={`px-3 py-2 ${valueClass("ph", l.ph, "table")}`}>{l.ph ?? "-"}</td>
                    <td className={`px-3 py-2 ${valueClass("vbc_in", l.vbc_in, "table")}`}>{l.vbc_in ?? "-"}</td>
                    <td className={`px-3 py-2 ${valueClass("vbc_uit", l.vbc_uit, "table")}`}>{l.vbc_uit ?? "-"}</td>
                    <td className="px-3 py-2">{l.tbc ?? "-"}</td>
                    <td className={`px-3 py-2 ${valueClass("gbc", l.gbc, "table")}`}>{l.gbc ?? "-"}</td>
                    <td className={`px-3 py-2 border-l border-ink-6 ${valueClass("ph", l.ph_automaat, "table")}`}>{l.ph_automaat ?? "-"}</td>
                    <td className={`px-3 py-2 ${valueClass("vbc_in", l.vbc_automaat, "table")}`}>{l.vbc_automaat ?? "-"}</td>
                    <td className="px-3 py-2">{l.watermeter ?? "-"}</td>
                    <td className="px-3 py-2">{l.verbruik ?? "-"}</td>
                    <td className="px-3 py-2">{l.flow ?? "-"}</td>
                    <td className="px-3 py-2">{l.filterspoeling || "-"}</td>
                    <td className="px-3 py-2 border-l border-ink-6">{l.bezoekers ?? "-"}</td>
                    <td className="px-3 py-2 max-w-[220px] truncate">{l.chemicalien || "-"}</td>
                    <td className="px-3 py-2">{l.gemeten_door}</td>
                    <td className="px-3 py-2 max-w-[200px] truncate">{l.notitie || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
