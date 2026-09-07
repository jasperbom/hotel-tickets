import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { poolApi, type PoolId, type PoolLog } from "../api/client";
import { PoolGrafieken } from "../components/PoolGrafieken";

/**
 * Inzicht (zwembaden): kerncijfers en grafieken over een periode. Het logboek
 * zelf blijft een tabel; deze pagina leest dezelfde regels en laat zien wat
 * er in de cijfers zit.
 */

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

export default function PoolInzicht() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [logs, setLogs] = useState<PoolLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);

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
    const params: Record<string, string> = { limit: "500", only_measurements: "true" };
    if (pool) params.pool_id = pool;
    if (bereik.van) params.datum_van = bereik.van;
    if (bereik.tot) params.datum_tot = bereik.tot;
    let actueel = true;
    setFetching(true);
    poolApi
      .list(params)
      .then((r) => {
        if (actueel) setLogs(r.data);
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

  // Dezelfde selectie in het logboek openen.
  const logboekParams = new URLSearchParams();
  if (pool) logboekParams.set("pool", pool);
  if (bereik.van) logboekParams.set("datum_van", bereik.van);
  if (bereik.tot) logboekParams.set("datum_tot", bereik.tot);
  const logboekUrl = `/pools/logboek${logboekParams.toString() ? `?${logboekParams}` : ""}`;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold">Inzicht</h1>
        <button
          onClick={() => navigate(logboekUrl)}
          className="bg-paper-raised border border-ink-12 text-ink-70 px-4 py-2 rounded-lg text-sm hover:bg-ink-6"
        >
          Naar logboek
        </button>
      </div>

      {/* Filters — één rij, geldt voor alles eronder */}
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
        <PoolGrafieken
          logs={logs}
          pool={pool}
          datumVan={bereik.van}
          datumTot={bereik.tot}
          laden={fetching}
        />
      )}
    </div>
  );
}
