import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { nl } from "date-fns/locale";
import { ticketApi, userApi, locationApi, parseUTC, type Ticket, type Comment, type UserRole, type Status, type KeycardStatus } from "../api/client";
import { StatusBadge, PriorityBadge, CategoryBadge } from "../components/StatusBadge";

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In behandeling" },
  { value: "closed", label: "Gesloten" },
];

export default function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [users, setUsers] = useState<UserRole[]>([]);
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [keycard, setKeycard] = useState<KeycardStatus | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [saving, setSaving] = useState(false);

  const usersMap = Object.fromEntries(users.map((u) => [u.ha_user_id, u.display_name]));

  const load = useCallback(async () => {
    if (!id) return;
    const [t, c, u, locs] = await Promise.all([
      ticketApi.get(id),
      ticketApi.getComments(id),
      userApi.list(),
      locationApi.list(),
    ]);
    setTicket(t.data);
    setComments(c.data);
    setUsers(u.data);
    setLocations(Object.fromEntries(locs.data.map((l) => [l.id, l.name])));

    // Keycard sensor ophalen als er een locatie is
    if (t.data.location_id) {
      locationApi.keycard(t.data.location_id)
        .then((r) => setKeycard(r.data))
        .catch(() => {});
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function updateField(data: Partial<Ticket>) {
    if (!id) return;
    const r = await ticketApi.update(id, data);
    setTicket(r.data);
  }

  async function toggleSubtask(index: number, currentDone: boolean) {
    if (!id) return;
    const r = await ticketApi.updateSubtask(id, index, !currentDone);
    setTicket((prev) => prev ? { ...prev, subtasks: r.data.subtasks } : prev);
  }

  async function claimTicket() {
    if (!id) return;
    const r = await ticketApi.claim(id);
    setTicket(r.data);
  }

  async function submitComment(e: React.FormEvent) {
    e.preventDefault();
    if (!id || !commentBody.trim()) return;
    setSaving(true);
    const r = await ticketApi.addComment(id, commentBody);
    setComments((prev) => [...prev, r.data]);
    setCommentBody("");
    setSaving(false);
  }

  async function deleteTicket() {
    if (!id) return;
    if (!confirm("Weet je zeker dat je dit ticket wil verwijderen?")) return;
    await ticketApi.remove(id);
    navigate("/tickets");
  }

  if (!ticket) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  const locationName = ticket.location_id ? locations[ticket.location_id] : null;

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-700 mt-1 text-lg">←</button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-gray-900">{ticket.title}</h1>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <StatusBadge status={ticket.status} />
            <PriorityBadge priority={ticket.priority} />
            <CategoryBadge category={ticket.category} />
          </div>
        </div>
      </div>

      {/* Kamer-banner */}
      {locationName && (
        <div className="rounded-xl overflow-hidden border border-blue-200">
          <div className="flex items-center justify-between bg-blue-600 text-white px-5 py-3">
            <div className="flex items-center gap-3">
              <span className="text-2xl">🚪</span>
              <span className="text-xl font-bold tracking-wide">{locationName}</span>
            </div>
            {/* Keycard status */}
            {keycard?.found && (
              <div className={`flex items-center gap-2 px-3 py-1 rounded-lg text-sm font-semibold ${
                keycard.occupied
                  ? "bg-orange-400 text-white"
                  : "bg-green-400 text-white"
              }`}>
                <span>{keycard.occupied ? "🔑" : "🔓"}</span>
                <span>{keycard.occupied ? "Bezet" : "Vrij"}</span>
              </div>
            )}
          </div>
          {keycard?.found === false && (
            <div className="bg-blue-50 px-5 py-1.5 text-xs text-blue-400">
              Geen keycard-sensor gevonden ({keycard.entity_id})
            </div>
          )}

          {/* Meld mij toggle — alleen als: toegewezen + kamer bezet + sensor gevonden */}
          {ticket.assigned_to && keycard?.found && keycard.occupied && (
            <button
              onClick={() => updateField({ notify_when_free: !ticket.notify_when_free })}
              className={`w-full flex items-center justify-between px-5 py-3 transition-colors ${
                ticket.notify_when_free
                  ? "bg-amber-50 border-t border-amber-200"
                  : "bg-gray-50 border-t border-gray-200"
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">{ticket.notify_when_free ? "🔔" : "🔕"}</span>
                <div className="text-left">
                  <p className={`text-sm font-semibold ${ticket.notify_when_free ? "text-amber-800" : "text-gray-700"}`}>
                    Meld mij wanneer de kamer vrij is
                  </p>
                  {ticket.notify_when_free && (
                    <p className="text-xs text-amber-600">Je ontvangt een pushbericht zodra de kamer leeg is</p>
                  )}
                </div>
              </div>
              {/* Toggle schakelaar */}
              <div className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                ticket.notify_when_free ? "bg-amber-400" : "bg-gray-300"
              }`}>
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  ticket.notify_when_free ? "translate-x-5" : "translate-x-0.5"
                }`} />
              </div>
            </button>
          )}
        </div>
      )}

      {/* Aangemaakt / gesloten door */}
      <div className="card space-y-2 text-sm">
        <div className="flex items-center gap-2 text-gray-600">
          <span className="text-base">✏️</span>
          <span>Aangemaakt door</span>
          <span className="font-semibold text-gray-900">
            {usersMap[ticket.created_by] || (ticket.created_by === "system" ? "Home Assistant" : ticket.created_by)}
          </span>
          <span className="text-gray-400">·</span>
          <span className="text-gray-400">{format(parseUTC(ticket.created_at), "d MMM yyyy HH:mm", { locale: nl })}</span>
        </div>

        {ticket.closed_by && ticket.closed_at && (
          <div className="flex items-center gap-2 text-gray-600">
            <span className="text-base">✅</span>
            <span>Gesloten door</span>
            <span className="font-semibold text-gray-900">
              {usersMap[ticket.closed_by] || ticket.closed_by}
            </span>
            <span className="text-gray-400">·</span>
            <span className="text-gray-400">{format(parseUTC(ticket.closed_at!), "d MMM yyyy HH:mm", { locale: nl })}</span>
          </div>
        )}
      </div>

      {/* Subtaken */}
      {ticket.subtasks && ticket.subtasks.length > 0 && (
        <div className="card space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Subtaken</h2>
            <span className="text-xs text-gray-400">
              {ticket.subtasks.filter((s) => s.done).length}/{ticket.subtasks.length} gedaan
            </span>
          </div>
          {ticket.subtasks.map((subtask, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => toggleSubtask(idx, subtask.done)}
              disabled={ticket.status === "closed"}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border-2 text-left transition-all disabled:opacity-60 ${
                subtask.done
                  ? "border-green-200 bg-green-50"
                  : "border-gray-200 bg-white hover:border-gray-300"
              }`}
            >
              <span className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${
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
      )}

      {/* Details */}
      <div className="card space-y-4">
        {ticket.description && (
          <p className="text-gray-700 whitespace-pre-wrap">{ticket.description}</p>
        )}

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Toegewezen aan</p>
            <select
              value={ticket.assigned_to || ""}
              onChange={(e) => updateField({ assigned_to: e.target.value || null })}
              className="mt-1 border border-gray-300 rounded-lg px-2 py-1 text-sm bg-white w-full"
            >
              <option value="">— Niet toegewezen —</option>
              {users.map((u) => (
                <option key={u.ha_user_id} value={u.ha_user_id}>{u.display_name}</option>
              ))}
            </select>
          </div>

          <div>
            <p className="text-gray-500">Status</p>
            <select
              value={ticket.status}
              onChange={(e) => updateField({ status: e.target.value as Status })}
              className="mt-1 border border-gray-300 rounded-lg px-2 py-1 text-sm bg-white w-full"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-1">
          {ticket.status === "open" && !ticket.assigned_to && (
            <button onClick={claimTicket} className="btn-secondary w-full">
              Ticket overnemen
            </button>
          )}

          {ticket.status !== "closed" && (
            <button
              onClick={() => updateField({ status: "closed" })}
              className="w-full py-3 rounded-xl bg-green-600 hover:bg-green-700 text-white font-semibold text-base transition-colors flex items-center justify-center gap-2"
            >
              <span>✓</span> Ticket sluiten
            </button>
          )}

          {ticket.status === "closed" && (
            <button
              onClick={() => updateField({ status: "open" })}
              className="w-full py-2 rounded-xl border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium transition-colors"
            >
              Ticket heropenen
            </button>
          )}
        </div>
      </div>

      {/* Commentaar */}
      <div className="card space-y-3">
        <h2 className="font-semibold">Commentaar</h2>
        <div className="space-y-3">
          {comments.map((c) => (
            <div key={c.id} className="bg-gray-50 rounded-lg p-3">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                <span>{usersMap[c.author_id] || c.author_id}</span>
                <span>{format(parseUTC(c.created_at), "d MMM HH:mm", { locale: nl })}</span>
              </div>
              <p className="text-sm text-gray-800 whitespace-pre-wrap">{c.body}</p>
            </div>
          ))}
          {comments.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">Nog geen commentaar</p>
          )}
        </div>
        <form onSubmit={submitComment} className="flex gap-2">
          <textarea
            value={commentBody}
            onChange={(e) => setCommentBody(e.target.value)}
            placeholder="Voeg commentaar toe..."
            rows={2}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
          />
          <button type="submit" disabled={saving || !commentBody.trim()} className="btn-primary self-end">
            Verstuur
          </button>
        </form>
      </div>

      {/* Gevaarzone */}
      <div className="card border-red-100">
        <button onClick={deleteTicket} className="text-red-600 hover:text-red-700 text-sm font-medium">
          Ticket verwijderen
        </button>
      </div>
    </div>
  );
}
