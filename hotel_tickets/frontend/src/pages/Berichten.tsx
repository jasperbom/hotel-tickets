import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { nl } from "date-fns/locale";
import {
  notificationApi,
  ticketApi,
  userApi,
  messageApi,
  parseUTC,
  type TicketNotification,
  type UserRole,
  type Conversation,
  type DirectMessage,
} from "../api/client";
import { MentionTextarea, renderWithMentions } from "../components/MentionTextarea";

type Tab = "gesprekken" | "meldingen";

export default function Berichten() {
  const [tab, setTab] = useState<Tab>("gesprekken");

  const [notifications, setNotifications] = useState<TicketNotification[]>([]);
  const [users, setUsers] = useState<UserRole[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Directe berichten / gesprekken
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [openWith, setOpenWith] = useState<{ id: string; name: string } | null>(null);
  const [composing, setComposing] = useState(false);

  // Notificatie-reacties (bestaand gedrag)
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sentFor, setSentFor] = useState<Set<string>>(new Set());

  useEffect(() => {
    Promise.all([
      notificationApi.list(),
      userApi.list(),
      messageApi.conversations(),
      userApi.me(),
    ])
      .then(([n, u, c, m]) => {
        setNotifications(n.data);
        setUsers(u.data);
        setConversations(c.data);
        setMe(m.data.ha_user_id);
      })
      .finally(() => setLoading(false));
  }, []);

  const userNames = users.map((u) => u.display_name);
  const unread = notifications.filter((n) => !n.read);
  const unreadMsgTotal = conversations.reduce((sum, c) => sum + c.unread, 0);

  async function reloadConversations() {
    const c = await messageApi.conversations();
    setConversations(c.data);
  }

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

  // --- Gespreksweergave (één-op-één thread) ---
  if (openWith) {
    return (
      <ThreadView
        other={openWith}
        onBack={() => {
          setOpenWith(null);
          reloadConversations();
        }}
      />
    );
  }

  // --- Nieuw bericht opstellen ---
  if (composing) {
    return (
      <ComposeView
        users={users.filter((u) => u.ha_user_id !== me)}
        onCancel={() => setComposing(false)}
        onSent={(recipient) => {
          setComposing(false);
          setOpenWith(recipient);
        }}
      />
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
        ✉️ Berichten
      </h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
        <button
          onClick={() => setTab("gesprekken")}
          className={`flex-1 flex items-center justify-center gap-2 rounded-md py-1.5 text-sm font-medium transition-colors ${
            tab === "gesprekken" ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          💬 Gesprekken
          {unreadMsgTotal > 0 && (
            <span className="bg-red-500 text-white rounded-full px-2 py-0.5 text-[11px] font-bold">
              {unreadMsgTotal}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("meldingen")}
          className={`flex-1 flex items-center justify-center gap-2 rounded-md py-1.5 text-sm font-medium transition-colors ${
            tab === "meldingen" ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"
          }`}
        >
          🔔 Meldingen
          {unread.length > 0 && (
            <span className="bg-red-500 text-white rounded-full px-2 py-0.5 text-[11px] font-bold">
              {unread.length}
            </span>
          )}
        </button>
      </div>

      {tab === "gesprekken" ? (
        <>
          <div className="flex justify-end">
            <button onClick={() => setComposing(true)} className="btn-primary text-sm">
              ✏️ Nieuw bericht
            </button>
          </div>

          {conversations.length === 0 ? (
            <div className="card text-center py-12 text-gray-400">
              <div className="text-4xl mb-3">📭</div>
              <p className="text-sm">
                Nog geen gesprekken. Klik op <span className="font-semibold text-gray-500">Nieuw bericht</span>{" "}
                om een collega een bericht te sturen.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {conversations.map((c) => (
                <button
                  key={c.user_id}
                  onClick={() => setOpenWith({ id: c.user_id, name: c.display_name })}
                  className={`w-full card text-left flex items-center gap-3 hover:bg-gray-50 transition-colors ${
                    c.unread > 0 ? "border-blue-300 bg-blue-50/50" : ""
                  }`}
                >
                  <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold shrink-0">
                    {c.display_name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-gray-900 truncate">{c.display_name}</span>
                      <span className="text-xs text-gray-400 shrink-0">
                        {format(parseUTC(c.last_created_at), "dd-MM HH:mm", { locale: nl })}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-sm truncate ${c.unread > 0 ? "text-gray-900 font-medium" : "text-gray-500"}`}>
                        {c.last_from_me && <span className="text-gray-400">Jij: </span>}
                        {c.last_body}
                      </span>
                      {c.unread > 0 && (
                        <span className="bg-red-500 text-white rounded-full min-w-[18px] h-[18px] px-1 text-[10px] font-bold flex items-center justify-center shrink-0">
                          {c.unread}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {unread.length > 0 && (
            <div className="flex justify-end">
              <button onClick={markAllRead} className="text-sm text-blue-600 hover:underline">
                Alles als gelezen markeren
              </button>
            </div>
          )}

          {notifications.length === 0 && (
            <div className="card text-center py-12 text-gray-400">
              <div className="text-4xl mb-3">📭</div>
              <p className="text-sm">
                Geen meldingen. Je krijgt hier een melding wanneer een collega je met{" "}
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
        </>
      )}
    </div>
  );
}

// --- Nieuw bericht opstellen ---
function ComposeView({
  users,
  onCancel,
  onSent,
}: {
  users: UserRole[];
  onCancel: () => void;
  onSent: (recipient: { id: string; name: string }) => void;
}) {
  const [recipientId, setRecipientId] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    const text = body.trim();
    if (!recipientId || !text) return;
    setSending(true);
    setError(null);
    try {
      await messageApi.send(recipientId, text);
      const recipient = users.find((u) => u.ha_user_id === recipientId);
      onSent({ id: recipientId, name: recipient?.display_name || recipientId });
    } catch {
      setError("Versturen mislukt. Probeer het opnieuw.");
      setSending(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={onCancel} className="text-blue-600 hover:underline text-sm">
          ← Terug
        </button>
        <h1 className="text-xl font-bold text-gray-900">Nieuw bericht</h1>
      </div>

      <div className="card space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Aan</label>
          <select
            value={recipientId}
            onChange={(e) => setRecipientId(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          >
            <option value="">Kies een collega…</option>
            {[...users]
              .sort((a, b) => a.display_name.localeCompare(b.display_name))
              .map((u) => (
                <option key={u.ha_user_id} value={u.ha_user_id}>
                  {u.display_name}
                </option>
              ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Bericht</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Schrijf je bericht…"
            rows={4}
            autoFocus
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={send}
            disabled={sending || !recipientId || !body.trim()}
            className="btn-primary text-sm"
          >
            Verstuur
          </button>
          <button onClick={onCancel} className="btn-secondary text-sm">
            Annuleren
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Gespreksweergave (thread) ---
function ThreadView({
  other,
  onBack,
}: {
  other: { id: string; name: string };
  onBack: () => void;
}) {
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function load() {
    const r = await messageApi.thread(other.id);
    setMessages(r.data);
  }

  useEffect(() => {
    load().finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [other.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function send() {
    const text = body.trim();
    if (!text) return;
    setSending(true);
    try {
      const r = await messageApi.send(other.id, text);
      setMessages((prev) => [...prev, r.data]);
      setBody("");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center gap-2">
        <button onClick={onBack} className="text-blue-600 hover:underline text-sm">
          ← Terug
        </button>
        <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
          {other.name.charAt(0).toUpperCase()}
        </div>
        <h1 className="text-xl font-bold text-gray-900">{other.name}</h1>
      </div>

      <div className="card space-y-2 max-h-[60vh] overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-24">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
          </div>
        ) : messages.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">
            Nog geen berichten. Stuur het eerste bericht hieronder.
          </p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.from_me ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  m.from_me
                    ? "bg-blue-600 text-white rounded-br-sm"
                    : "bg-gray-100 text-gray-900 rounded-bl-sm"
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{m.body}</p>
                <div className={`text-[10px] mt-1 ${m.from_me ? "text-blue-100" : "text-gray-400"}`}>
                  {format(parseUTC(m.created_at), "dd-MM HH:mm", { locale: nl })}
                </div>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex gap-2 items-end">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder="Schrijf een bericht… (Enter = versturen)"
          rows={2}
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
        <button
          onClick={send}
          disabled={sending || !body.trim()}
          className="btn-primary text-sm shrink-0"
        >
          Verstuur
        </button>
      </div>
    </div>
  );
}
