import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { format } from "date-fns";
import { nl } from "date-fns/locale";
import { recurringApi, locationApi, ticketApi, parseUTC, type RecurringTemplate, type HistoryEntry, type ActiveTicket, type KeycardStatus } from "../api/client";
import { CategoryBadge, PriorityBadge } from "../components/StatusBadge";
import { cronToHuman } from "../components/RecurrenceEditor";

export default function RecurringTaskDetail() {
  const { id } = useParams<{ id: string }>();
  const [template, setTemplate] = useState<RecurringTemplate | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [activeTickets, setActiveTickets] = useState<ActiveTicket[]>([]);
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [keycards, setKeycards] = useState<Record<string, KeycardStatus>>({});
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState<string | "all" | null>(null);
  const [subtaskLoading, setSubtaskLoading] = useState(false);

  async function load() {
    if (!id) return;
    const [tmpl, hist, locs, active] = await Promise.all([
      recurringApi.get(id),
      recurringApi.history(id),
      locationApi.list(),
      recurringApi.activeTickets(id),
    ]);
    setTemplate(tmpl.data);
    setHistory(hist.data);
    setActiveTickets(active.data);
    const locMap = Object.fromEntries(locs.data.map((l) => [l.id, l.name]));
    setLocations(locMap);

    // Load keycards for relevant locations
    const locationIds = new Set<string>();
    if (tmpl.data.location_id) locationIds.add(tmpl.data.location_id);
    active.data.forEach((t) => { if (t.location_id) locationIds.add(t.location_id); });
    if (locationIds.size > 0) {
      const results = await Promise.allSettled(
        [...locationIds].map((lid) => locationApi.keycard(lid).then((r) => ({ id: lid, data: r.data })))
      );
      const kmap: Record<string, KeycardStatus> = {};
      results.forEach((r) => { if (r.status === "fulfilled") kmap[r.value.id] = r.value.data; });
      setKeycards(kmap);
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, [id]);

  async function handleComplete(roomId?: string) {
    if (!id) return;
    const key = roomId ?? "all";
    setCompleting(key);
    try {
      await recurringApi.complete(id, roomId);
      await load();
    } finally {
      setCompleting(null);
    }
  }

  async function toggleSubtask(ticket: ActiveTicket, index: number) {
    if (subtaskLoading || !ticket.subtasks) return;
    setSubtaskLoading(true);
    try {
      const done = !ticket.subtasks[index].done;
      const r = await ticketApi.updateSubtask(ticket.id, index, done);
      setActiveTickets((prev) =>
        prev.map((t) => t.id === ticket.id ? { ...t, subtasks: r.data.subtasks } : t)
      );
    } finally {
      setSubtaskLoading(false);
    }
  }

  async function toggleNotifyWhenFree(ticket: ActiveTicket) {
    const r = await ticketApi.update(ticket.id, { notify_when_free: !ticket.notify_when_free });
    setActiveTickets((prev) =>
      prev.map((t) => t.id === ticket.id ? { ...t, notify_when_free: r.data.notify_when_free } : t)
    );
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
  const keycard = template.location_id ? keycards[template.location_id] : null;

  const isRoomsMode = template.subtask_mode === "rooms";
  const isSubtaskMode = template.subtask_mode === "subtasks";
  const activeTicket = activeTickets[0] ?? null;

  // For rooms mode: all rooms done today?
  const allRoomsDoneToday = isRoomsMode && activeTickets.length === 0 && doneToday;

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
              {isSubtaskMode && <span className="badge bg-blue-50 text-blue-600">☑️ Subtaken</span>}
              {isRoomsMode && <span className="badge bg-blue-50 text-blue-600">🚪 Kamers</span>}
            </div>
            <div className="flex gap-1.5 mt-2 flex-wrap">
              <CategoryBadge category={template.category} />
              <PriorityBadge priority={template.priority} />
            </div>
          </div>
        </div>

        {/* Locatie + keycard (enkelvoudig/subtaken) */}
        {!isRoomsMode && locationName && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-600">🚪 {locationName}</span>
            {keycard?.found && (
              keycard.occupied
                ? <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">Bezet</span>
                : <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700">Vrij</span>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 text-sm text-gray-600">
          <span>🔁</span>
          <span>{cronToHuman(template.cron_expression)}</span>
        </div>

        {/* Status banner */}
        {isRoomsMode ? (
          activeTickets.length === 0 && doneToday ? (
            <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
              <span className="text-green-600">✓</span>
              <p className="text-sm font-medium text-green-800">Alle kamers afgerond vandaag</p>
            </div>
          ) : activeTickets.length > 0 ? (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
              <span className="text-amber-600">⏳</span>
              <p className="text-sm font-medium text-amber-800">{activeTickets.length} kamer(s) nog te doen</p>
            </div>
          ) : null
        ) : doneToday ? (
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

        {/* Notify when free toggle (enkelvoudig/subtaken met actief ticket) */}
        {!isRoomsMode && activeTicket && locationName && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => toggleNotifyWhenFree(activeTicket)}
              className={`relative w-10 h-6 rounded-full transition-colors ${activeTicket.notify_when_free ? "bg-amber-500" : "bg-gray-200"}`}
            >
              <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${activeTicket.notify_when_free ? "left-5" : "left-1"}`} />
            </button>
            <label className="text-sm text-gray-700">🔑 Meld mij wanneer de kamer vrij is</label>
          </div>
        )}

        {/* Afronden knop (enkelvoudig/subtaken) */}
        {!isRoomsMode && (
          <button
            onClick={() => handleComplete()}
            disabled={doneToday || completing !== null || !template.is_active}
            className={`w-full py-3 rounded-xl font-semibold text-sm transition-all ${
              doneToday || !template.is_active
                ? "bg-gray-100 text-gray-400 cursor-not-allowed"
                : "bg-green-600 text-white hover:bg-green-700 active:scale-95"
            }`}
          >
            {completing === "all" ? "Bezig..." : doneToday ? "✓ Al afgerond vandaag" : "✓ Taak afronden"}
          </button>
        )}

        {/* Alles afronden (kamers) */}
        {isRoomsMode && activeTickets.length > 0 && (
          <button
            onClick={() => handleComplete()}
            disabled={completing !== null || !template.is_active}
            className="w-full py-3 rounded-xl font-semibold text-sm bg-green-600 text-white hover:bg-green-700 active:scale-95 transition-all disabled:opacity-50"
          >
            {completing === "all" ? "Bezig..." : `✓ Alle ${activeTickets.length} kamers afronden`}
          </button>
        )}
      </div>

      {/* Subtaken-sectie */}
      {isSubtaskMode && activeTicket?.subtasks && activeTicket.subtasks.length > 0 && (
        <div className="card">
          <h2 className="font-semibold text-gray-900 mb-3">Subtaken</h2>
          <div className="space-y-2">
            {activeTicket.subtasks.map((subtask, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => toggleSubtask(activeTicket, idx)}
                disabled={subtaskLoading}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 text-left transition-all ${
                  subtask.done
                    ? "border-green-200 bg-green-50"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <span className={`w-5 h-5 rounded flex items-center justify-center shrink-0 border-2 transition-all ${
                  subtask.done ? "bg-green-500 border-green-500 text-white" : "border-gray-300"
                }`}>
                  {subtask.done && <span className="text-xs font-bold">✓</span>}
                </span>
                <span className={`flex-1 text-sm font-medium ${subtask.done ? "line-through text-gray-400" : "text-gray-800"}`}>
                  {subtask.label}
                </span>
              </button>
            ))}
          </div>
          {activeTicket.subtasks.every((s) => s.done) && (
            <p className="text-sm text-green-700 font-medium mt-3 text-center">
              ✓ Alle subtaken afgevinkt — druk op Taak afronden om te voltooien
            </p>
          )}
        </div>
      )}

      {/* Kamers-sectie */}
      {isRoomsMode && (
        <div className="card">
          <h2 className="font-semibold text-gray-900 mb-3">Kamers</h2>
          {activeTickets.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">
              {doneToday ? "Alle kamers zijn vandaag afgerond ✓" : "Geen openstaande kamertaken"}
            </p>
          ) : (
            <div className="space-y-2">
              {activeTickets.map((ticket) => {
                const roomName = ticket.location_id ? locations[ticket.location_id] : null;
                const roomKeycard = ticket.location_id ? keycards[ticket.location_id] : null;
                const isCompletingRoom = completing === ticket.location_id;
                return (
                  <div key={ticket.id} className="flex items-center gap-3 p-3 border border-gray-200 rounded-xl">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900">
                          🚪 {roomName ?? ticket.location_id ?? "Onbekende kamer"}
                        </span>
                        {roomKeycard?.found && (
                          roomKeycard.occupied
                            ? <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">Bezet</span>
                            : <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700">Vrij</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleComplete(ticket.location_id ?? undefined)}
                      disabled={completing !== null}
                      className="shrink-0 text-sm text-green-700 font-medium border border-green-200 rounded-lg px-3 py-1.5 hover:bg-green-50 transition-colors disabled:opacity-50"
                    >
                      {isCompletingRoom ? "Bezig..." : "✓ Afronden"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

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
