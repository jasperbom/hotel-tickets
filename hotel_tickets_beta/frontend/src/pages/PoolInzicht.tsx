import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { poolApi, type PoolId, type PoolLog } from "../api/client";
import { PoolGrafieken } from "../components/PoolGrafieken";

/**
 * Inzicht (zwembaden): kerncijfers en grafieken over een periode. Het logboek
 * zelf blijft een tabel; deze pagina leest dezelfde regels en laat zien wat
 * er in de cijfers zit.
 */

// Periodekeuze: een vaste keuze uit de rij, of een eigen van/tot-datum.
// Zonder iets in de URL: de laatste 30 dagen — lang genoeg voor een trend,
// kort genoeg om per dag te kunnen lezen. Met de pijltjes schuif je een
// periode terug (parameter `terug` = aantal stappen) of weer vooruit.
const PERIODES = [
  { id: "7", label: "7 dagen" },
  { id: "30", label: "30 dagen" },
  { id: "90", label: "90 dagen" },
  { id: "kwartaal", label: "Kwartaal" },
  { id: "jaar", label: "Jaar" },
  { id: "alles", label: "Alles" },
] as const;
type PeriodeId = (typeof PERIODES)[number]["id"];

const MAANDEN = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];

function isoDate(d: Date): string {
  // Op de middag, zodat de UTC-conversie van toISOString nooit een dag verschuift.
  const k = new Date(d);
  k.setHours(12, 0, 0, 0);
  return k.toISOString().slice(0, 10);
}

function vanIso(iso: string): Date {
  return new Date(`${iso}T12:00:00`);
}

