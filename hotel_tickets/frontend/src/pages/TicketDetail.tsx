import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { format } from "date-fns";
import { nl } from "date-fns/locale";
import { ticketApi, userApi, locationApi, knowledgeApi, notificationApi, parseUTC, type Ticket, type Comment, type UserRole, type Status, type Priority, type KeycardStatus, type Role, type Category } from "../api/client";
import { StatusBadge, PriorityBadge, CategoryBadge } from "../components/StatusBadge";
import { MentionTextarea, renderWithMentions } from "../components/MentionTextarea";

const PRIORITY_OPTIONS: { value: Priority; label: string }[] = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "Hoog" },
  { value: "medium", label: "Normaal" },
  { value: "low", label: "Laag" },
];

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In behandeling" },
  { value: "closed", label: "Gesloten" },
];

export default function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const usersMap = Object.fromEntries(users.map((u) => [u.ha_user_id, u.display_name]));

  const load = useCallback(async () => {
    if (!id) return;
    const [t, c, u, locs, p] = await Promise.all([
      ticketApi.get(id),
      ticketApi.getComments(id),
      userApi.list(),
      locationApi.list(),
      ticketApi.listPhotos(id),
    ]);
    setTicket(t.data);
    setComments(c.data);
    setUsers(u.data);
    setLocations(Object.fromEntries(locs.data.map((l) => [l.id, l.name])));
    setPhotos(p.data);

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
    } finally {
      setAddingSubtask(false);
    }
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
    if (!confirm("Weet je zeker dat je dit commentaar wil verwijderen?")) return;
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
    if (!confirm("Foto verwijderen?")) return;
    await ticketApi.deletePhoto(id, filename);
    setPhotos((prev) => prev.filter((p) => p.filename !== filename));
  }

  async function deleteTicket() {
    if (!id) return;
    if (!confirm("Weet je zeker dat je dit ticket wil verwijderen?")) return;
    await ticketApi.remove(id);
    navigate("/tickets");
  }

  async function addToKnowledgeBase() {
    if (!id) return;
    setKbStatus("saving");
    try {
      await knowledgeApi.fromTicket(id);
      setKbStatus("done");
    } catch {
      setKbStatus("idle");
      alert("Toevoegen aan kennisbank mislukt.");
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
  }

  if (!ticket) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
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

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* Header met terug-knop en ticket sluiten/heropenen */}
      <div className="flex items-start gap-3">
        {/* Terug: als het ticket direct geopend is (deep-link/notificatie/refresh)
            is er geen historie — val dan terug op de ticketlijst */}
        <button onClick={() => (location.key === "default" ? navigate("/tickets") : navigate(-1))} className="text-gray-400 hover:text-gray-700 mt-0.5 shrink-0">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          {editingField === "title" ? (
            <input
              autoFocus
              className="text-xl font-bold text-gray-900 w-full border-b-2 border-blue-400 focus:outline-none bg-transparent pb-0.5"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => { updateField({ title: editValue }); setEditingField(null); }}
              onKeyDown={(e) => {
                if (e.key === "Enter") { updateField({ title: editValue }); setEditingField(null); }
                if (e.key === "Escape") setEditingField(null);
              }}
            />
          ) : (
            <div className="flex items-center gap-2">
              <button
                onClick={togglePin}
                title={ticket.pinned ? "Verwijder uit favorieten" : "Pin bovenaan in mijn overzicht"}
                aria-label={ticket.pinned ? "Verwijder pin" : "Pin ticket"}
                className="shrink-0 text-2xl leading-none hover:scale-110 transition-transform"
              >
                <span className={ticket.pinned ? "text-yellow-500" : "text-gray-300 hover:text-yellow-400"}>
                  {ticket.pinned ? "★" : "☆"}
                </span>
              </button>
              <h1
                className={`text-xl font-bold text-gray-900 rounded px-0.5 -mx-0.5 flex-1 min-w-0 ${canEdit ? "cursor-text hover:bg-gray-50" : ""}`}
                onClick={() => { if (canEdit) { setEditingField("title"); setEditValue(ticket.title); } }}
                title={canEdit ? "Klik om te bewerken" : undefined}
              >
                {ticket.title}
              </h1>
            </div>
          )}
          <div className="flex flex-wrap gap-1.5 mt-2">
            <StatusBadge status={ticket.status} />
            {editingField === "priority" ? (
              <select
                autoFocus
                className="border border-gray-300 rounded px-2 py-0.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                value={ticket.priority}
                onChange={(e) => { updateField({ priority: e.target.value as Priority }); setEditingField(null); }}
                onBlur={() => setEditingField(null)}
              >
                {PRIORITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            ) : (
              <span
                className={canEdit ? "cursor-pointer hover:opacity-80" : ""}
                onClick={() => { if (canEdit) setEditingField("priority"); }}
                title={canEdit ? "Klik om prioriteit te wijzigen" : undefined}
              >
                <PriorityBadge priority={ticket.priority} />
              </span>
            )}
            <CategoryBadge category={ticket.category} />
          </div>
        </div>
        {canEdit && (ticket.status !== "closed" ? (
          <button
            onClick={() => updateField({ status: "closed" })}
            className="shrink-0 px-4 py-2 rounded-xl bg-green-600 hover:bg-green-700 text-white font-semibold text-sm transition-colors flex items-center gap-1.5"
          >
            <span>✓</span> Sluiten
          </button>
        ) : (
          <button
            onClick={() => updateField({ status: "open" })}
            className="shrink-0 px-4 py-2 rounded-xl border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium transition-colors"
          >
            Heropenen
          </button>
        ))}
      </div>

      {/* Alleen-lezen melding voor tickets van een andere afdeling */}
      {!canEdit && currentUserRole !== null && (
        <div className="flex items-center gap-2 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-800">
          <span>👀</span>
          <p>Ticket van een andere afdeling — je kunt meekijken en commentaar of foto's toevoegen, maar niet wijzigen of afvinken.</p>
        </div>
      )}

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
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                  ticket.notify_when_free ? "translate-x-5" : "translate-x-0"
                }`} />
              </div>
            </button>
          )}
        </div>
      )}

      {/* Info: Aangemaakt door / Gesloten door / Toegewezen aan */}
      <div className="card space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-gray-600">
          <span className="text-base shrink-0">✏️</span>
          <span className="whitespace-nowrap">Aangemaakt door</span>
          <span className="font-semibold text-gray-900 whitespace-nowrap">
            {usersMap[ticket.created_by] || (ticket.created_by === "system" ? "Home Assistant" : ticket.created_by)}
          </span>
          <span className="text-gray-400 hidden sm:inline">·</span>
          <span className="text-gray-400 whitespace-nowrap">{format(parseUTC(ticket.created_at), "dd-MM-yyyy HH:mm", { locale: nl })}</span>
        </div>

        {ticket.closed_by && ticket.closed_at && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-gray-600">
            <span className="text-base shrink-0">✅</span>
            <span className="whitespace-nowrap">Gesloten door</span>
            <span className="font-semibold text-gray-900 whitespace-nowrap">
              {usersMap[ticket.closed_by] || ticket.closed_by}
            </span>
            <span className="text-gray-400 hidden sm:inline">·</span>
            <span className="text-gray-400 whitespace-nowrap">{format(parseUTC(ticket.closed_at!), "dd-MM-yyyy HH:mm", { locale: nl })}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-gray-600">
          <span className="text-base shrink-0">👤</span>
          <span className="whitespace-nowrap">Toegewezen aan</span>
          <select
            value={ticket.assigned_to || ""}
            onChange={(e) => updateField({ assigned_to: e.target.value || null })}
            disabled={!canEdit}
            className="border border-gray-300 rounded-lg px-2 py-1 text-sm bg-white min-w-0 max-w-full disabled:bg-gray-50 disabled:text-gray-500"
          >
            <option value="">— Niet toegewezen —</option>
            {users.map((u) => (
              <option key={u.ha_user_id} value={u.ha_user_id}>{u.display_name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Subtaken */}
      {((ticket.subtasks && ticket.subtasks.length > 0) || (ticket.status !== "closed" && canEdit)) && (
        <div className="card space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">Subtaken</h2>
            {ticket.subtasks && ticket.subtasks.length > 0 && (
              <span className="text-xs text-gray-400">
                {ticket.subtasks.filter((s) => s.done).length}/{ticket.subtasks.length} gedaan
              </span>
            )}
          </div>
          {ticket.subtasks?.map((subtask, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => toggleSubtask(idx, subtask.done)}
              disabled={ticket.status === "closed" || !canEdit}
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
          {ticket.status !== "closed" && canEdit && (
            <form onSubmit={addSubtask} className="flex gap-2 pt-1">
              <input
                type="text"
                value={newSubtaskLabel}
                onChange={(e) => setNewSubtaskLabel(e.target.value)}
                placeholder="Subtaak toevoegen..."
                className="flex-1 min-w-0 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              <button
                type="submit"
                disabled={addingSubtask || !newSubtaskLabel.trim()}
                className="shrink-0 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                Toevoegen
              </button>
            </form>
          )}
        </div>
      )}

      {/* Details */}
      <div className="card space-y-4">
        <div>
          <h2 className="font-semibold mb-1">Omschrijving</h2>
          {editingField === "description" ? (
            <textarea
              autoFocus
              rows={4}
              className="w-full border border-blue-400 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => { updateField({ description: editValue }); setEditingField(null); }}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditingField(null);
              }}
            />
          ) : (
            <p
              className={`text-sm whitespace-pre-wrap rounded px-1 -mx-1 py-0.5 ${canEdit ? "cursor-text hover:bg-gray-50" : ""} ${ticket.description ? "text-gray-700" : "text-gray-400 italic"}`}
              onClick={() => { if (canEdit) { setEditingField("description"); setEditValue(ticket.description || ""); } }}
              title={canEdit ? "Klik om te bewerken" : undefined}
            >
              {ticket.description || (canEdit ? "Klik om een omschrijving toe te voegen" : "Geen omschrijving")}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Status</p>
            <select
              value={ticket.status}
              onChange={(e) => updateField({ status: e.target.value as Status })}
              disabled={!canEdit}
              className="mt-1 border border-gray-300 rounded-lg px-2 py-1 text-sm bg-white w-full disabled:bg-gray-50 disabled:text-gray-500"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-1">
          {ticket.status === "open" && !ticket.assigned_to && canEdit && (
            <button onClick={claimTicket} className="btn-secondary w-full">
              Ticket overnemen
            </button>
          )}
        </div>
      </div>

      {/* Foto's */}
      <div className="card space-y-3">
        <h2 className="font-semibold">Foto's</h2>

        {photos.length > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {photos.map((p) => (
              <div key={p.filename} className="relative group">
                <button
                  onClick={() => setViewingPhoto(p.filename)}
                  className="w-full focus:outline-none"
                >
                  <img
                    src={ticketApi.photoUrl(id!, p.filename)}
                    alt=""
                    className="w-full h-32 object-cover rounded-lg border border-gray-200 cursor-pointer hover:opacity-90 transition-opacity"
                  />
                </button>
                <button
                  onClick={() => deletePhoto(p.filename)}
                  className="absolute top-1 right-1 bg-red-600 text-white rounded-full w-6 h-6 text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Verwijderen"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Foto lightbox */}
        {viewingPhoto && (
          <div
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
            onClick={() => setViewingPhoto(null)}
          >
            <button
              onClick={() => setViewingPhoto(null)}
              className="absolute top-4 right-4 text-white text-3xl font-bold hover:opacity-80 z-10"
            >
              ✕
            </button>
            <img
              src={ticketApi.photoUrl(id!, viewingPhoto)}
              alt=""
              className="max-w-full max-h-full object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        )}

        {photos.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-2">Nog geen foto's</p>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          onChange={handlePhotoUpload}
          className="hidden"
        />
        <div className="flex gap-2">
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="btn-secondary flex-1 flex items-center justify-center gap-2 text-sm"
          >
            {uploading ? "Uploaden..." : (<><span>📷</span> Foto toevoegen</>)}
          </button>
        </div>
      </div>

      {/* Commentaar */}
      <div className="card space-y-3">
        <h2 className="font-semibold">Commentaar</h2>
        <div className="space-y-3">
          {comments.map((c) => (
            <div key={c.id} className="bg-gray-50 rounded-lg p-3">
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                <div className="flex items-center gap-2">
                  <span>{usersMap[c.author_id] || c.author_id}</span>
                  {c.updated_at && <span className="text-gray-400 italic">(bewerkt)</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span>{format(parseUTC(c.created_at), "dd:MM HH:mm", { locale: nl })}</span>
                  {currentUserId === c.author_id && editingCommentId !== c.id && (
                    <>
                      <button
                        onClick={() => { setEditingCommentId(c.id); setEditingBody(c.body); }}
                        className="text-blue-500 hover:text-blue-700"
                        title="Bewerken"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => deleteComment(c.id)}
                        className="text-red-400 hover:text-red-600"
                        title="Verwijderen"
                      >
                        🗑️
                      </button>
                    </>
                  )}
                </div>
              </div>
              {editingCommentId === c.id ? (
                <div className="space-y-2">
                  <MentionTextarea
                    value={editingBody}
                    onChange={setEditingBody}
                    users={users}
                    rows={3}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveEditComment(c.id)}
                      disabled={saving || !editingBody.trim()}
                      className="btn-primary text-sm"
                    >
                      Opslaan
                    </button>
                    <button
                      onClick={() => deleteComment(c.id)}
                      className="text-sm text-red-600 hover:text-red-700 font-medium px-3 py-1.5"
                    >
                      Verwijderen
                    </button>
                    <button
                      onClick={() => { setEditingCommentId(null); setEditingBody(""); }}
                      className="btn-secondary text-sm"
                    >
                      Annuleren
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-800 whitespace-pre-wrap">
                  {renderWithMentions(c.body, users.map((u) => u.display_name))}
                </p>
              )}
            </div>
          ))}
          {comments.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-4">Nog geen commentaar</p>
          )}
        </div>
        <form onSubmit={submitComment} className="flex gap-2">
          <MentionTextarea
            value={commentBody}
            onChange={setCommentBody}
            users={users}
            placeholder="Voeg commentaar toe... (@naam om een collega te noemen)"
            rows={2}
            resizable
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
          />
          <button type="submit" disabled={saving || !commentBody.trim()} className="btn-primary self-end">
            Verstuur
          </button>
        </form>
      </div>

      {/* Kennisbank: gesloten ticket promoveren (alleen admin) */}
      {ticket.status === "closed" && currentUserRole === "admin" && (
        <div className="card border-blue-100 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-800">Toevoegen aan kennisbank</p>
            <p className="text-xs text-gray-500">
              Maak van dit opgeloste ticket een kennis-item zodat de bot het voortaan kan beantwoorden.
            </p>
          </div>
          <button
            onClick={addToKnowledgeBase}
            disabled={kbStatus !== "idle"}
            className="shrink-0 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
          >
            {kbStatus === "saving" ? "Bezig..." : kbStatus === "done" ? "✓ Toegevoegd" : "Toevoegen"}
          </button>
        </div>
      )}

      {/* Gevaarzone — verwijderen kan alleen als admin/supervisor */}
      {isManagerUser && (
        <div className="card border-red-100">
          <button onClick={deleteTicket} className="text-red-600 hover:text-red-700 text-sm font-medium">
            Ticket verwijderen
          </button>
        </div>
      )}
    </div>
  );
}
