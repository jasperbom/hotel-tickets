import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { nl } from "date-fns/locale";
import { notificationApi, ticketApi, userApi, parseUTC, type TicketNotification, type UserRole } from "../api/client";
import { MentionTextarea, renderWithMentions } from "../components/MentionTextarea";

export default function Berichten() {
  const [notifications, setNotifications] = useState<TicketNotification[]>([]);
  const [users, setUsers] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sentFor, setSentFor] = useState<Set<string>>(new Set());

  useEffect(() => {
    Promise.all([notificationApi.list(), userApi.list()])
      .then(([n, u]) => {
        setNotifications(n.data);
        setUsers(u.data);
      })
      .finally(() => setLoading(false));
  }, []);

  const userNames = users.map((u) => u.display_name);
  const unread = notifications.filter((n) => !n.read);

  async function markRead(n: TicketNotification) {
    if (n.read) return;
    setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
    notificationApi.markRead(n.id).catch(() => {});
  }

  async function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    notificationApi.markAllRead().catch(() => {});
  }

  async function sendReply(n: TicketNotification) {
    const body = replyBody.trim();
    if (!body) return;
    setSending(true);
    try {
      await ticketApi.addComment(n.ticket_id, body);
      setReplyBody("");
      setReplyingTo(null);
      setSentFor((prev) => new Set(prev).add(n.id));
      markRead(n);
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          ✉️ Berichten
          {unread.length > 0 && (
            <span className="text-sm font-semibold bg-red-500 text-white rounded-full px-2.5 py-0.5">
              {unread.length}
            </span>
          )}
        </h1>
        {unread.length > 0 && (
          <button onClick={markAllRead} className="text-sm text-blue-600 hover:underline">
            Alles als gelezen markeren
          </button>
        )}
      </div>

      {notifications.length === 0 && (
        <div className="card text-center py-12 text-gray-400">
          <div className="text-4xl mb-3">📭</div>
          <p className="text-sm">
            Geen berichten. Je krijgt hier een bericht wanneer een collega je met{" "}
            <span className="font-semibold text-gray-500">@naam</span> noemt in een commentaar,
            of wanneer er commentaar komt op een ticket dat aan jou is toegewezen.
          </p>
        </div>
      )}

      <div className="space-y-3">
        {notifications.map((n) => (
          <div
            key={n.id}
            className={`card space-y-2 ${!n.read ? "border-blue-300 bg-blue-50/50" : ""}`}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 text-sm min-w-0">
                {!n.read && <span className="w-2 h-2 rounded-full bg-blue-600 shrink-0" title="Ongelezen" />}
                <span className="shrink-0">{n.type === "mention" ? "👋" : "💬"}</span>
                <span className="text-gray-700 min-w-0">
                  <span className="font-semibold">{n.actor_name || n.actor_id}</span>{" "}
                  {n.type === "mention" ? "noemde je in" : "reageerde op je ticket"}
                </span>
              </div>
              <span className="text-xs text-gray-400 shrink-0">
                {format(parseUTC(n.created_at), "dd-MM HH:mm", { locale: nl })}
              </span>
            </div>

            <Link
              to={`/tickets/${n.ticket_id}`}
              onClick={() => markRead(n)}
              className="block font-semibold text-blue-700 hover:underline text-sm"
            >
              🎫 {n.ticket_title || "Ticket"}
            </Link>

            {n.comment_body && (
              <p className="text-sm text-gray-800 whitespace-pre-wrap bg-white border border-gray-100 rounded-lg px-3 py-2">
                {renderWithMentions(n.comment_body, userNames)}
              </p>
            )}

            <div className="flex items-center gap-3 pt-1">
              {replyingTo !== n.id ? (
                <>
                  <button
                    onClick={() => { setReplyingTo(n.id); setReplyBody(""); }}
                    className="text-sm text-blue-600 hover:underline font-medium"
                  >
                    ↩︎ Reageren
                  </button>
                  {!n.read && (
                    <button onClick={() => markRead(n)} className="text-sm text-gray-500 hover:underline">
                      Als gelezen markeren
                    </button>
                  )}
                  {sentFor.has(n.id) && (
                    <span className="text-xs text-green-600 font-medium">✓ Reactie geplaatst</span>
                  )}
                </>
              ) : (
                <div className="flex-1 space-y-2">
                  <div className="flex gap-2">
                    <MentionTextarea
                      value={replyBody}
                      onChange={setReplyBody}
                      users={users}
                      placeholder="Schrijf een reactie... (@naam om iemand te noemen)"
                      rows={2}
                      autoFocus
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => sendReply(n)}
                      disabled={sending || !replyBody.trim()}
                      className="btn-primary text-sm"
                    >
                      Verstuur
                    </button>
                    <button
                      onClick={() => { setReplyingTo(null); setReplyBody(""); }}
                      className="btn-secondary text-sm"
                    >
                      Annuleren
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
