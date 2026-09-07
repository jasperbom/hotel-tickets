import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { poolApi, formatDateNL, type PoolId, type PoolLog } from "../api/client";
import { valueClass } from "../components/PoolValueVisualization";
import { PoolInzicht } from "../components/PoolInzicht";

// Periodekeuze: een vaste keuze uit de rij, of een eigen van/tot-datum.
// Zonder iets in de URL: de laatste 30 dagen — lang genoeg voor een trend,
// kort genoeg om per dag te kunnen lezen.
const PERIODES = [
  { id: "7", label: "7 dagen", dagen: 7 },
  { id: "30", label: "30 dagen", dagen: 30 },
  { id: "90", label: "90 dagen", dagen: 90 },
  { id: "jaar", label: "Dit jaar", dagen: null },
  { id: "alles", label: "Alles", dagen: null },
] as const;
type PeriodeId = (typeof PERIODES)[number]["id"];

const INZICHT_KEY = "pool_logboek_inzicht";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Vertaal de periodekeuze naar een effectieve van/tot-datum (ISO, leeg = geen grens). */
function periodeBereik(periode: PeriodeId): { van: string; tot: string } {
  const vandaag = new Date();
  if (periode === "alles") return { van: "", tot: "" };
  if (periode === "jaar") return { van: `${vandaag.getFullYear()}-01-01`, tot: isoDate(vandaag) };
  const p = PERIODES.find((x) => x.id === periode);
  const dagen = p?.dagen ?? 30;
  const van = new Date(vandaag);
  van.setDate(van.getDate() - (dagen - 1));
  return { van: isoDate(van), tot: isoDate(vandaag) };
}

export default function PoolLogboek() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [logs, setLogs] = useState<PoolLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toonInzicht, setToonInzicht] = useState<boolean>(() => {
    try {
      return localStorage.getItem(INZICHT_KEY) !== "0";
    } catch {
      return true;
    }
  });

  const pool = (searchParams.get("pool") || "") as PoolId | "";
  const datumVan = searchParams.get("datum_van") || "";
  const datumTot = searchParams.get("datum_tot") || "";
  const eigenBereik = Boolean(datumVan || datumTot);
  const periode: PeriodeId | null = eigenBereik
    ? null
    : ((PERIODES.find((p) => p.id === searchParams.get("periode"))?.id ?? "30") as PeriodeId);

  // Effectieve grenzen: eigen datums winnen, anders de gekozen periode.
  const bereik = periode ? periodeBereik(periode) : { van: datumVan, tot: datumTot };

  useEffect(() => {
    const params: Record<string, string> = { limit: "500" };
    if (pool) params.pool_id = pool;
    if (bereik.van) params.datum_van = bereik.van;
    if (bereik.tot) params.datum_tot = bereik.tot;
    let actueel = true;
    setFetching(true);
    poolApi
      .list(params)
      .then((r) => {
        if (!actueel) return;
        setLogs(r.data);
      })
      .finally(() => {
        if (!actueel) return;
        setLoading(false);
        setFetching(false);
      });
    return () => {
      actueel = false;
    };
  }, [pool, bereik.van, bereik.tot]);

  async function handleExport() {
    setExporting(true);
    try {
      const params: Record<string, string> = {};
      if (pool) params.pool_id = pool;
      if (bereik.van) params.datum_van = bereik.van;
      if (bereik.tot) params.datum_tot = bereik.tot;
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
    // Een eigen datum maakt de vaste periode ongeldig, en andersom.
    if (key === "datum_van" || key === "datum_tot") p.delete("periode");
    if (key === "periode") {
      p.delete("datum_van");
      p.delete("datum_tot");
    }
    setSearchParams(p);
  }

  function toggleInzicht() {
    const volgende = !toonInzicht;
    setToonInzicht(volgende);
    try {
      localStorage.setItem(INZICHT_KEY, volgende ? "1" : "0");
    } catch {
      /* geen opslag — dan onthouden we het niet */
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Logboek</h1>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            disabled={exporting}
            className="bg-paper-raised border border-ink-12 text-ink-70 px-4 py-2 rounded-lg text-sm hover:bg-ink-6 disabled:opacity-50"
          >
            {exporting ? "Exporteren..." : "Export CSV"}
          </button>
          <button
            onClick={() => navigate(`/pools/nieuw${pool ? `?pool=${pool}` : ""}`)}
            className="bg-brand text-white px-4 py-2 rounded-lg text-sm hover:opacity-90"
          >
            + Nieuwe meting
          </button>
        </div>
      </div>

      {/* Filters — één rij, geldt voor de grafieken én de tabel eronder */}
      <div className="flex gap-3 mb-4 flex-wrap items-center">
        <select
          className="border rounded-lg px-3 py-2 text-sm"
          value={pool}
          onChange={(e) => setFilter("pool", e.target.value)}
        >
          <option value="">Alle baden</option>
          <option value="wellness">Wellness</option>
          <option value="zwembad">Zwembad</option>
        </select>
        <div className="flex gap-1 overflow-x-auto scrollbar-none">
          {PERIODES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setFilter("periode", p.id)}
              aria-pressed={periode === p.id}
              className={`chip ${periode === p.id ? "chip-aan" : ""}`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 items-center">
          <input
            type="date"
            className="border rounded-lg px-3 py-2 text-sm"
            value={datumVan}
            onChange={(e) => setFilter("datum_van", e.target.value)}
            aria-label="Van"
          />
          <span className="text-ink-45 text-sm">t/m</span>
          <input
            type="date"
            className="border rounded-lg px-3 py-2 text-sm"
            value={datumTot}
            onChange={(e) => setFilter("datum_tot", e.target.value)}
            aria-label="Tot en met"
          />
        </div>
      </div>

      {loading ? (
        <p className="text-ink-45">Laden...</p>
      ) : (
        <>
          {/* Inzicht: kerncijfers en grafieken over dezelfde selectie */}
          <section className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <p className="font-mono text-xs uppercase tracking-[0.14em] text-ink-45">Inzicht</p>
              <button
                type="button"
                onClick={toggleInzicht}
                aria-expanded={toonInzicht}
                className="text-sm text-ink-70 hover:text-ink underline-offset-2 hover:underline"
              >
                {toonInzicht ? "Grafieken verbergen" : "Grafieken tonen"}
              </button>
            </div>
            {toonInzicht && (
              <PoolInzicht
                logs={logs}
                pool={pool}
                datumVan={bereik.van}
                datumTot={bereik.tot}
                laden={fetching}
              />
            )}
          </section>

          <div className="flex items-center justify-between mb-3">
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-ink-45">Logregels</p>
            <p className="meta">
              {logs.length} {logs.length === 1 ? "regel" : "regels"}
              {logs.length >= 500 && " (maximaal 500 — kies een kortere periode voor alles)"}
            </p>
          </div>

          {logs.length === 0 ? (
            <p className="text-ink-45">Geen metingen gevonden.</p>
          ) : (
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
          )}
        </>
      )}
    </div>
  );
}
