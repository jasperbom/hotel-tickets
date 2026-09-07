import { useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { poolApi, type PoolId, type PoolLog } from "../api/client";

/**
 * Periodekeuze voor de zwembadpagina's (Inzicht én Logboek): dezelfde
 * URL-parameters, dezelfde knoppen, dezelfde titelregel — zodat je van de
 * grafieken naar de tabel kunt springen zonder dat de selectie verandert.
 *
 *   ?pool=zwembad          één bad (leeg = alle baden)
 *   ?periode=7|30|90|kwartaal|jaar|alles   vaste keuze (standaard 30)
 *   ?terug=2               zoveel periodes terug (pijltjes)
 *   ?datum_van=&datum_tot= eigen bereik; wint van periode
 */

export const PERIODES = [
  { id: "7", label: "7 dagen" },
  { id: "30", label: "30 dagen" },
  { id: "90", label: "90 dagen" },
  { id: "kwartaal", label: "Kwartaal" },
  { id: "jaar", label: "Jaar" },
  { id: "alles", label: "Alles" },
] as const;
export type PeriodeId = (typeof PERIODES)[number]["id"];

const MAANDEN = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];

// ── Datumhulpjes ───────────────────────────────────────────────────────────

export function isoDate(d: Date): string {
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
export function langeDatum(iso: string): string {
  const d = vanIso(iso);
  return `${d.getDate()} ${MAANDEN[d.getMonth()]} ${d.getFullYear()}`;
}

/** "1 t/m 7 september 2026", "25 augustus t/m 7 september 2026" of met beide jaren. */
export function bereikTekst(van: string, tot: string): string {
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

// ── Bereik ─────────────────────────────────────────────────────────────────

export type Bereik = {
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
export function berekenBereik(periode: PeriodeId, terug: number, vandaag: string): Bereik {
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

// ── Hook ───────────────────────────────────────────────────────────────────

export type PoolPeriode = {
  pool: PoolId | "";
  periode: PeriodeId | null;
  terug: number;
  datumVan: string;
  datumTot: string;
  bereik: Bereik;
  kanVooruit: boolean;
  /** Filter wijzigen; eigen datum en vaste periode sluiten elkaar uit */
  setFilter: (key: "pool" | "periode" | "datum_van" | "datum_tot", val: string) => void;
  /** Eén periode terug (-1) of vooruit (+1) */
  schuif: (richting: -1 | 1) => void;
  /** De huidige selectie als querystring, om mee te nemen naar de andere pagina */
  query: string;
};

export function usePoolPeriode(): PoolPeriode {
  const [searchParams, setSearchParams] = useSearchParams();

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

  function setFilter(key: "pool" | "periode" | "datum_van" | "datum_tot", val: string) {
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

  const kanVooruit =
    bereik.schuifbaar && (periode ? terug > 0 : Boolean(datumVan && datumTot && datumTot < vandaag));

  const q = new URLSearchParams();
  for (const key of ["pool", "periode", "terug", "datum_van", "datum_tot"]) {
    const v = searchParams.get(key);
    if (v) q.set(key, v);
  }
  const query = q.toString() ? `?${q}` : "";

  return { pool, periode, terug, datumVan, datumTot, bereik, kanVooruit, setFilter, schuif, query };
}

// ── Onderdelen ─────────────────────────────────────────────────────────────

const PIJL =
  "tap rounded-lg border border-ink-12 bg-paper-raised text-ink-70 hover:bg-ink-6 disabled:opacity-30 disabled:hover:bg-paper-raised";

/** Pijltjes plus de tekst van de zichtbare periode, onder de paginatitel. */
export function PeriodeKop({ p }: { p: PoolPeriode }) {
  return (
    <div className="flex items-center gap-2 mt-1">
      {p.bereik.schuifbaar && (
        <button
          type="button"
          onClick={() => p.schuif(-1)}
          className={PIJL}
          aria-label="Vorige periode"
          title="Vorige periode"
        >
          <ChevronLeft size={20} aria-hidden="true" />
        </button>
      )}
      <p className="text-row font-medium text-ink truncate">{p.bereik.tekst}</p>
      {p.bereik.schuifbaar && (
        <button
          type="button"
          onClick={() => p.schuif(1)}
          disabled={!p.kanVooruit}
          className={PIJL}
          aria-label="Volgende periode"
          title="Volgende periode"
        >
          <ChevronRight size={20} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** Eén filterrij: bad, vaste periodes, eigen van/tot-datum. */
export function PeriodeFilters({ p }: { p: PoolPeriode }) {
  return (
    <div className="flex gap-3 mb-4 flex-wrap items-center">
      <select
        className="border rounded-lg px-3 py-2 text-sm"
        value={p.pool}
        onChange={(e) => p.setFilter("pool", e.target.value)}
      >
        <option value="">Alle baden</option>
        <option value="wellness">Wellness</option>
        <option value="zwembad">Zwembad</option>
      </select>
      <div className="flex gap-1 overflow-x-auto scrollbar-none">
        {PERIODES.map((x) => (
          <button
            key={x.id}
            type="button"
            onClick={() => p.setFilter("periode", x.id)}
            aria-pressed={p.periode === x.id}
            className={`chip ${p.periode === x.id ? "chip-aan" : ""}`}
          >
            {x.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2 items-center">
        <input
          type="date"
          className="border rounded-lg px-3 py-2 text-sm"
          value={p.datumVan}
          onChange={(e) => p.setFilter("datum_van", e.target.value)}
          aria-label="Van"
        />
        <span className="text-ink-45 text-sm">t/m</span>
        <input
          type="date"
          className="border rounded-lg px-3 py-2 text-sm"
          value={p.datumTot}
          onChange={(e) => p.setFilter("datum_tot", e.target.value)}
          aria-label="Tot en met"
        />
      </div>
    </div>
  );
}

// ── Data ───────────────────────────────────────────────────────────────────

/**
 * Alle logregels van een selectie, in pagina's van 500 (het maximum van de
 * API). Eén verzoek gaf hooguit de nieuwste 500 regels — bij twee baden met
 * twee metingen per dag is dat maar vier maanden.
 */
const PAGINA = 500;
const MAX_PAGINAS = 40; // 20.000 regels; ruim tien jaar dagelijks meten

export async function laadAlleLogs(params: Record<string, string>): Promise<PoolLog[]> {
  const alles: PoolLog[] = [];
  for (let i = 0; i < MAX_PAGINAS; i++) {
    const r = await poolApi.list({ ...params, limit: String(PAGINA), offset: String(i * PAGINA) });
    alles.push(...r.data);
    if (r.data.length < PAGINA) break;
  }
  return alles;
}

/** Queryparameters voor de API uit de selectie. */
export function apiParams(p: PoolPeriode, extra: Record<string, string> = {}): Record<string, string> {
  const params: Record<string, string> = { ...extra };
  if (p.pool) params.pool_id = p.pool;
  if (p.bereik.van) params.datum_van = p.bereik.van;
  if (p.bereik.tot) params.datum_tot = p.bereik.tot;
  return params;
}
