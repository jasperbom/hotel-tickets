import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { format } from "date-fns";
import { nl } from "date-fns/locale";
import { recurringApi, locationApi, parseUTC, type RecurringTemplate, type HistoryEntry } from "../api/client";
import { CategoryBadge, PriorityBadge } from "../components/StatusBadge";
import { cronToHuman } from "../components/RecurrenceEditor";

export default function RecurringTaskDetail() {
  const { id } = useParams<{ id: string }>();
  const [template, setTemplate] = useState<RecurringTemplate | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);

  async function load() {
    if (!id) return;
    const [tmpl, hist, locs] = await Promise.all([
      recurringApi.get(id),
      recurringApi.history(id),
      locationApi.list(),
    ]);
    setTemplate(tmpl.data);
    setHistory(hist.data);
    setLocations(Object.fromEntries(locs.data.map((l) => [l.id, l.name])));
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  async function handleComplete() {
    if (!id || completing) return;
    setCompleting(true);
    try {
      await recurringApi.complete(id);
      await load();
    } finally {
      setCompleting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!template) {
    return (
      <div className="card py-12 text-center text-gray-500">
        Sjabloon niet gevonden.{" "}
        <Link to="/recurring" className="text-blue-600 hover:underline">Terug</Link>
      </div>
    );
  }

  const now = new Date();
  const doneToday = history.some(
    (h) => h.closed_at && parseUTC(h.closed_at).toDateString() === now.toDateString()
  );
  const nextRun = template.next_run ? parseUTC(template.next_run) : null;
  const isOverdue = nextRun && nextRun < now && !doneToday;
  const locationName = template.location_id ? locations[template.location_id] : null;

  return (
    <div className="space-y-4">
      {/* Terug */}
      <Link to="/recurring" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
        ← Herhalende taken
      </Link>

      {/* Header */}
      <div className="card space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900">{template.title}</h1>
              {!template.is_active && (
                <span className="badge bg-gray-100 text-gray-500">Inactief</span>
              )}
              {template.nfc_tag_id && (
                <span className="text-xs font-mono bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">NFC</span>
              )}
            </div>
            <div className="flex gap-1.5 mt-2 flex-wrap">
              <CategoryBadge category={template.category} />
              <PriorityBadge priority={template.priority} />
            </div>
          </div>
        </div>

        {locationName && (
          <p className="text-sm text-gray-600">🚪 {locationName}</p>
        )}

        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>🔁</span>
          <span>{cronToHuman(template.cron_expression)}</span>
        </div>

        {/* Volgende uitvoering / verlopen */}
        {doneToday ? (
          <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
            <span className="text-green-600">✓</span>
            <p className="text-sm font-medium text-green-800">Vandaag afgerond</p>
          </div>
        ) : isOverdue ? (
          <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <span className="text-red-500">⚠</span>
            <p className="text-sm font-medium text-red-800">
              Verlopen — stond gepland voor {nextRun ? format(nextRun, "d MMM HH:mm", { locale: nl }) : "onbekend"}
            </p>
          </div>
        ) : nextRun ? (
          <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
            <span className="text-blue-500">📅</span>
            <p className="text-sm font-medium text-blue-800">
              Volgende uitvoering: {format(nextRun, "eeee d MMM 'om' HH:mm", { locale: nl })}
            </p>
          </div>
        ) : null}

        {template.description && (
          <p className="text-sm text-gray-600 whitespace-pre-line">{template.description}</p>
        )}

        {/* Afronden knop */}
        <button
          onClick={handleComplete}
          disabled={doneToday || completing || !template.is_active}
          className={`w-full py-3 rounded-xl font-semibold text-sm transition-all ${
            doneToday || !template.is_active
              ? "bg-gray-100 text-gray-400 cursor-not-allowed"
              : "bg-green-600 text-white hover:bg-green-700 active:scale-95"
          }`}
        >
          {completing ? "Bezig..." : doneToday ? "✓ Al afgerond vandaag" : "✓ Taak afronden"}
        </button>
      </div>

      {/* Uitvoeringslog */}
      <div className="card">
        <h2 className="font-semibold text-gray-900 mb-3">Uitvoeringslog</h2>
        {history.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">Nog niet uitgevoerd</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {history.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between py-2.5 gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-green-500 text-sm">✓</span>
                  <span className="text-sm text-gray-700">
                    {entry.closed_by === "nfc"
                      ? "Via NFC"
                      : entry.closed_by === "system"
                      ? "Systeem"
                      : entry.closed_by || "Onbekend"}
                  </span>
                </div>
                <span className="text-xs text-gray-400 shrink-0">
                  {entry.closed_at
                    ? format(parseUTC(entry.closed_at), "d MMM yyyy HH:mm", { locale: nl })
                    : "–"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
