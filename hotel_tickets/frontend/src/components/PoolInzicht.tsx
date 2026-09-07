import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDateNL, type PoolId, type PoolLog } from "../api/client";
import { POOL_RANGES, STATUS_COLORS, getValueStatus, type RangeKey } from "./PoolValueVisualization";

/**
 * Inzicht-sectie boven het zwembadlogboek: kerncijfers, een dagstrip met het
 * aantal metingen per dag (de BAL vraagt er twee) en trendgrafieken per
 * meetwaarde tegen het streefbereik. Alles wordt berekend uit dezelfde
 * logregels als de tabel eronder, zodat filters en cijfers altijd kloppen.
 */

// ── Kleuren ────────────────────────────────────────────────────────────────
// Eén vaste kleur per bad (identiteit, nooit op rangorde). Gevalideerd op
// kleurenblind-onderscheid; de moduletint #0E7490 was te grijs voor een lijn.
export const POOL_COLORS: Record<PoolId, string> = {
  zwembad: "#0891B2",
  wellness: "#9C5A1E",
};
const POOL_LABELS: Record<PoolId, string> = { wellness: "Wellness", zwembad: "Zwembad" };
const ALL_POOLS: PoolId[] = ["wellness", "zwembad"];

const INK = "#1C1B19";
const INK_45 = "#6E6B65";
const INK_12 = "#DAD6CE";
const INK_6 = "#EFEBE3";
const ADVIES_FILL = "#2F6B46"; // done — streefbereik als lichte wash
const BEWAKING_STROKE = "#C0392F"; // urgent — harde grens

// ── Data ───────────────────────────────────────────────────────────────────

const MEASUREMENT_KEYS: (keyof PoolLog)[] = [
  "water_temp", "doorzicht", "ph", "vbc_in", "vbc_uit", "tbc", "gbc",
  "ph_automaat", "vbc_automaat", "watermeter", "verbruik", "flow", "bezoekers",
];

/** Zelfde regel als de backend: een regel telt als meting zodra één meetwaarde gevuld is. */
export function isMeting(l: PoolLog): boolean {
  return MEASUREMENT_KEYS.some((k) => l[k] !== null && l[k] !== undefined && l[k] !== "");
}

function toMs(datum: string, tijd: string): number {
  return new Date(`${datum}T${tijd || "00:00"}:00`).getTime();
}

