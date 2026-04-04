import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { nl } from "date-fns/locale";
import { ticketApi, userApi, locationApi, type Ticket, type Comment, type UserRole, type Status, type KeycardStatus } from "../api/client";
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

      {/* Details */}
      <div className="card space-y-4">
        {ticket.description && (
          <p className="text-gray-700 whitespace-pre-wrap">{ticket.description}</p>
        )}

        <div className="grid grid-cols-2 gap-4 text-sm">
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
            <p className="text-gray-500">Aangemaakt op</p>
            <p className="mt-1 font-medium">
              {format(new Date(ticket.created_at), "d MMM yyyy HH:mm", { locale: nl })}
            </p>
          </div>

          {ticket.closed_at && (
            <div>
              <p className="text-gray-500">Gesloten op</p>
              <p className="mt-1 font-medium">
                {format(new Date(ticket.closed_at), "d MMM yyyy HH:mm", { locale: nl })}
              </p>
            </div>
          )}
        </div>

        {ticket.status === "open" && !ticket.assigned_to && (
          <button onClick={claimTicket} className="btn-secondary w-full">
            Ticket overnemen
          </button>
        )}
      </div>

      {/* Commentaar */}
      <div className="card space-y-3">
        <h2 className="font-semibold">Commentaar</h2>
        <div className="space-y-3">
          {comments.map((c) => (
            <div key={c.id} className="bg-gray-50 rounded-lg p-3">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                <span>{usersMap[c.author_id] || c.author_id}</span>
                <span>{format(new Date(c.created_at), "d MMM HH:mm", { locale: nl })}</span>
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