function plusDagen(iso: string, n: number): string {
  const d = vanIso(iso);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

function dagenTussen(van: string, tot: string): number {
  return Math.round((vanIso(tot).getTime() - vanIso(van).getTime()) / 86400000) + 1;
}

function minIso(a: string, b: string): string {
  return a <= b ? a : b;
}

/** "7 september 2026" */
function langeDatum(iso: string): string {
  const d = vanIso(iso);
  return `${d.getDate()} ${MAANDEN[d.getMonth()]} ${d.getFullYear()}`;
}

/** "1 t/m 7 september 2026", "25 augustus t/m 7 september 2026" of met beide jaren. */
function bereikTekst(van: string, tot: string): string {
  if (van === tot) return langeDatum(van);
  const a = vanIso(van);
  const b = vanIso(tot);
  if (a.getFullYear() === b.getFullYear()) {
    if (a.getMonth() === b.getMonth()) {
      return `${a.getDate()} t/m ${b.getDate()} ${MAANDEN[b.getMonth()]} ${b.getFullYear()}`;
    }
    return `${a.getDate()} ${MAANDEN[a.getMonth()]} t/m ${b.getDate()} ${MAANDEN[b.getMonth()]} ${b.getFullYear()}`;
  }
  return `${langeDatum(van)} t/m ${langeDatum(tot)}`;
}

type Bereik = {
  /** Effectieve grenzen voor de data (ISO); leeg = geen grens */
  van: string;
  tot: string;
  /** Wat er in de titel staat */
  tekst: string;
  /** Kunnen de pijltjes? (Alles en een half ingevulde eigen datum niet) */
  schuifbaar: boolean;
};

/**
 * Vertaal periodekeuze + aantal stappen terug naar een bereik. Kalender-
 * periodes (kwartaal, jaar) lopen tot hun einde maar de data-grens stopt bij
 * vandaag, anders kleuren toekomstige dagen rood als "niet gemeten".
 */
function berekenBereik(periode: PeriodeId, terug: number, vandaag: string): Bereik {
  const nu = vanIso(vandaag);
  if (periode === "alles") {
    return { van: "", tot: "", tekst: "alles sinds de eerste meting", schuifbaar: false };
  }
  if (periode === "kwartaal") {
    const kwartaalIndex = nu.getFullYear() * 4 + Math.floor(nu.getMonth() / 3) - terug;
    const jaar = Math.floor(kwartaalIndex / 4);
    const k = kwartaalIndex - jaar * 4; // 0..3
    const van = isoDate(new Date(jaar, k * 3, 1));
    const einde = isoDate(new Date(jaar, k * 3 + 3, 0));
    return {
      van,
      tot: minIso(einde, vandaag),
      tekst: `${k + 1}e kwartaal ${jaar} · ${bereikTekst(van, einde)}`,
      schuifbaar: true,
    };
  }
  if (periode === "jaar") {
    const jaar = nu.getFullYear() - terug;
    const van = `${jaar}-01-01`;
    const einde = `${jaar}-12-31`;
    return { van, tot: minIso(einde, vandaag), tekst: `${jaar}`, schuifbaar: true };
  }
  const dagen = Number(periode);
  const tot = plusDagen(vandaag, -terug * dagen);
  const van = plusDagen(tot, -(dagen - 1));
  return { van, tot, tekst: bereikTekst(van, tot), schuifbaar: true };
}

/**
 * Alle logregels van een selectie, in pagina's van 500 (het maximum van de
 * API). Eén verzoek gaf hooguit de nieuwste 500 regels — bij twee baden met
 * twee metingen per dag is dat maar vier maanden, en alles daarvóór kleurde
 * dan ten onrechte rood als "niet gemeten".
 */
const PAGINA = 500;
const MAX_PAGINAS = 40; // 20.000 regels; ruim tien jaar dagelijks meten

async function laadAlleLogs(params: Record<string, string>): Promise<PoolLog[]> {
  const alles: PoolLog[] = [];
  for (let i = 0; i < MAX_PAGINAS; i++) {
    const r = await poolApi.list({ ...params, limit: String(PAGINA), offset: String(i * PAGINA) });
    alles.push(...r.data);
    if (r.data.length < PAGINA) break;
  }
  return alles;
}

export default function PoolInzicht() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const [logs, setLogs] = useState<PoolLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  // Per bad de datum van de allereerste meting: daarvóór werd er nog niet
  // gemeten, dus die dagen tellen niet als "gemist".
  const [eersteMeting, setEersteMeting] = useState<Partial<Record<PoolId, string | null>>>({});

  useEffect(() => {
    poolApi
      .status()
      .then((r) => {
        const map: Partial<Record<PoolId, string | null>> = {};
        for (const p of r.data) map[p.pool_id as PoolId] = p.first_measurement ?? null;
        setEersteMeting(map);
      })
      .catch(() => {});
  }, []);

  const pool = (searchParams.get("pool") || "") as PoolId | "";
  const datumVan = searchParams.get("datum_van") || "";
  const datumTot = searchParams.get("datum_tot") || "";
  const eigenBereik = Boolean(datumVan || datumTot);
  const periode: PeriodeId | null = eigenBereik
    ? null
    : ((PERIODES.find((p) => p.id === searchParams.get("periode"))?.id ?? "30") as PeriodeId);
  const terug = Math.max(0, parseInt(searchParams.get("terug") || "0", 10) || 0);
  const vandaag = isoDate(new Date());

  // Effectieve grenzen: eigen datums winnen, anders de gekozen periode.
  let bereik: Bereik;
  if (periode) {
    bereik = berekenBereik(periode, terug, vandaag);
  } else if (datumVan && datumTot) {
    bereik = { van: datumVan, tot: datumTot, tekst: bereikTekst(datumVan, datumTot), schuifbaar: true };
  } else if (datumVan) {
    bereik = { van: datumVan, tot: "", tekst: `vanaf ${langeDatum(datumVan)}`, schuifbaar: false };
  } else {
    bereik = { van: "", tot: datumTot, tekst: `t/m ${langeDatum(datumTot)}`, schuifbaar: false };
  }

  useEffect(() => {
    const params: Record<string, string> = { only_measurements: "true" };
    if (pool) params.pool_id = pool;
    if (bereik.van) params.datum_van = bereik.van;
    if (bereik.tot) params.datum_tot = bereik.tot;
    let actueel = true;
    setFetching(true);
    laadAlleLogs(params)
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
  }, [pool, bereik.van, bereik.tot]);

  function setFilter(key: string, val: string) {
    const p = new URLSearchParams(searchParams);
    if (val) p.set(key, val);
    else p.delete(key);
    // Een eigen datum maakt de vaste periode ongeldig, en andersom. Een
    // nieuwe keuze begint altijd weer bij "nu".
    if (key === "datum_van" || key === "datum_tot") {
      p.delete("periode");
      p.delete("terug");
    }
    if (key === "periode") {
      p.delete("datum_van");
      p.delete("datum_tot");
      p.delete("terug");
    }
    setSearchParams(p);
  }

  /** Eén periode terug (-1) of vooruit (+1). */
  function schuif(richting: -1 | 1) {
    const p = new URLSearchParams(searchParams);
    if (periode) {
      const nieuw = terug - richting;
      if (nieuw < 0) return;
      if (nieuw === 0) p.delete("terug");
      else p.set("terug", String(nieuw));
    } else if (datumVan && datumTot) {
      const lengte = dagenTussen(datumVan, datumTot);
      const van = plusDagen(datumVan, richting * lengte);
      const tot = plusDagen(datumTot, richting * lengte);
      if (richting === 1 && van > vandaag) return;
      p.set("datum_van", van);
      p.set("datum_tot", tot);
    }
    setSearchParams(p);
  }

  const kanVooruit = bereik.schuifbaar && (periode ? terug > 0 : Boolean(datumVan && datumTot && datumTot < vandaag));

  // Dezelfde selectie in het logboek openen.
  const logboekParams = new URLSearchParams();
  if (pool) logboekParams.set("pool", pool);
  if (bereik.van) logboekParams.set("datum_van", bereik.van);
  if (bereik.tot) logboekParams.set("datum_tot", bereik.tot);
  const logboekUrl = `/pools/logboek${logboekParams.toString() ? `?${logboekParams}` : ""}`;

  const pijlKlasse =
    "tap rounded-lg border border-ink-12 bg-paper-raised text-ink-70 hover:bg-ink-6 disabled:opacity-30 disabled:hover:bg-paper-raised";

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Inzicht</h1>
          <div className="flex items-center gap-2 mt-1">
            {bereik.schuifbaar && (
              <button
                type="button"
                onClick={() => schuif(-1)}
                className={pijlKlasse}
                aria-label="Vorige periode"
                title="Vorige periode"
              >
                <ChevronLeft size={20} aria-hidden="true" />
              </button>
            )}
            <p className="text-row font-medium text-ink truncate">{bereik.tekst}</p>
            {bereik.schuifbaar && (
              <button
                type="button"
                onClick={() => schuif(1)}
                disabled={!kanVooruit}
                className={pijlKlasse}
                aria-label="Volgende periode"
                title="Volgende periode"
              >
                <ChevronRight size={20} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        <button
          onClick={() => navigate(logboekUrl)}
          className="bg-paper-raised border border-ink-12 text-ink-70 px-4 py-2 rounded-lg text-sm hover:bg-ink-6 shrink-0"
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
          eersteMeting={eersteMeting}
          laden={fetching}
        />
      )}
    </div>
  );
}
