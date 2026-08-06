import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { reportApi, type Category, type ReportSummary, type TimelinePoint } from "../api/client";
import { AFDELING_LABELS } from "../werk";

/**
 * Rapportage — het enige scherm dat over gisteren gaat.
 *
 * Absorbeert de vier tegels van het verwijderde Dashboard. De staafgrafiek per
 * status is eruit: die meet een artefact van hoe iemand een ticket toewees, niet
 * hoe het hotel draait. Wat ervoor in de plaats komt is de vraag die er echt is:
 * hoe lang duurt het per afdeling, en wat blijft er te lang liggen.
 */

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function uurTekst(uren: number): string {
  if (uren < 1) return `${Math.round(uren * 60)} min`;
  if (uren < 48) return `${uren.toFixed(1).replace(".0", "")} uur`;
  return `${(uren / 24).toFixed(1).replace(".0", "")} dagen`;
}

export default function Reports() {
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [timeline, setTimeline] = useState<TimelinePoint[]>([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [groupBy, setGroupBy] = useState<"day" | "week" | "month">("week");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = { group_by: groupBy };
    if (fromDate) params.from_date = fromDate;
    if (toDate) params.to_date = toDate;
    Promise.allSettled([reportApi.summary(params), reportApi.timeline(params)])
      .then(([s, t]) => {
        if (s.status === "fulfilled") setSummary(s.value.data);
        if (t.status === "fulfilled") setTimeline(t.value.data);
      })
      .finally(() => setLoading(false));
  }, [fromDate, toDate, groupBy]);

  async function exportFile(type: "csv" | "excel") {
    setExporting(true);
    try {
      const r = type === "csv" ? await reportApi.exportCsv() : await reportApi.exportExcel();
      downloadBlob(r.data, type === "csv" ? "tickets.csv" : "tickets.xlsx");
    } finally {
      setExporting(false);
    }
  }

  const perAfdeling = Object.entries(summary?.avg_resolution_by_category ?? {})
    .map(([c, v]) => ({ category: c as Category, ...v! }))
    .sort((a, b) => b.hours - a.hours);
  const langste = perAfdeling[0]?.hours ?? 1;

  const verdeling = Object.entries(summary?.category_counts ?? {})
    .map(([c, aantal]) => ({ category: c as Category, aantal }))
    .filter((r) => r.aantal > 0)
    .sort((a, b) => b.aantal - a.aantal);
  const totaalVerdeling = verdeling.reduce((som, r) => som + r.aantal, 0) || 1;

  return (
    <div className="space-y-6 max-w-[68rem]">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="hidden md:block text-2xl font-bold text-ink">Rapportage</h1>
        <div className="flex gap-2 ml-auto">
          <button onClick={() => exportFile("csv")} disabled={exporting}
            className="h-tap px-4 rounded-[10px] border border-ink-12 text-ink-70 text-meta font-semibold hover:bg-ink-6 disabled:opacity-50">
            CSV
          </button>
          <button onClick={() => exportFile("excel")} disabled={exporting}
            className="h-tap px-4 rounded-[10px] border border-ink-12 text-ink-70 text-meta font-semibold hover:bg-ink-6 disabled:opacity-50">
            Excel
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <label className="meta">Van
          <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)}
            className="ml-2 h-tap rounded-[10px] border border-ink-12 px-2 text-meta bg-paper-raised" />
        </label>
        <label className="meta">Tot
          <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)}
            className="ml-2 h-tap rounded-[10px] border border-ink-12 px-2 text-meta bg-paper-raised" />
        </label>
        <div className="flex rounded-full border border-ink-12 bg-paper-raised overflow-hidden">
          {(["day", "week", "month"] as const).map((g) => (
            <button key={g} onClick={() => setGroupBy(g)}
              className={`h-tap px-4 text-meta transition-colors ${
                groupBy === g ? "bg-ink text-paper font-semibold" : "text-ink-70 font-medium hover:bg-ink-6"
              }`}>
              {g === "day" ? "Dag" : g === "week" ? "Week" : "Maand"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
        </div>
      ) : !summary ? (
        <p className="meta">Rapportage kon niet geladen worden.</p>
      ) : (
        <>
          {/* De vier tegels die het Dashboard achterliet */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Tegel waarde={summary.total_tickets} label="Tickets in periode" />
            <Tegel waarde={summary.status_counts.open + summary.status_counts.in_progress} label="Nu open" />
            <Tegel
              waarde={summary.open_older_than_7d ?? 0}
              label="Langer dan 7 dagen open"
              alarm={(summary.open_older_than_7d ?? 0) > 0}
            />
            <Tegel
              waarde={summary.avg_resolution_hours != null ? uurTekst(summary.avg_resolution_hours) : "—"}
              label="Gem. doorlooptijd"
            />
          </div>

          {/* Doorlooptijd per afdeling — nieuw, en de reden dat dit scherm bestaat */}
          <section className="pt-5 border-t border-ink-12">
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.14em] text-ink-45">
              Doorlooptijd per afdeling
            </p>
            {perAfdeling.length === 0 ? (
              <p className="meta">Nog niets afgerond in deze periode.</p>
            ) : (
              <ul className="space-y-2.5">
                {perAfdeling.map((r) => (
                  <li key={r.category} className="flex items-center gap-3">
                    <span className="w-32 shrink-0 text-meta text-ink-70 truncate">
                      {AFDELING_LABELS[r.category]}
                    </span>
                    <span className="flex-1 h-2.5 rounded-full bg-ink-6 overflow-hidden">
                      <span
                        className="block h-full rounded-full bg-ink"
                        style={{ width: `${Math.max(3, (r.hours / langste) * 100)}%` }}
                      />
                    </span>
                    <span className="w-24 shrink-0 text-right text-meta text-ink tabular-nums">
                      {uurTekst(r.hours)}
                    </span>
                    <span className="w-16 shrink-0 text-right meta tabular-nums">{r.count}×</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Tickets over tijd */}
          <section className="pt-5 border-t border-ink-12">
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.14em] text-ink-45">Tickets over tijd</p>
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={timeline}>
                <XAxis dataKey="period" tick={{ fontSize: 12, fill: "#6E6B65" }} />
                <YAxis tick={{ fontSize: 12, fill: "#6E6B65" }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="total" name="Gemeld" stroke="#1C1B19" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="closed" name="Afgerond" stroke="#2F6B46" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </section>

          {/* Verdeling per afdeling — zonder zeven kleuren */}
          <section className="pt-5 border-t border-ink-12">
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.14em] text-ink-45">Verdeling per afdeling</p>
            <ul className="space-y-2.5">
              {verdeling.map((r) => (
                <li key={r.category} className="flex items-center gap-3">
                  <span className="w-32 shrink-0 text-meta text-ink-70 truncate">
                    {AFDELING_LABELS[r.category]}
                  </span>
                  <span className="flex-1 h-2.5 rounded-full bg-ink-6 overflow-hidden">
                    <span
                      className="block h-full rounded-full bg-ink-45"
                      style={{ width: `${(r.aantal / totaalVerdeling) * 100}%` }}
                    />
                  </span>
                  <span className="w-16 shrink-0 text-right text-meta text-ink tabular-nums">{r.aantal}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

function Tegel({ waarde, label, alarm }: { waarde: number | string; label: string; alarm?: boolean }) {
  return (
    <div className="rounded-[10px] border border-ink-12 bg-paper-raised px-4 py-3.5">
      <p className={`text-[1.75rem] font-bold leading-none ${alarm ? "text-urgent" : "text-ink"}`}>{waarde}</p>
      <p className="meta mt-1.5">{label}</p>
    </div>
  );
}
