import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { format } from "date-fns";
import { nl } from "date-fns/locale";
import { ticketApi, userApi, locationApi, knowledgeApi, notificationApi, parseUTC, type Ticket, type Comment, type TicketEvent, type UserRole, type Priority, type Status, type KeycardStatus, type Role, type Category } from "../api/client";
import { Camera, Check, ChevronLeft, Clock, MoreHorizontal } from "lucide-react";
import { AFDELING_KORT, AFDELING_LABELS, bezigTekst, eigendom, kamerKleur, kamerToestand, leeftijdTekst, prioriteitWoord } from "../werk";
import { MentionTextarea, renderWithMentions } from "../components/MentionTextarea";

const PRIO_WOORD: Record<string, string> = {
  urgent: "urgent", high: "hoog", medium: "normaal", low: "laag",
};

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "Hoog" },
  { value: "medium", label: "Normaal" },
  { value: "low", label: "Laag" },
];

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In behandeling" },
  { value: "closed", label: "Afgerond" },
];

/**
 * Het ticketdetail. Op desktop (vanaf 1280 px) wordt dit component ingebed in
 * de rechterkolom van de ticketlijst; dan komt het id als prop binnen en plakt
 * de actiebalk onderin de kolom in plaats van onderin het venster.
 */
export default function TicketDetail({
  ticketId,
  ingebed = false,
  onGewijzigd,
}: {
  ticketId?: string;
  ingebed?: boolean;
  /** Ingebed naast de ticketlijst: laat die lijst weten dat er iets veranderd is. */
  onGewijzigd?: () => void;
} = {}) {
  const { id: paramId } = useParams<{ id: string }>();
  const id = ticketId ?? paramId;
  const navigate = useNavigate();
  const location = useLocation();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [events, setEvents] = useState<TicketEvent[]>([]);
  const [users, setUsers] = useState<UserRole[]>([]);
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [keycard, setKeycard] = useState<KeycardStatus | null>(null);
  const [commentBody, setCommentBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<Role | null>(null);
  const [currentUserDept, setCurrentUserDept] = useState<Category | null>(null);
  const [kbStatus, setKbStatus] = useState<"idle" | "saving" | "done">("idle");
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState("");
  const [editingField, setEditingField] = useState<"title" | "description" | "priority" | null>(null);
  const [editValue, setEditValue] = useState("");
  const [photos, setPhotos] = useState<{ filename: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [viewingPhoto, setViewingPhoto] = useState<string | null>(null);
  const [newSubtaskLabel, setNewSubtaskLabel] = useState("");
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toewijzenOpen, setToewijzenOpen] = useState(false);
  const [verwijderen, setVerwijderen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const usersMap = Object.fromEntries(users.map((u) => [u.ha_user_id, u.display_name]));

  const load = useCallback(async () => {
    if (!id) return;
    // Het ticket moet lukken; kamernamen, collega's en foto's zijn bijzaak —
    // hapert Home Assistant, dan hoort het scherm niet op een spinner te
    // blijven staan.
    const t = await ticketApi.get(id);
    setTicket(t.data);

    const [c, u, locs, p, ev] = await Promise.allSettled([
      ticketApi.getComments(id),
      userApi.list(),
      locationApi.list(),
      ticketApi.listPhotos(id),
      ticketApi.getEvents(id),
    ]);
    if (c.status === "fulfilled") setComments(c.value.data);
    if (ev.status === "fulfilled") setEvents(ev.value.data);
    if (u.status === "fulfilled") setUsers(u.value.data);
    if (locs.status === "fulfilled") {
      setLocations(Object.fromEntries(locs.value.data.map((l) => [l.id, l.name])));
    }
    if (p.status === "fulfilled") setPhotos(p.value.data);

    // Haal huidige gebruiker op voor commentaar-bewerking
    userApi.me().then((r) => {
      setCurrentUserId(r.data.ha_user_id);
      setCurrentUserRole(r.data.role);
      setCurrentUserDept(r.data.department);
    }).catch(() => {});

    // Berichten over dit ticket als gelezen markeren (envelopje)
    notificationApi.markReadByTicket(id).catch(() => {});

    // Keycard sensor ophalen als er een locatie is
    if (t.data.location_id) {
      locationApi.keycard(t.data.location_id)
        .then((r) => setKeycard(r.data))
        .catch(() => {});
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    function buiten(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    if (menuOpen) {
      document.addEventListener("mousedown", buiten);
      return () => document.removeEventListener("mousedown", buiten);
    }
  }, [menuOpen]);

  async function updateField(data: Partial<Ticket>) {
    if (!id) return;
    const r = await ticketApi.update(id, data);
    setTicket(r.data);
    onGewijzigd?.();
    // Het verloop is de neerslag van precies deze handeling; zonder dit stond
    // "nam dit in behandeling" er pas na een verversing bij.
    ticketApi.getEvents(id).then((ev) => setEvents(ev.data)).catch(() => {});
  }

  async function toggleSubtask(index: number, currentDone: boolean) {
    if (!id) return;
    const r = await ticketApi.updateSubtask(id, index, !currentDone);
    setTicket((prev) => prev ? { ...prev, subtasks: r.data.subtasks } : prev);
    onGewijzigd?.();
  }

  async function addSubtask(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    const label = newSubtaskLabel.trim();
    if (!label) return;
    setAddingSubtask(true);
    try {
      const r = await ticketApi.addSubtask(id, label);
      setTicket((prev) => prev ? { ...prev, subtasks: r.data.subtasks } : prev);
      setNewSubtaskLabel("");
      onGewijzigd?.();
    } finally {
      setAddingSubtask(false);
    }
  }

  async function claimTicket() {
    if (!id) return;
    const r = await ticketApi.claim(id);
    setTicket(r.data);
    onGewijzigd?.();
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

  async function saveEditComment(commentId: string) {
    if (!id || !editingBody.trim()) return;
    setSaving(true);
    const r = await ticketApi.updateComment(id, commentId, editingBody);
    setComments((prev) => prev.map((c) => c.id === commentId ? r.data : c));
    setEditingCommentId(null);
    setEditingBody("");
    setSaving(false);
  }

  async function deleteComment(commentId: string) {
    if (!id) return;
    await ticketApi.deleteComment(id, commentId);
    setComments((prev) => prev.filter((c) => c.id !== commentId));
    setEditingCommentId(null);
    setEditingBody("");
  }

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!id || !e.target.files?.length) return;
    setUploading(true);
    try {
      for (const file of Array.from(e.target.files)) {
        await ticketApi.uploadPhoto(id, file);
      }
      const p = await ticketApi.listPhotos(id);
      setPhotos(p.data);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function deletePhoto(filename: string) {
    if (!id) return;
    await ticketApi.deletePhoto(id, filename);
    setPhotos((prev) => prev.filter((p) => p.filename !== filename));
  }

  async function deleteTicket() {
    if (!id) return;
    await ticketApi.remove(id);
    onGewijzigd?.();
    if (!ingebed) navigate("/tickets");
  }

  async function addToKnowledgeBase() {
    if (!id) return;
    setKbStatus("saving");
    try {
      await knowledgeApi.fromTicket(id);
      setKbStatus("done");
    } catch {
      setKbStatus("idle");
    }
  }

  async function togglePin() {
    if (!id || !ticket) return;
    if (ticket.pinned) {
      await ticketApi.unpin(id);
    } else {
      await ticketApi.pin(id);
    }
    setTicket((prev) => prev ? { ...prev, pinned: !prev.pinned } : prev);
    onGewijzigd?.();
  }

  if (!ticket) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
      </div>
    );
  }

  const locationName = ticket.location_id ? locations[ticket.location_id] : null;

  // Iedereen mag alle tickets bekijken en commentaar/foto's toevoegen, maar
  // wijzigen (sluiten, claimen, subtaken, velden) kan alleen binnen de eigen
  // afdeling, als toegewezene/aanmaker of als admin/supervisor.
  const isManagerUser = currentUserRole === "admin" || currentUserRole === "supervisor";
  const canEdit =
    isManagerUser ||
    (currentUserId !== null && (ticket.assigned_to === currentUserId || ticket.created_by === currentUserId)) ||
    (currentUserDept !== null && ticket.category === currentUserDept);

  const bezit = eigendom(ticket, currentUserId ?? "", (uid) => usersMap[uid] ?? uid);
  const isAf = ticket.status === "closed";
  const kamerBezet = keycard?.found ? keycard.occupied : null;
  const meekijken = !canEdit;

  const naam = (id: string | null | undefined) =>
    !id ? "iemand" : id === "system" ? "Home Assistant" : usersMap[id] ?? id;

  /** Eén regel per gebeurtenis, in gewoon Nederlands. */
  function gebeurtenisTekst(e: TicketEvent): string {
    switch (e.type) {
      case "created": return `${naam(e.actor_id)} meldde dit`;
      case "assigned":
        return e.to_value === e.actor_id
          ? `${naam(e.actor_id)} pakte dit op`
          : `${naam(e.actor_id)} wees dit toe aan ${naam(e.to_value)}`;
      case "unassigned": return `${naam(e.actor_id)} haalde de toewijzing eraf`;
      case "priority": return `${naam(e.actor_id)} zette de prioriteit op ${PRIO_WOORD[e.to_value ?? ""] ?? e.to_value}`;
      case "category": return `${naam(e.actor_id)} verplaatste dit naar een andere afdeling`;
      case "closed": return `${naam(e.actor_id)} rondde dit af`;
      case "reopened": return `${naam(e.actor_id)} heropende dit`;
      case "started": return `${naam(e.actor_id)} nam dit in behandeling`;
      case "stopped": return `${naam(e.actor_id)} zette dit terug op open`;
      default: return naam(e.actor_id);
    }
  }

  /**
   * Verloop: het gebeurtenissenlogboek en de reacties chronologisch door
   * elkaar. Tickets van vóór dit logboek hebben nog geen gebeurtenissen; dan
   * vallen we terug op created_by/closed_by, zodat oude tickets niet leeg zijn.
   */
  // Per regel terugvallen, niet in één keer: een bestaand ticket dat ná de
  // upgrade voor het eerst gewijzigd wordt heeft wél gebeurtenissen maar geen
  // "gemeld"-regel, en die hoort er toch te staan.
  const heeftAanmaak = events.some((e) => e.type === "created");
  const heeftAfronding = events.some((e) => e.type === "closed");
  const verloop = [
    ...(heeftAanmaak
      ? []
      : [{
          key: "aangemaakt",
          op: ticket.created_at,
          tekst: `${naam(ticket.created_by)} meldde dit`,
          body: null as string | null,
        }]),
    ...events.map((e) => ({
      key: e.id,
      op: e.created_at,
      tekst: gebeurtenisTekst(e),
      body: null as string | null,
    })),
    ...comments.map((c) => ({
      key: c.id,
      op: c.created_at,
      tekst: `${naam(c.author_id)}${c.updated_at ? " (bewerkt)" : ""}`,
      body: c.body,
    })),
    ...(!heeftAfronding && isAf && ticket.closed_at
      ? [{
          key: "afgerond",
          op: ticket.closed_at,
          tekst: `${naam(ticket.closed_by)} rondde dit af`,
          body: null as string | null,
        }]
      : []),
  ].sort((a, b) => a.op.localeCompare(b.op));

  const metaregel = [
    prioriteitWoord(ticket.priority),
    bezigTekst(ticket.status),
    // bezit.label is bij werk zonder eigenaar zélf de afdeling; dan hoeft hij
    // er niet nog een keer los voor te staan.
    bezit.soort === "afdeling" ? null : AFDELING_KORT[ticket.category],
    bezit.label,
    leeftijdTekst(ticket.created_at, isAf ? 999 : 3),
  ].filter(Boolean).join(" · ");

  return (
    <div className={ingebed ? "" : "max-w-2xl pb-40"}>
      {/* Kop: terug, schermnaam, en één ⋯-menu voor alles wat je zelden doet */}
      <div className="flex items-center gap-1 -mt-2 mb-3">
        {!ingebed && (
          <button
            onClick={() => (location.key === "default" ? navigate("/tickets") : navigate(-1))}
            aria-label="Terug"
            className="tap -ml-2 text-ink-45 hover:text-ink"
          >
            <ChevronLeft size={24} aria-hidden="true" />
          </button>
        )}
        <span className="meta">Ticket</span>
        {canEdit && (
          <div className="ml-auto relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              aria-label="Meer acties"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className="tap text-ink-45 hover:text-ink"
            >
              <MoreHorizontal size={22} aria-hidden="true" />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-full mt-1 z-40 w-60 rounded-xl border border-ink-12 bg-paper-raised shadow-lg py-1">
                <MenuKnop onClick={() => { setEditingField("title"); setEditValue(ticket.title); setMenuOpen(false); }}>
                  Titel bewerken
                </MenuKnop>
                <MenuKnop onClick={() => { setEditingField("description"); setEditValue(ticket.description ?? ""); setMenuOpen(false); }}>
                  Omschrijving bewerken
                </MenuKnop>
                <div className="px-4 pt-2 pb-1 meta">Status</div>
                {STATUS_OPTIONS.map((o) => (
                  <MenuKnop
                    key={o.value}
                    onClick={() => { updateField({ status: o.value }); setMenuOpen(false); }}
                    actief={ticket.status === o.value}
                  >
                    {o.label}
                  </MenuKnop>
                ))}
                <div className="px-4 pt-2 pb-1 meta">Prioriteit</div>
                {PRIORITY_OPTIONS.map((o) => (
                  <MenuKnop
                    key={o.value}
                    onClick={() => { updateField({ priority: o.value }); setMenuOpen(false); }}
                    actief={ticket.priority === o.value}
                  >
                    {o.label}
                  </MenuKnop>
                ))}
                <div className="my-1 border-t border-ink-12" />
                <MenuKnop onClick={() => { togglePin(); setMenuOpen(false); }}>
                  {ticket.pinned ? "Losmaken van bovenaan" : "Bovenaan vastzetten"}
                </MenuKnop>
                <MenuKnop onClick={() => { setToewijzenOpen(true); setMenuOpen(false); }}>
                  Toewijzen aan…
                </MenuKnop>
                {isManagerUser && (
                  <MenuKnop onClick={() => { setVerwijderen(true); setMenuOpen(false); }} gevaar>
                    Ticket verwijderen
                  </MenuKnop>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Banners: meekijken of afgerond */}
      {meekijken && (
        <p className="mb-4 rounded-[10px] border border-ink-12 bg-ink-6 px-4 py-3 text-meta text-ink-70">
          Meekijken — {AFDELING_LABELS[ticket.category]} kan dit wijzigen. Jij kunt reageren en een foto toevoegen.
        </p>
      )}
      {ticket.status === "in_progress" && !isAf && (
        <p className="mb-4 flex items-center gap-2 rounded-[10px] bg-ink-6 px-4 py-3 text-meta text-brand font-medium">
          <Clock size={18} aria-hidden="true" />
          In behandeling
          {ticket.assigned_to ? ` door ${usersMap[ticket.assigned_to] ?? ticket.assigned_to}` : ""}
        </p>
      )}
      {isAf && (
        <p className="mb-4 flex items-center gap-2 rounded-[10px] bg-done-soft px-4 py-3 text-meta text-done font-medium">
          <Check size={18} aria-hidden="true" />
          Afgerond{ticket.closed_by ? ` door ${usersMap[ticket.closed_by] ?? ticket.closed_by}` : ""}
          {ticket.closed_at ? ` · ${format(parseUTC(ticket.closed_at), "d MMM HH:mm", { locale: nl })}` : ""}
        </p>
      )}

      {/* Kamer, titel, één metaregel */}
      <div className="flex items-baseline gap-2.5 flex-wrap">
        {locationName && (
          <h1 className={`text-3xl font-bold leading-none ${kamerKleur(kamerBezet) || "text-ink"}`}>
            {locationName}
            {kamerToestand(kamerBezet) && (
              <span className="sr-only">, {kamerToestand(kamerBezet)}</span>
            )}
          </h1>
        )}
      </div>
      {editingField === "title" ? (
        <input
          autoFocus
          className="mt-2 w-full text-[1.3125rem] font-medium text-ink bg-transparent border-b-2 border-brand focus:outline-none pb-1"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onBlur={() => { updateField({ title: editValue }); setEditingField(null); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { updateField({ title: editValue }); setEditingField(null); }
            if (e.key === "Escape") setEditingField(null);
          }}
        />
      ) : (
        <h2 className="mt-2 text-[1.3125rem] leading-snug text-ink">{ticket.title}</h2>
      )}
      <p className="meta mt-1.5">
        {prioriteitWoord(ticket.priority) && (
          <strong className={`font-semibold ${ticket.priority === "urgent" ? "text-urgent" : "text-high"}`}>
            {prioriteitWoord(ticket.priority)}{" · "}
          </strong>
        )}
        {metaregel.replace(new RegExp(`^${prioriteitWoord(ticket.priority)} · `), "")}
      </p>

      {/* De enige tijdgevoelige actie op dit scherm — alleen bij een bezette kamer */}
      {canEdit && !isAf && kamerBezet === true && (
        <label className="mt-4 flex items-center gap-3 rounded-[10px] border border-ink-12 bg-paper-raised px-4 py-3 cursor-pointer">
          <input
            type="checkbox"
            checked={ticket.notify_when_free}
            onChange={(e) => updateField({ notify_when_free: e.target.checked })}
            className="w-5 h-5 accent-[color:var(--brand)]"
          />
          <span className="min-w-0">
            <span className="block text-body text-ink">Meld mij als {locationName ?? "de kamer"} vrij is</span>
            <span className="block meta">Pushbericht zodra de gast uitcheckt</span>
          </span>
        </label>
      )}

      {/* Omschrijving */}
      <Sectie>
        {editingField === "description" ? (
          <textarea
            autoFocus
            rows={4}
            className="w-full rounded-[10px] border border-ink-12 px-3 py-2 text-body resize-none focus:outline-none focus:ring-2 focus:ring-brand"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={() => { updateField({ description: editValue }); setEditingField(null); }}
          />
        ) : ticket.description ? (
          <p className="text-body text-ink-70 whitespace-pre-wrap">{ticket.description}</p>
        ) : (
          <p className="meta">Geen omschrijving.</p>
        )}
      </Sectie>

      {/* Subtaken */}
      {(ticket.subtasks?.length ?? 0) > 0 || (canEdit && !isAf) ? (
        <Sectie titel={`Subtaken${ticket.subtasks?.length ? ` ${ticket.subtasks.filter((s) => s.done).length}/${ticket.subtasks.length}` : ""}`}>
          {meekijken ? (
            <ul className="space-y-1.5">
              {ticket.subtasks?.map((s, i) => (
                <li key={i} className="flex items-baseline gap-2 text-body text-ink-70">
                  <span className="w-1.5 h-1.5 rounded-full bg-ink-25 shrink-0 translate-y-[-2px]" aria-hidden="true" />
                  <span className={s.done ? "line-through text-ink-45" : ""}>{s.label}</span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="space-y-1.5">
              {ticket.subtasks?.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleSubtask(i, s.done)}
                  disabled={isAf}
                  className="w-full min-h-tapLg flex items-center gap-3 px-3 rounded-[10px] border border-ink-12 bg-paper-raised text-left hover:bg-ink-6 disabled:opacity-60 transition-colors"
                >
                  <span className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${
                    s.done ? "bg-done border-done text-paper" : "border-ink-25"
                  }`}>
                    {s.done && <Check size={14} strokeWidth={3} aria-hidden="true" />}
                  </span>
                  <span className={`flex-1 text-body ${s.done ? "line-through text-ink-45" : "text-ink"}`}>{s.label}</span>
                </button>
              ))}
              {!isAf && (
                <form onSubmit={addSubtask} className="flex gap-2 pt-1">
                  <input
                    type="text"
                    value={newSubtaskLabel}
                    onChange={(e) => setNewSubtaskLabel(e.target.value)}
                    placeholder="Subtaak toevoegen"
                    className="flex-1 min-w-0 h-tap rounded-[10px] border border-ink-12 px-3 text-body focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                  <button
                    type="submit"
                    disabled={addingSubtask || !newSubtaskLabel.trim()}
                    className="shrink-0 h-tap px-4 rounded-[10px] border border-ink text-ink text-meta font-semibold disabled:opacity-50"
                  >
                    Toevoegen
                  </button>
                </form>
              )}
            </div>
          )}
        </Sectie>
      ) : null}

      {/* Foto's */}
      <Sectie titel="Foto's">
        <div className="flex flex-wrap gap-2">
          {photos.map((p) => (
            <button
              key={p.filename}
              onClick={() => setViewingPhoto(p.filename)}
              className="w-24 h-24 rounded-[10px] overflow-hidden border border-ink-12"
            >
              <img src={ticketApi.photoUrl(id!, p.filename)} alt="" className="w-full h-full object-cover" />
            </button>
          ))}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="w-24 h-24 rounded-[10px] border border-dashed border-ink-12 flex flex-col items-center justify-center gap-1 text-ink-45 hover:bg-ink-6 disabled:opacity-50"
          >
            <Camera size={20} aria-hidden="true" />
            <span className="text-[0.6875rem] font-medium leading-tight text-center">
              {uploading ? "Bezig…" : "Foto\nmaken"}
            </span>
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={handlePhotoUpload}
          className="hidden"
        />
      </Sectie>

      {/* Verloop — vervangt de losse kaarten "Aangemaakt door" en "Commentaar" */}
      <Sectie titel="Verloop">
        <ol className="space-y-3">
          {verloop.map((v) => (
            <li key={v.key} className="flex gap-3">
              <span className="meta shrink-0 tabular-nums w-[4.5rem]">
                {format(parseUTC(v.op), "EEE HH:mm", { locale: nl })}
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-meta text-ink-70">{v.tekst}</span>
                {v.body && (
                  <span className="block text-body text-ink whitespace-pre-wrap">
                    {renderWithMentions(v.body, users.map((u) => u.display_name))}
                  </span>
                )}
              </span>
              {v.body && currentUserId === comments.find((c) => c.id === v.key)?.author_id && (
                <button
                  onClick={() => { setEditingCommentId(v.key); setEditingBody(v.body!); }}
                  className="meta shrink-0 hover:text-ink"
                >
                  bewerk
                </button>
              )}
            </li>
          ))}
        </ol>

        {editingCommentId && (
          <div className="mt-3 space-y-2">
            <MentionTextarea
              value={editingBody}
              onChange={setEditingBody}
              users={users}
              rows={3}
              className="w-full rounded-[10px] border border-ink-12 px-3 py-2 text-body resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => saveEditComment(editingCommentId)}
                disabled={saving || !editingBody.trim()}
                className="h-tap px-4 rounded-[10px] bg-ink text-paper text-meta font-semibold disabled:opacity-50"
              >
                Opslaan
              </button>
              <button
                onClick={() => deleteComment(editingCommentId)}
                className="h-tap px-4 rounded-[10px] border border-urgent text-urgent text-meta font-semibold"
              >
                Verwijderen
              </button>
              <button
                onClick={() => { setEditingCommentId(null); setEditingBody(""); }}
                className="h-tap px-4 rounded-[10px] border border-ink-12 text-ink-70 text-meta font-semibold"
              >
                Annuleren
              </button>
            </div>
          </div>
        )}

        <form onSubmit={submitComment} className="mt-3 flex gap-2 items-end">
          <MentionTextarea
            value={commentBody}
            onChange={setCommentBody}
            users={users}
            placeholder="Reageren… (@naam om een collega te noemen)"
            rows={2}
            resizable
            className="w-full rounded-[10px] border border-ink-12 px-3 py-2 text-body resize-none"
          />
          <button
            type="submit"
            disabled={saving || !commentBody.trim()}
            className="shrink-0 h-tap px-4 rounded-[10px] border border-ink text-ink text-meta font-semibold disabled:opacity-50"
          >
            Verstuur
          </button>
        </form>
      </Sectie>

      {/* Toewijzen — uit het ⋯-menu, niet als dropdown tussen de inhoud */}
      {toewijzenOpen && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/40 p-4" onClick={() => setToewijzenOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl bg-paper-raised p-4 space-y-1" onClick={(e) => e.stopPropagation()}>
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-ink-45 px-2 pb-1">Toewijzen aan</p>
            <button
              onClick={() => { updateField({ assigned_to: null }); setToewijzenOpen(false); }}
              className="w-full min-h-tap px-3 rounded-[10px] text-left text-body text-ink-70 hover:bg-ink-6"
            >
              Niemand
            </button>
            {users.map((u) => (
              <button
                key={u.ha_user_id}
                onClick={() => { updateField({ assigned_to: u.ha_user_id }); setToewijzenOpen(false); }}
                className={`w-full min-h-tap px-3 rounded-[10px] text-left text-body hover:bg-ink-6 ${
                  ticket.assigned_to === u.ha_user_id ? "font-semibold text-ink" : "text-ink-70"
                }`}
              >
                {u.display_name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Verwijderen: geen browser-confirm, maar één stap terug in het scherm */}
      {verwijderen && (
        <div className="mt-6 rounded-[10px] border border-urgent bg-urgent-soft px-4 py-3 space-y-3">
          <p className="text-body text-ink">Dit ticket verwijderen? Dat kan niet ongedaan gemaakt worden.</p>
          <div className="flex gap-2">
            <button onClick={deleteTicket} className="h-tapLg px-4 rounded-[10px] bg-urgent text-paper text-meta font-semibold">
              Ja, verwijderen
            </button>
            <button onClick={() => setVerwijderen(false)} className="h-tapLg px-4 rounded-[10px] border border-ink-12 text-ink-70 text-meta font-semibold">
              Annuleren
            </button>
          </div>
        </div>
      )}

      {/* Foto groot bekijken */}
      {viewingPhoto && (
        <div className="fixed inset-0 z-50 bg-ink/90 flex items-center justify-center p-4" onClick={() => setViewingPhoto(null)}>
          <img src={ticketApi.photoUrl(id!, viewingPhoto)} alt="" className="max-w-full max-h-full object-contain" />
          <button
            onClick={(e) => { e.stopPropagation(); deletePhoto(viewingPhoto); setViewingPhoto(null); }}
            className="absolute bottom-6 h-tapLg px-4 rounded-[10px] border border-paper/50 text-paper text-meta font-semibold"
          >
            Foto verwijderen
          </button>
        </div>
      )}

      {/* Eén vaste actiebalk onderin — altijd bereikbaar zonder scrollen */}
      <div
        className={
          ingebed
            ? "sticky bottom-0 -mx-4 mt-5 border-t border-ink-12 bg-paper/95 backdrop-blur px-4 py-2.5"
            : "fixed left-0 right-0 z-30 border-t border-ink-12 bg-paper/95 backdrop-blur px-4 py-2.5 md:left-[calc(4rem+220px)]"
        }
        style={ingebed ? undefined : { bottom: "var(--onderbalk)" }}
      >
        <div className="max-w-2xl flex gap-2">
          {meekijken ? (
            <>
              <button
                onClick={() => document.querySelector<HTMLTextAreaElement>("textarea")?.focus()}
                className="flex-1 h-tapLg rounded-[10px] border border-ink text-ink text-body font-semibold"
              >
                Reageren
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex-1 h-tapLg rounded-[10px] border border-ink text-ink text-body font-semibold"
              >
                Foto maken
              </button>
            </>
          ) : isAf ? (
            <>
              <button
                onClick={() => updateField({ status: "open" })}
                className="flex-1 h-tapLg rounded-[10px] border border-ink text-ink text-body font-semibold"
              >
                Heropenen
              </button>
              {currentUserRole === "admin" && (
                <button
                  onClick={addToKnowledgeBase}
                  disabled={kbStatus !== "idle"}
                  className="flex-1 h-tapLg rounded-[10px] border border-ink-12 text-ink-70 text-body font-semibold disabled:opacity-50"
                >
                  {kbStatus === "saving" ? "Bezig…" : kbStatus === "done" ? "Toegevoegd" : "Naar kennisbank"}
                </button>
              )}
            </>
          ) : (
            <>
              {!ticket.assigned_to && (
                <button
                  onClick={claimTicket}
                  className="h-[3.25rem] px-5 rounded-[10px] border border-ink text-ink text-body font-semibold shrink-0"
                >
                  Pakken
                </button>
              )}
              {/* Aan/uit, geen eenrichtingsverkeer: wie per ongeluk op "Bezig"
                  tikt moet het ook terug kunnen zetten. */}
              <button
                onClick={() => updateField({ status: ticket.status === "in_progress" ? "open" : "in_progress" })}
                aria-pressed={ticket.status === "in_progress"}
                className={`h-[3.25rem] px-4 rounded-[10px] text-body font-semibold shrink-0 border ${
                  ticket.status === "in_progress"
                    ? "border-brand bg-ink-6 text-brand"
                    : "border-ink text-ink"
                }`}
              >
                Bezig
              </button>
              <button
                onClick={() => updateField({ status: "closed" })}
                className="flex-1 h-[3.25rem] rounded-[10px] bg-ink text-paper text-body font-semibold flex items-center justify-center gap-2"
              >
                <Check size={20} aria-hidden="true" /> Afronden
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Sectie met een streep erboven — geen kaarten in kaarten in een kaart. */
function Sectie({ titel, children }: { titel?: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 pt-5 border-t border-ink-12">
      {titel && <p className="mb-2.5 font-mono text-xs uppercase tracking-[0.14em] text-ink-45">{titel}</p>}
      {children}
    </section>
  );
}

function MenuKnop({
  children, onClick, actief, gevaar,
}: {
  children: React.ReactNode;
  onClick: () => void;
  actief?: boolean;
  gevaar?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center px-4 min-h-tap text-meta text-left hover:bg-ink-6 ${
        gevaar ? "text-urgent" : actief ? "font-semibold text-ink" : "text-ink-70"
      }`}
    >
      {children}
      {actief && <span className="ml-auto text-ink-45">✓</span>}
    </button>
  );
}