function ddmm(datum: string): string {
  return `${datum.slice(8, 10)}-${datum.slice(5, 7)}`;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Alle kalenderdagen van `van` t/m `tot` (ISO-strings). */
function dagenTussen(van: string, tot: string): string[] {
  const out: string[] = [];
  const d = new Date(`${van}T12:00:00`);
  const end = new Date(`${tot}T12:00:00`);
  while (d <= end) {
    out.push(isoDate(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

type LineRow = { t: number; datum: string; tijd: string } & Partial<Record<PoolId, PoolLog>>;

type DagRow = {
  datum: string;
  label: string;
} & Record<`${PoolId}_metingen` | `${PoolId}_bezoekers` | `${PoolId}_verbruik`, number>;

function nieuweDagRow(datum: string): DagRow {
  return {
    datum,
    label: ddmm(datum),
    wellness_metingen: 0, wellness_bezoekers: 0, wellness_verbruik: 0,
    zwembad_metingen: 0, zwembad_bezoekers: 0, zwembad_verbruik: 0,
  };
}

/**
 * Ronde asstappen: 1 / 2 / 2,5 / 5 × 10^k, zodat de y-as 7,0 · 7,2 · 7,4 zegt
 * en niet 6,95 · 7,3 · 7,65. Het bereik wordt naar buiten afgerond op de stap.
 */
function netteAs(lo: number, hi: number, stappen = 4): { domain: [number, number]; ticks: number[]; decimalen: number } {
  const bereik = hi - lo || 1;
  const ruw = bereik / stappen;
  const macht = Math.pow(10, Math.floor(Math.log10(ruw)));
  const rest = ruw / macht;
  const factor = rest <= 1 ? 1 : rest <= 2 ? 2 : rest <= 2.5 ? 2.5 : rest <= 5 ? 5 : 10;
  const stap = factor * macht;
  const decimalen = Math.max(0, -Math.floor(Math.log10(stap)) + (factor === 2.5 ? 1 : 0));
  const van = Math.floor(lo / stap + 1e-9) * stap;
  const tot = Math.ceil(hi / stap - 1e-9) * stap;
  const ticks: number[] = [];
  for (let v = van; v <= tot + stap / 2; v += stap) ticks.push(+v.toFixed(decimalen));
  return { domain: [+van.toFixed(decimalen), +tot.toFixed(decimalen)], ticks, decimalen };
}

function pct(binnen: number, totaal: number): string {
  if (totaal === 0) return "—";
  return `${Math.round((binnen / totaal) * 100)}%`;
}

function fmt(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "—";
  return v.toLocaleString("nl-NL", { maximumFractionDigits: digits });
}

// ── Bouwstenen ─────────────────────────────────────────────────────────────

function Tegel({ waarde, label, alarm }: { waarde: number | string; label: string; alarm?: boolean }) {
  return (
    <div className="rounded-[10px] border border-ink-12 bg-paper-raised px-4 py-3.5 min-w-0">
      <p className={`text-[1.75rem] font-bold leading-none truncate ${alarm ? "text-urgent" : "text-ink"}`}>
        {waarde}
      </p>
      <p className="meta mt-1.5">{label}</p>
    </div>
  );
}

type SeriesDef = {
  key: string; // dataKey
  naam: string;
  kleur: string;
  dash?: string; // gestreept = context (automaat)
  pool?: PoolId; // voor statuskleur van de punten
  rangeKey?: RangeKey;
};

function LegendaRij({ series, vorm }: { series: SeriesDef[]; vorm: "lijn" | "balk" }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-ink-70">
      {series.map((s) => (
        <li key={s.key} className="inline-flex items-center gap-1.5">
          {vorm === "lijn" ? (
            <svg width="18" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="18" y2="4" stroke={s.kleur} strokeWidth="2" strokeDasharray={s.dash} />
            </svg>
          ) : (
            <span className="inline-block w-3 h-3 rounded-[3px]" style={{ background: s.kleur }} />
          )}
          {s.naam}
        </li>
      ))}
    </ul>
  );
}

function TooltipKader({
  titel,
  regels,
}: {
  titel: string;
  regels: { naam: string; waarde: string; kleur: string; dash?: string }[];
}) {
  return (
    <div className="rounded-lg border border-ink-12 bg-paper-raised shadow px-3 py-2 text-xs">
      <p className="text-ink-45 mb-1">{titel}</p>
      <ul className="space-y-0.5">
        {regels.map((r) => (
          <li key={r.naam} className="flex items-center gap-2">
            <svg width="14" height="6" aria-hidden="true">
              <line x1="0" y1="3" x2="14" y2="3" stroke={r.kleur} strokeWidth="2" strokeDasharray={r.dash} />
            </svg>
            <span className="font-semibold text-ink tabular-nums">{r.waarde}</span>
            <span className="text-ink-45">{r.naam}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, k) => (acc && typeof acc === "object" ? (acc as any)[k] : undefined), obj);
}

function Kaart({ titel, sub, children }: { titel: string; sub?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[10px] border border-ink-12 bg-paper-raised px-4 pt-3 pb-2 min-w-0">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <p className="text-meta font-semibold text-ink">{titel}</p>
        {sub && <p className="text-xs text-ink-45 truncate">{sub}</p>}
      </div>
      {children}
    </div>
  );
}

// ── Lijngrafiek ────────────────────────────────────────────────────────────

function Lijngrafiek({
  titel,
  rows,
  series,
  rangeKey,
  eenheid,
  decimalen = 2,
}: {
  titel: string;
  rows: LineRow[];
  series: SeriesDef[];
  rangeKey?: RangeKey;
  eenheid?: string;
  decimalen?: number;
}) {
  const cfg = rangeKey ? POOL_RANGES[rangeKey] : null;

  // Y-bereik: streefbereik altijd zichtbaar (met wat lucht), verder oprekken
  // tot de data. Het volledige bewakingsbereik zou de interessante band
  // platdrukken (pH 7,0–7,6 in een as van 4 tot 9).
  const waarden: number[] = [];
  for (const r of rows) for (const s of series) {
    const v = getPath(r, s.key);
    if (typeof v === "number") waarden.push(v);
  }
  const heeftData = waarden.length > 0;
  let lo = Math.min(...(heeftData ? waarden : [0]));
  let hi = Math.max(...(heeftData ? waarden : [1]));
  let vloer: number | null = null; // harde ondergrens (chloor kan niet onder nul)
  if (cfg) {
    const pad = (cfg.advies[1] - cfg.advies[0]) * 0.5 || 0.3;
    lo = Math.min(lo, cfg.advies[0] - pad);
    hi = Math.max(hi, cfg.advies[1] + pad);
    if (lo <= cfg.bewaking[0]) {
      lo = cfg.bewaking[0];
      vloer = lo;
    }
  }
  if (lo === hi) { lo -= 1; hi += 1; }
  const as = netteAs(vloer !== null ? vloer : lo, hi);
  const asBreedte = 12 + Math.max(...as.ticks.map((t) => fmt(t, as.decimalen).length)) * 7;

  const toonPunten = rows.length <= 120;
  const sub = cfg
    ? `streef ${cfg.advies[0]}–${cfg.advies[1]}${cfg.unit ? ` ${cfg.unit}` : ""}`
    : eenheid;

  return (
    <Kaart titel={titel} sub={sub}>
      {!heeftData ? (
        <p className="meta py-8 text-center">Geen waarden in deze periode.</p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={INK_6} vertical={false} />
            <XAxis
              type="number"
              dataKey="t"
              domain={["dataMin", "dataMax"]}
              scale="time"
              tickFormatter={(t: number) => ddmm(isoDate(new Date(t)))}
              tick={{ fontSize: 11, fill: INK_45 }}
              tickLine={false}
              axisLine={{ stroke: INK_12 }}
              minTickGap={40}
            />
            <YAxis
              domain={as.domain}
              ticks={as.ticks}
              tick={{ fontSize: 11, fill: INK_45 }}
              tickLine={false}
              axisLine={false}
              width={asBreedte}
              tickFormatter={(v: number) => fmt(v, as.decimalen)}
            />
            <Tooltip
              cursor={{ stroke: INK_12 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as LineRow;
                const regels = series
                  .map((s) => ({ s, v: getPath(row, s.key) }))
                  .filter((x) => typeof x.v === "number")
                  .map(({ s, v }) => ({
                    naam: s.naam,
                    waarde: fmt(v as number, decimalen),
                    kleur: s.kleur,
                    dash: s.dash,
                  }));
                return <TooltipKader titel={`${formatDateNL(row.datum)} ${row.tijd}`} regels={regels} />;
              }}
            />
            {cfg && (
              <ReferenceArea y1={cfg.advies[0]} y2={cfg.advies[1]} fill={ADVIES_FILL} fillOpacity={0.1} ifOverflow="hidden" />
            )}
            {cfg && cfg.bewaking[0] > 0 && (
              <ReferenceLine y={cfg.bewaking[0]} stroke={BEWAKING_STROKE} strokeDasharray="4 3" ifOverflow="hidden" />
            )}
            {cfg && (
              <ReferenceLine y={cfg.bewaking[1]} stroke={BEWAKING_STROKE} strokeDasharray="4 3" ifOverflow="hidden" />
            )}
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.naam}
                stroke={s.kleur}
                strokeWidth={2}
                strokeDasharray={s.dash}
                strokeLinecap="round"
                strokeLinejoin="round"
                connectNulls
                isAnimationActive={false}
                activeDot={{ r: 5, stroke: "#fff", strokeWidth: 2 }}
                dot={(props: any) => {
                  const val = getPath(props.payload, s.key);
                  if (typeof val !== "number") return <g key={`${s.key}-${props.index}`} />;
                  const status = s.rangeKey ? getValueStatus(s.rangeKey, val) : "ok";
                  const buiten = status === "buiten_advies" || status === "buiten_bewaking";
                  if (!toonPunten && !buiten) return <g key={`${s.key}-${props.index}`} />;
                  return (
                    <circle
                      key={`${s.key}-${props.index}`}
                      cx={props.cx}
                      cy={props.cy}
                      r={buiten ? 4.5 : 3.5}
                      fill={buiten ? STATUS_COLORS[status] : s.kleur}
                      stroke="#fff"
                      strokeWidth={2}
                    />
                  );
                }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
      <LegendaRij series={series} vorm="lijn" />
    </Kaart>
  );
}

// ── Staafgrafiek per dag ───────────────────────────────────────────────────

function Dagstaven({
  titel,
  rows,
  veld,
  pools,
  sub,
}: {
  titel: string;
  rows: DagRow[];
  veld: "bezoekers" | "verbruik";
  pools: PoolId[];
  sub?: string;
}) {
  const series: SeriesDef[] = pools.map((p) => ({
    key: `${p}_${veld}`,
    naam: POOL_LABELS[p],
    kleur: POOL_COLORS[p],
  }));
  const heeftData = rows.some((r) => series.some((s) => (r as any)[s.key] > 0));
  return (
    <Kaart titel={titel} sub={sub}>
      {!heeftData ? (
        <p className="meta py-8 text-center">Geen waarden in deze periode.</p>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} barGap={2} barCategoryGap="25%">
            <CartesianGrid stroke={INK_6} vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 11, fill: INK_45 }}
              tickLine={false}
              axisLine={{ stroke: INK_12 }}
              minTickGap={40}
              interval="preserveStartEnd"
            />
            <YAxis
              tick={{ fontSize: 11, fill: INK_45 }}
              tickLine={false}
              axisLine={false}
              width={40}
              allowDecimals={veld === "verbruik"}
              tickFormatter={(v: number) => fmt(v, 1)}
            />
            <Tooltip
              cursor={{ fill: INK_6 }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0].payload as DagRow;
                return (
                  <TooltipKader
                    titel={formatDateNL(row.datum)}
                    regels={series.map((s) => ({
                      naam: s.naam,
                      waarde: fmt((row as any)[s.key], veld === "verbruik" ? 1 : 0),
                      kleur: s.kleur,
                    }))}
                  />
                );
              }}
            />
            {series.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.naam}
                fill={s.kleur}
                maxBarSize={24}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
      <LegendaRij series={series} vorm="balk" />
    </Kaart>
  );
}

// ── Dagstrip: metingen per dag ─────────────────────────────────────────────

const DAG_KLEUR = {
  volledig: "#2F6B46", // done
  een: "#E6B800", // normal.rail — één meting, nog niet compleet
  geen: "#C0392F", // urgent
};

function Dagstrip({ rows, pools }: { rows: DagRow[]; pools: PoolId[] }) {
  return (
    <Kaart titel="Metingen per dag" sub="de BAL vraagt twee metingen per dag">
      <div className="space-y-2 py-1">
        {pools.map((p) => (
          <div key={p} className="flex items-start gap-3">
            {pools.length > 1 && (
              <span className="w-20 shrink-0 text-xs text-ink-70 pt-0.5 inline-flex items-center gap-1.5">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: POOL_COLORS[p] }} />
                {POOL_LABELS[p]}
              </span>
            )}
            <ul className="flex flex-wrap gap-[3px]">
              {rows.map((r) => {
                const n = r[`${p}_metingen`];
                const kleur = n >= 2 ? DAG_KLEUR.volledig : n === 1 ? DAG_KLEUR.een : DAG_KLEUR.geen;
                const tekst = `${formatDateNL(r.datum)}: ${n} ${n === 1 ? "meting" : "metingen"}`;
                return (
                  <li
                    key={r.datum}
                    className="w-3 h-3 rounded-[3px]"
                    style={{ background: kleur, opacity: n >= 2 ? 0.85 : 1 }}
                    title={tekst}
                    aria-label={tekst}
                  />
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-ink-70">
        <li className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-[3px]" style={{ background: DAG_KLEUR.volledig, opacity: 0.85 }} />
          2 of meer
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-[3px]" style={{ background: DAG_KLEUR.een }} />
          1 meting
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded-[3px]" style={{ background: DAG_KLEUR.geen }} />
          geen
        </li>
      </ul>
    </Kaart>
  );
}

// ── Sectie ─────────────────────────────────────────────────────────────────

export function PoolInzicht({
  logs,
  pool,
  datumVan,
  datumTot,
  laden,
}: {
  logs: PoolLog[];
  /** Leeg = alle baden */
  pool: PoolId | "";
  /** Effectieve periode (ISO); leeg = alles wat er is */
  datumVan: string;
  datumTot: string;
  laden?: boolean;
}) {
  const pools: PoolId[] = pool ? [pool] : ALL_POOLS;

  const data = useMemo(() => {
    const metingen = logs.filter((l) => isMeting(l) && pools.includes(l.pool_id));
    const gesorteerd = [...metingen].sort(
      (a, b) => toMs(a.datum, a.tijd) - toMs(b.datum, b.tijd),
    );

    // Lijnrijen: één rij per tijdstip, per bad de log eronder.
    const perTijd = new Map<number, LineRow>();
    for (const l of gesorteerd) {
      const t = toMs(l.datum, l.tijd);
      let row = perTijd.get(t);
      if (!row) {
        row = { t, datum: l.datum, tijd: l.tijd };
        perTijd.set(t, row);
      }
      row[l.pool_id] = l;
    }
    const lineRows = [...perTijd.values()];

    // Dagrijen over de hele periode, zodat een dag zonder meting ook opvalt.
    const vandaag = isoDate(new Date());
    const van = datumVan || gesorteerd[0]?.datum || vandaag;
    const tot = datumTot || vandaag;
    const dagen = van <= tot ? dagenTussen(van, tot) : [];
    const perDag = new Map<string, DagRow>(dagen.map((d) => [d, nieuweDagRow(d)]));
    for (const l of gesorteerd) {
      let row = perDag.get(l.datum);
      if (!row) {
        row = nieuweDagRow(l.datum);
        perDag.set(l.datum, row);
      }
      row[`${l.pool_id}_metingen`] += 1;
      row[`${l.pool_id}_bezoekers`] += l.bezoekers ?? 0;
      row[`${l.pool_id}_verbruik`] += l.verbruik ?? 0;
    }
    const dagRows = [...perDag.values()].sort((a, b) => a.datum.localeCompare(b.datum));

    // Kerncijfers
    const volledig = dagRows.filter((r) => pools.every((p) => r[`${p}_metingen`] >= 2)).length;
    const tel = (key: RangeKey, veld: keyof PoolLog) => {
      let totaal = 0;
      let binnen = 0;
      for (const l of metingen) {
        const v = l[veld];
        if (typeof v !== "number") continue;
        totaal += 1;
        if (getValueStatus(key, v) === "ok") binnen += 1;
      }
      return { totaal, binnen };
    };
    const ph = tel("ph", "ph");
    const vbc = tel("vbc_in", "vbc_in");
    const gbc = tel("gbc", "gbc");
    const verbruik = metingen.reduce((s, l) => s + (l.verbruik ?? 0), 0);
    const bezoekers = metingen.reduce((s, l) => s + (l.bezoekers ?? 0), 0);

    return { metingen, lineRows, dagRows, volledig, ph, vbc, gbc, verbruik, bezoekers };
  }, [logs, pool, datumVan, datumTot]);

  if (data.metingen.length === 0) {
    return <p className="meta">Geen metingen in deze periode om grafieken van te maken.</p>;
  }

  // Serie-definities. Eén bad: handmeting in de badkleur, automaat als
  // gestreepte contextlijn. Alle baden: per bad één lijn, automaat weg
  // (vier lijnen in één vak leest niemand).
  const perPool = (veld: keyof PoolLog, rangeKey?: RangeKey): SeriesDef[] =>
    pools.map((p) => ({
      key: `${p}.${veld}`,
      naam: POOL_LABELS[p],
      kleur: POOL_COLORS[p],
      pool: p,
      rangeKey,
    }));
  const enkel = pool ? pool : null;

  const phSeries: SeriesDef[] = enkel
    ? [
        { key: `${enkel}.ph`, naam: "pH handmeting", kleur: POOL_COLORS[enkel], rangeKey: "ph" },
        { key: `${enkel}.ph_automaat`, naam: "pH automaat", kleur: INK_45, dash: "5 4", rangeKey: "ph" },
      ]
    : perPool("ph", "ph");
  const vbcSeries: SeriesDef[] = enkel
    ? [
        { key: `${enkel}.vbc_in`, naam: "VBC in", kleur: POOL_COLORS[enkel], rangeKey: "vbc_in" },
        { key: `${enkel}.vbc_uit`, naam: "VBC uit", kleur: INK, rangeKey: "vbc_uit" },
        { key: `${enkel}.vbc_automaat`, naam: "VBC automaat", kleur: INK_45, dash: "5 4", rangeKey: "vbc_in" },
      ]
    : perPool("vbc_in", "vbc_in");

  const dagenTotaal = data.dagRows.length;

  return (
    <div className={`space-y-4 transition-opacity ${laden ? "opacity-60" : ""}`}>
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        <Tegel waarde={data.metingen.length} label="Metingen" />
        <Tegel
          waarde={`${data.volledig}/${dagenTotaal}`}
          label="Dagen met 2 metingen"
          alarm={data.volledig < dagenTotaal}
        />
        <Tegel waarde={pct(data.ph.binnen, data.ph.totaal)} label="pH binnen streef" alarm={data.ph.totaal > 0 && data.ph.binnen < data.ph.totaal} />
        <Tegel waarde={pct(data.vbc.binnen, data.vbc.totaal)} label="VBC in binnen streef" alarm={data.vbc.totaal > 0 && data.vbc.binnen < data.vbc.totaal} />
        <Tegel waarde={pct(data.gbc.binnen, data.gbc.totaal)} label="Geb. chloor binnen streef" alarm={data.gbc.totaal > 0 && data.gbc.binnen < data.gbc.totaal} />
        <Tegel waarde={fmt(data.verbruik, 1)} label="Verbruik totaal" />
        <Tegel waarde={fmt(data.bezoekers, 0)} label="Bezoekers totaal" />
      </div>

      <Dagstrip rows={data.dagRows} pools={pools} />

      <div className="grid md:grid-cols-2 2xl:grid-cols-3 gap-4">
        <Lijngrafiek titel="pH" rows={data.lineRows} series={phSeries} rangeKey="ph" />
        <Lijngrafiek titel={enkel ? "Vrij beschikbaar chloor" : "VBC in"} rows={data.lineRows} series={vbcSeries} rangeKey="vbc_in" />
        {!enkel && (
          <Lijngrafiek titel="VBC uit" rows={data.lineRows} series={perPool("vbc_uit", "vbc_uit")} rangeKey="vbc_uit" />
        )}
        <Lijngrafiek titel="Gebonden chloor" rows={data.lineRows} series={perPool("gbc", "gbc")} rangeKey="gbc" />
        <Lijngrafiek titel="Watertemperatuur" rows={data.lineRows} series={perPool("water_temp")} eenheid="°C" decimalen={1} />
        <Lijngrafiek titel="Flow" rows={data.lineRows} series={perPool("flow")} decimalen={2} />
        <Dagstaven titel="Bezoekers per dag" rows={data.dagRows} veld="bezoekers" pools={pools} />
        <Dagstaven titel="Verbruik per dag" rows={data.dagRows} veld="verbruik" pools={pools} />
      </div>
    </div>
  );
}
