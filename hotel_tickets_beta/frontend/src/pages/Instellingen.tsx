import { useEffect, useRef, useState } from "react";
import {
  userApi, integrationApi, systemSettingsApi, logbookApi, locationApi, poolApi, bikesModuleApi, bikeAdminApi, brandingApi, loginBrandingApi, recurringApi, knowledgeApi, authApi, sessionsApi, betaApi, parseUTC,
  type UserRole, type Role, type Category, type IntegrationStatus, type PoolConfigItem, type BikesModuleRoles,
  type RecurringTemplate, type KnowledgeAiSettings, type LoginBranding, type LoginBan, type Session,
  type BetaStatus, type BetaCopyResult, type LogObject, type LogObjectType,
} from "../api/client";
import { BevestigKnop } from "../components/BevestigKnop";
import AreaSelector from "../components/AreaSelector";
import { intervalTekst } from "../werk";
import { mapVan } from "./Logboeken";

type Tab = "systeem" | "logboeken" | "zwembaden" | "fietsen" | "huisstijl" | "kennisbot" | "beta";

// ── Gedeelde hulpcomponent ─────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-paper-raised rounded-2xl shadow p-5 space-y-4">
      <h2 className="font-bold text-base">{title}</h2>
      {children}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// SYSTEEM
// ══════════════════════════════════════════════════════════════════════════════

function IntegratieWidget() {
  const [status, setStatus] = useState<IntegrationStatus | null>(null);
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    integrationApi.status().then((r) => setStatus(r.data)).catch(() => {});
  }, []);

  async function install() {
    setInstalling(true);
    setMessage(null);
    try {
      const r = await integrationApi.install();
      setMessage({ type: "ok", text: r.data.message });
      const s = await integrationApi.status();
      setStatus(s.data);
    } catch {
      setMessage({ type: "err", text: "Installatie mislukt. Controleer de addon-logs." });
    } finally {
      setInstalling(false);
    }
  }

  if (!status) return null;
  const isUpToDate = status.installed && !status.update_available;

  return (
    <Section title="HA Integratie">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-70">
          Versie addon: <span className="font-mono font-medium">{status.bundled_version}</span>
          {status.installed && (
            <> · geïnstalleerd: <span className="font-mono font-medium">{status.installed_version}</span></>
          )}
        </p>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
          isUpToDate ? "bg-done-soft text-done" :
          status.installed ? "bg-high-soft text-high" : "bg-urgent-soft text-urgent"
        }`}>
          {isUpToDate ? "Geïnstalleerd" : status.installed ? "Update beschikbaar" : "Niet geïnstalleerd"}
        </span>
      </div>
      {message && (
        <div className={`text-sm rounded-lg px-3 py-2 ${message.type === "ok" ? "bg-done-soft text-done" : "bg-urgent-soft text-urgent"}`}>
          {message.text}
          {message.type === "ok" && <p className="mt-1 font-medium">Herstart Home Assistant via Instellingen → Systeem → Herstarten.</p>}
        </div>
      )}
      {!isUpToDate && (
        <button onClick={install} disabled={installing} className="bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 w-full">
          {installing ? "Bezig..." : status.installed ? `Bijwerken naar ${status.bundled_version}` : "Integratie installeren"}
        </button>
      )}
    </Section>
  );
}

function NotificatieInstellingen() {
  const [baseUrl, setBaseUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    systemSettingsApi.get().then((r) => setBaseUrl(r.data.ticket_base_url)).catch(() => {});
  }, []);

  async function save() {
    setSaving(true); setSaved(false);
    try {
      const r = await systemSettingsApi.update({ ticket_base_url: baseUrl });
      setBaseUrl(r.data.ticket_base_url);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  }

  return (
    <Section title="Notificatie-instellingen">
      <div>
        <label className="block text-sm font-medium text-ink-70 mb-1">Basis-URL voor notificatielinks</label>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand"
          placeholder="/hassio/ingress/hotel_tickets"
        />
        <p className="text-xs text-ink-45 mt-1">Standaard: <code>/hassio/ingress/hotel_tickets</code></p>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
          {saving ? "Opslaan..." : "Opslaan"}
        </button>
        {saved && <span className="text-sm text-done">✓ Opgeslagen</span>}
      </div>
    </Section>
  );
}

const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin", supervisor: "Supervisor", employee: "Medewerker",
};
const DEPT_LABELS: Record<Category, string> = {
  technical: "TD", housekeeping: "Huishouding", reception: "Receptie",
  service: "Bediening", kitchen: "Keuken", sales: "Sales", garden: "Tuin",
};
const MODULE_KEUZES = [
  { id: "taken", label: "Taken" },
  { id: "zwembaden", label: "Zwembaden" },
  { id: "fietsen", label: "Fietsen" },
  { id: "kennis", label: "Kennisbot" },
];

const DEPT_FULL_LABELS: Record<Category, string> = {
  technical: "Technische dienst", housekeeping: "Huishouding", reception: "Receptie",
  service: "Bediening", kitchen: "Keuken", sales: "Sales", garden: "Tuin",
};

// Haal de leesbare foutmelding uit een API-fout (FastAPI zet die in detail)
function apiErrorText(err: unknown, fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return typeof detail === "string" ? detail : fallback;
}

function sessieGeleden(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - parseUTC(iso).getTime()) / 1000));
  if (secs < 60) return "zojuist";
  if (secs < 3600) return `${Math.floor(secs / 60)} min geleden`;
  if (secs < 86400) return `${Math.floor(secs / 3600)} uur geleden`;
  return `${Math.floor(secs / 86400)} d geleden`;
}

function ActieveSessiesPanel() {
  const [sessions, setSessions] = useState<Session[] | null>(null);

  useEffect(() => {
    sessionsApi.listAll().then((r) => setSessions(r.data)).catch(() => setSessions([]));
  }, []);

  async function revoke(id: string) {
    await sessionsApi.revoke(id);
    setSessions((prev) => (prev ?? []).filter((s) => s.id !== id));
  }

  if (!sessions) return null;

  return (
    <Section title="Actieve sessies — apparaten">
      <p className="text-xs text-ink-45">
        Alle apparaten die nu via de loginpagina zijn ingelogd. Een sessie schuift mee zolang hij
        gebruikt wordt en verloopt vanzelf bij inactiviteit. Log een apparaat op afstand uit bij een
        verloren of gestolen telefoon — dat toestel moet daarna opnieuw inloggen.
      </p>
      {sessions.length === 0 ? (
        <p className="text-sm text-ink-45">Geen actieve sessies via de loginpagina.</p>
      ) : (
        <div className="divide-y divide-ink-6">
          {sessions.map((s) => (
            <div key={s.id} className="py-2 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ink truncate">
                  {s.display_name || "Onbekend"}
                  {s.current && (
                    <span className="ml-2 text-xs bg-done-soft text-done px-2 py-0.5 rounded-full font-medium">
                      Dit apparaat
                    </span>
                  )}
                </p>
                <p className="text-xs text-ink-45 truncate">
                  {s.device}
                  {s.ip ? ` · ${s.ip}` : ""} · actief {sessieGeleden(s.last_seen_at)}
                </p>
              </div>
              <button
                onClick={() => revoke(s.id)}
                className="text-sm text-urgent hover:underline shrink-0"
              >
                Uitloggen
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function BeveiligingPanel() {
  const [bans, setBans] = useState<LoginBan[] | null>(null);

  useEffect(() => {
    authApi.listBans().then((r) => setBans(r.data)).catch(() => {});
  }, []);

  async function removeBan(ip: string) {
    await authApi.removeBan(ip);
    setBans((prev) => (prev ?? []).filter((b) => b.ip !== ip));
  }

  if (!bans) return null;

  return (
    <Section title="Beveiliging — loginpagina">
      <p className="text-xs text-ink-45">
        Een IP-adres wordt na 25 mislukte inlogpogingen permanent geblokkeerd (je krijgt
        daarvan een pushmelding). Hier hef je blokkades op en zie je lopende tellers.
      </p>
      {bans.length === 0 ? (
        <p className="text-sm text-ink-45">Geen mislukte inlogpogingen geregistreerd.</p>
      ) : (
        <div className="divide-y divide-ink-6">
          {bans.map((b) => (
            <div key={b.ip} className="py-2 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-mono text-sm">{b.ip}</p>
                <p className="text-xs text-ink-45">
                  {b.failed_count} mislukte poging{b.failed_count === 1 ? "" : "en"}
                  {b.last_username && <> · laatste gebruikersnaam: <span className="font-mono">{b.last_username}</span></>}
                  {" · "}{new Date(b.last_attempt_at).toLocaleString("nl-NL")}
                </p>
              </div>
              {b.banned && <span className="text-xs bg-urgent-soft text-urgent px-2 py-0.5 rounded-full font-medium">Geblokkeerd</span>}
              <button onClick={() => removeBan(b.ip)} className="text-sm text-brand hover:underline shrink-0">
                {b.banned ? "Blokkade opheffen" : "Teller wissen"}
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function MedewerkersBeheer({ isAdmin }: { isAdmin: boolean }) {
  const [users, setUsers] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<UserRole> & { extra_departments?: Category[] }>({});
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ ha_user_id: "", display_name: "", ha_username: "", password: "", role: "employee" as Role, department: "" as Category | "", email: "", ha_notify_service: "", ha_device_tracker: "", notify_new_ticket: false, notify_direct_message: false });
  // Foutmeldingen nooit stil inslikken — toon ze in de betreffende sectie
  const [newError, setNewError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    userApi.list().then((r) => setUsers(r.data)).finally(() => setLoading(false));
  }, []);

  async function saveEdit(userId: string) {
    setListError(null);
    try {
      const r = await userApi.update(userId, editForm);
      setUsers((prev) => prev.map((u) => u.ha_user_id === userId ? r.data : u));
      setEditing(null);
    } catch (err) {
      setListError(apiErrorText(err, "Opslaan mislukt — probeer het opnieuw"));
    }
  }

  async function deleteUser(userId: string) {
    setListError(null);
    try {
      await userApi.remove(userId);
      setUsers((prev) => prev.filter((u) => u.ha_user_id !== userId));
    } catch (err) {
      setListError(apiErrorText(err, "Verwijderen mislukt — probeer het opnieuw"));
    }
  }

  async function resetPassword(u: UserRole) {
    const pw = prompt(`Nieuw wachtwoord voor ${u.display_name} (minimaal 8 tekens):`);
    if (!pw) return;
    setListError(null);
    try {
      const r = await userApi.setPassword(u.ha_user_id, pw);
      setUsers((prev) => prev.map((x) => x.ha_user_id === u.ha_user_id ? r.data : x));
      alert(`Wachtwoord ingesteld. ${u.display_name} kan nu op de loginpagina inloggen met gebruikersnaam "${r.data.ha_username}".`);
    } catch (err) {
      setListError(apiErrorText(err, "Wachtwoord instellen mislukt"));
    }
  }

  async function createUser() {
    setNewError(null);
    try {
      const r = await userApi.create({
        display_name: newForm.display_name,
        role: newForm.role,
        department: newForm.department === "" ? null : newForm.department,
        // Lege velden weglaten: zonder ha_user_id + mét wachtwoord maakt de
        // backend een lokaal app-account aan (inloggen zonder HA-account)
        ha_user_id: newForm.ha_user_id.trim() || undefined,
        ha_username: newForm.ha_username.trim() || undefined,
        password: newForm.password || undefined,
        email: newForm.email || undefined,
        ha_notify_service: newForm.ha_notify_service || undefined,
        ha_device_tracker: newForm.ha_device_tracker || undefined,
        notify_new_ticket: newForm.notify_new_ticket,
        notify_direct_message: newForm.notify_direct_message,
        notify_push: true,
        notify_email: !!newForm.email,
      });
      setUsers((prev) => [...prev, r.data]);
      setNewForm({ ha_user_id: "", display_name: "", ha_username: "", password: "", role: "employee", department: "", email: "", ha_notify_service: "", ha_device_tracker: "", notify_new_ticket: false, notify_direct_message: false });
      setShowNew(false);
    } catch (err) {
      setNewError(apiErrorText(err, "Aanmaken mislukt — controleer de invoer"));
    }
  }

  return (
    <Section title="Medewerkers & rollen">
      <div className="flex justify-end">
        {isAdmin && <button onClick={() => setShowNew(true)} className="bg-brand text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:opacity-90">+ Toevoegen</button>}
      </div>

      {showNew && (
        <div className="bg-ink-6 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold">Nieuwe medewerker</h3>
          <div className="grid grid-cols-2 gap-2">
            <input placeholder="Naam" value={newForm.display_name}
              onChange={(e) => setNewForm({ ...newForm, display_name: e.target.value })}
              className="border rounded px-2 py-1 text-sm" />
            <input placeholder="Inlognaam (gebruikersnaam)" value={newForm.ha_username}
              onChange={(e) => setNewForm({ ...newForm, ha_username: e.target.value })}
              autoCapitalize="none" autoCorrect="off"
              className="border rounded px-2 py-1 text-sm font-mono" />
            <input placeholder="Wachtwoord (min. 8 tekens)" type="password" value={newForm.password}
              onChange={(e) => setNewForm({ ...newForm, password: e.target.value })}
              autoComplete="new-password"
              className="border rounded px-2 py-1 text-sm" />
            <input placeholder="HA user_id (alleen bij HA-account)" value={newForm.ha_user_id}
              onChange={(e) => setNewForm({ ...newForm, ha_user_id: e.target.value })}
              className="border rounded px-2 py-1 text-sm font-mono" />
            <select value={newForm.role} onChange={(e) => setNewForm({ ...newForm, role: e.target.value as Role })}
              className="border rounded px-2 py-1 text-sm bg-paper-raised">
              {(Object.keys(ROLE_LABELS) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
            <select value={newForm.department} onChange={(e) => setNewForm({ ...newForm, department: e.target.value as Category | "" })}
              className="border rounded px-2 py-1 text-sm bg-paper-raised">
              <option value="">— Afdeling kiezen —</option>
              {(Object.keys(DEPT_FULL_LABELS) as Category[]).map((d) => <option key={d} value={d}>{DEPT_FULL_LABELS[d]}</option>)}
            </select>
            <input placeholder="E-mail (optioneel)" value={newForm.email}
              onChange={(e) => setNewForm({ ...newForm, email: e.target.value })}
              className="border rounded px-2 py-1 text-sm" />
            <input placeholder="HA notify service" value={newForm.ha_notify_service}
              onChange={(e) => setNewForm({ ...newForm, ha_notify_service: e.target.value })}
              className="col-span-2 border rounded px-2 py-1 text-sm" />
            <input placeholder="HA device_tracker (bijv. device_tracker.iphone_dennis)" value={newForm.ha_device_tracker}
              onChange={(e) => setNewForm({ ...newForm, ha_device_tracker: e.target.value })}
              className="col-span-2 border rounded px-2 py-1 text-sm font-mono" />
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={newForm.notify_new_ticket}
                onChange={(e) => setNewForm({ ...newForm, notify_new_ticket: e.target.checked })} />
              <span>Push bij elk nieuw ticket in mijn afdeling{newForm.ha_device_tracker ? " (alleen op wifi)" : ""}</span>
            </label>
            <label className="col-span-2 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={newForm.notify_direct_message}
                onChange={(e) => setNewForm({ ...newForm, notify_direct_message: e.target.checked })} />
              <span>Push bij een nieuw direct bericht van een collega</span>
            </label>
          </div>
          <p className="text-xs text-ink-45">
            Met een inlognaam + wachtwoord maak je een <strong>app-account</strong> aan: de medewerker
            logt in op de loginpagina zonder Home Assistant-account. Laat het wachtwoord leeg en vul
            een HA user_id in om een bestaande HA-gebruiker te koppelen.
          </p>
          {newError && <p className="text-sm text-urgent bg-urgent-soft rounded px-2 py-1">{newError}</p>}
          <div className="flex gap-2">
            <button onClick={createUser} className="bg-brand text-white px-3 py-1.5 rounded-lg text-sm">Opslaan</button>
            <button onClick={() => { setShowNew(false); setNewError(null); }} className="border px-3 py-1.5 rounded-lg text-sm text-ink-70">Annuleren</button>
          </div>
        </div>
      )}

      {listError && <p className="text-sm text-urgent bg-urgent-soft rounded px-2 py-1">{listError}</p>}

      {loading ? <p className="text-ink-45 text-sm">Laden...</p> : (
        <div className="divide-y divide-ink-6">
          {users.map((user) => (
            <div key={user.ha_user_id} className="py-3">
              {editing === user.ha_user_id ? (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <input value={editForm.display_name || ""}
                      onChange={(e) => setEditForm({ ...editForm, display_name: e.target.value })}
                      placeholder="Naam" className="border rounded px-2 py-1 text-sm" />
                    {isAdmin ? (
                      <select value={editForm.role || user.role}
                        onChange={(e) => setEditForm({ ...editForm, role: e.target.value as Role })}
                        className="border rounded px-2 py-1 text-sm bg-paper-raised">
                        {(Object.keys(ROLE_LABELS) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                    ) : (
                      <span className="border rounded px-2 py-1 text-sm bg-ink-6 text-ink-45">{ROLE_LABELS[user.role]}</span>
                    )}
                    {isAdmin ? (
                      <select value={editForm.department ?? user.department ?? ""}
                        onChange={(e) => setEditForm({ ...editForm, department: (e.target.value || null) as Category | null })}
                        className="border rounded px-2 py-1 text-sm bg-paper-raised">
                        <option value="">— Geen afdeling —</option>
                        {(Object.keys(DEPT_FULL_LABELS) as Category[]).map((d) => <option key={d} value={d}>{DEPT_FULL_LABELS[d]}</option>)}
                      </select>
                    ) : (
                      <span className="border rounded px-2 py-1 text-sm bg-ink-6 text-ink-45">
                        {user.department ? DEPT_FULL_LABELS[user.department] : "Geen afdeling"}
                      </span>
                    )}
                    <input value={editForm.email || ""} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                      placeholder="E-mail" className="border rounded px-2 py-1 text-sm" />
                    <input value={editForm.ha_notify_service || ""} onChange={(e) => setEditForm({ ...editForm, ha_notify_service: e.target.value })}
                      placeholder="Notify service" className="border rounded px-2 py-1 text-sm" />
                    <input value={editForm.ha_device_tracker || ""} onChange={(e) => setEditForm({ ...editForm, ha_device_tracker: e.target.value })}
                      placeholder="device_tracker entity (optioneel)" className="col-span-2 border rounded px-2 py-1 text-sm font-mono" />
                    {isAdmin && (
                      <input value={editForm.ha_username || ""} onChange={(e) => setEditForm({ ...editForm, ha_username: e.target.value })}
                        placeholder="HA gebruikersnaam (voor loginpagina)" className="col-span-2 border rounded px-2 py-1 text-sm font-mono" />
                    )}
                    <label className="col-span-2 flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={!!editForm.notify_new_ticket}
                        onChange={(e) => setEditForm({ ...editForm, notify_new_ticket: e.target.checked })} />
                      <span>Push bij elk nieuw ticket in mijn afdeling{editForm.ha_device_tracker ? " (alleen op wifi)" : ""}</span>
                    </label>
                    <label className="col-span-2 flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={!!editForm.notify_direct_message}
                        onChange={(e) => setEditForm({ ...editForm, notify_direct_message: e.target.checked })} />
                      <span>Push bij een nieuw direct bericht van een collega</span>
                    </label>
                  </div>

                  {/* Uitzonderingen — inrichtingswerk, dus alleen voor admins en
                      alleen op een groot scherm. */}
                  {isAdmin && (
                    <div className="hidden md:block space-y-3 rounded-[10px] border border-ink-12 p-3">
                      <p className="font-mono text-xs uppercase tracking-[0.14em] text-ink-45">
                        Uitzonderingen
                      </p>

                      <div>
                        <p className="text-sm font-medium text-ink">Extra afdelingen</p>
                        <p className="meta mb-1.5">Waarin deze medewerker óók tickets mag pakken en wijzigen</p>
                        <div className="flex flex-wrap gap-1.5">
                          {(Object.keys(DEPT_FULL_LABELS) as Category[])
                            .filter((d) => d !== (editForm.department ?? user.department))
                            .map((d) => {
                              const aan = (editForm.extra_departments ?? []).includes(d);
                              return (
                                <button
                                  key={d}
                                  type="button"
                                  onClick={() => setEditForm({
                                    ...editForm,
                                    extra_departments: aan
                                      ? (editForm.extra_departments ?? []).filter((x) => x !== d)
                                      : [...(editForm.extra_departments ?? []), d],
                                  })}
                                  className={`h-9 px-3 rounded-full text-meta transition-colors ${
                                    aan ? "bg-ink text-paper font-semibold" : "border border-ink-12 text-ink-70"
                                  }`}
                                >
                                  {DEPT_FULL_LABELS[d]}
                                </button>
                              );
                            })}
                        </div>
                      </div>

                      <div>
                        <p className="text-sm font-medium text-ink">Modules</p>
                        <p className="meta mb-1.5">Wat er in het Meer-scherm staat. Niets aangevinkt = alles.</p>
                        <div className="flex flex-wrap gap-1.5">
                          {MODULE_KEUZES.map((m) => {
                            const aan = (editForm.modules ?? []).includes(m.id);
                            return (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => setEditForm({
                                  ...editForm,
                                  modules: aan
                                    ? (editForm.modules ?? []).filter((x) => x !== m.id)
                                    : [...(editForm.modules ?? []), m.id],
                                })}
                                className={`h-9 px-3 rounded-full text-meta transition-colors ${
                                  aan ? "bg-ink text-paper font-semibold" : "border border-ink-12 text-ink-70"
                                }`}
                              >
                                {m.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <p className="text-sm font-medium text-ink">Rapportage</p>
                        <select
                          value={editForm.can_reports === undefined || editForm.can_reports === null ? "auto" : editForm.can_reports ? "aan" : "uit"}
                          onChange={(e) => setEditForm({
                            ...editForm,
                            can_reports: e.target.value === "auto" ? null : e.target.value === "aan",
                          })}
                          className="mt-1 h-tap rounded-[10px] border border-ink-12 px-2 text-meta bg-paper-raised"
                        >
                          <option value="auto">Volgt de rol</option>
                          <option value="aan">Altijd toegang</option>
                          <option value="uit">Nooit toegang</option>
                        </select>
                      </div>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button onClick={() => saveEdit(user.ha_user_id)} className="bg-brand text-white px-3 py-1.5 rounded-lg text-sm">Opslaan</button>
                    <button onClick={() => setEditing(null)} className="border px-3 py-1.5 rounded-lg text-sm text-ink-70">Annuleren</button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm">{user.display_name}</p>
                    <p className="text-xs text-ink-45 break-all">{user.ha_user_id}{user.ha_username ? ` · login: ${user.ha_username}` : ""}</p>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      <span className="text-xs bg-ink-6 text-brand px-2 py-0.5 rounded-full font-medium">{ROLE_LABELS[user.role]}</span>
                      {(user.departments?.length ? user.departments : user.department ? [user.department] : []).map((d) => (
                        <span key={d} className="text-xs bg-ink-6 text-ink-70 px-2 py-0.5 rounded-full">{DEPT_LABELS[d]}</span>
                      ))}
                      {user.modules?.length ? (
                        <span className="text-xs bg-ink-6 text-ink-70 px-2 py-0.5 rounded-full">
                          {user.modules.length} modules
                        </span>
                      ) : null}
                      {user.can_reports != null && (
                        <span className="text-xs bg-ink-6 text-ink-70 px-2 py-0.5 rounded-full">
                          rapportage {user.can_reports ? "aan" : "uit"}
                        </span>
                      )}
                      {user.has_password && <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full font-medium">App-account</span>}
                    </div>
                  </div>
                  <div className="flex gap-3 text-sm shrink-0">
                    <button
                      onClick={() => {
                        setEditing(user.ha_user_id);
                        setEditForm({
                          ...user,
                          extra_departments: (user.departments ?? []).filter((d) => d !== user.department),
                        });
                      }}
                      className="text-brand hover:underline"
                    >
                      Bewerken
                    </button>
                    {isAdmin && (
                      <button onClick={() => resetPassword(user)} className="text-purple-600 hover:underline">
                        {user.has_password ? "Wachtwoord resetten" : "Wachtwoord instellen"}
                      </button>
                    )}
                    {isAdmin && <BevestigKnop label={"Verwijderen"} vraag="Gebruiker verwijderen?" bevestigLabel="Ja, verwijder" onBevestig={() => deleteUser(user.ha_user_id)} className="text-urgent hover:underline" />}
                  </div>
                </div>
              )}
            </div>
          ))}
          {users.length === 0 && <p className="py-4 text-center text-ink-45 text-sm italic">Nog geen medewerkers</p>}
        </div>
      )}
    </Section>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ZWEMBADEN
// ══════════════════════════════════════════════════════════════════════════════

function ZwembadConfigPanel() {
  const [configs, setConfigs] = useState<PoolConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editValues, setEditValues] = useState<Record<string, Partial<PoolConfigItem>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [templates, setTemplates] = useState<RecurringTemplate[]>([]);

  useEffect(() => {
    poolApi.getConfigs().then((r) => {
      setConfigs(r.data);
      const vals: Record<string, Partial<PoolConfigItem>> = {};
      for (const c of r.data) vals[c.pool_id] = { ...c };
      setEditValues(vals);
    }).finally(() => setLoading(false));
    recurringApi.list().then((r) => setTemplates(r.data)).catch(() => {});
  }, []);

  function setField(poolId: string, key: string, val: string) {
    setEditValues((v) => ({ ...v, [poolId]: { ...v[poolId], [key]: val || null } }));
  }

  function TemplateSelect({ poolId, field, value }: { poolId: string; field: keyof PoolConfigItem; value: string | null | undefined }) {
    return (
      <select
        value={value ?? ""}
        onChange={(e) => setField(poolId, field as string, e.target.value)}
        className="w-full mt-1 border rounded-lg px-3 py-2 text-sm bg-paper-raised focus:outline-none focus:ring-2 focus:ring-brand"
      >
        <option value="">— Geen herhalende taak gekoppeld —</option>
        {templates
          .filter((t) => t.is_active)
          .map((t) => (
            <option key={t.id} value={t.id}>{t.title}</option>
          ))}
      </select>
    );
  }

  async function handleSave(poolId: string) {
    setSaving(poolId); setSuccess(null);
    try {
      const res = await poolApi.updateConfig(poolId, editValues[poolId]);
      setConfigs((prev) => prev.map((c) => c.pool_id === poolId ? res.data : c));
      setSuccess(poolId);
      setTimeout(() => setSuccess((s) => s === poolId ? null : s), 3000);
    } finally { setSaving(null); }
  }

  if (loading) return <p className="text-ink-45 text-sm">Laden...</p>;

  return (
    <>
      {configs.map((cfg) => {
        const vals = editValues[cfg.pool_id] || {};
        const isZwembad = cfg.pool_id === "zwembad";
        return (
          <Section key={cfg.pool_id} title={`${cfg.label} — configuratie`}>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-ink-70 mb-1">Naam</label>
                <input type="text" value={vals.label ?? ""} onChange={(e) => setField(cfg.pool_id, "label", e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-70 mb-1">
                  {isZwembad ? "NFC tag ID — filter links" : "NFC tag ID — filter"}
                </label>
                <input type="text" value={vals.filter_nfc_tag_id ?? ""} placeholder="bijv. 04:A2:F3:1A:..."
                  onChange={(e) => setField(cfg.pool_id, "filter_nfc_tag_id", e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand" />
                <TemplateSelect poolId={cfg.pool_id} field="filter_template_id" value={vals.filter_template_id} />
              </div>
              {isZwembad && (
                <div>
                  <label className="block text-sm font-medium text-ink-70 mb-1">NFC tag ID — filter rechts</label>
                  <input type="text" value={vals.filter_nfc_tag_id_r ?? ""} placeholder="bijv. 04:B7:E1:2C:..."
                    onChange={(e) => setField(cfg.pool_id, "filter_nfc_tag_id_r", e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand" />
                  <TemplateSelect poolId={cfg.pool_id} field="filter_template_id_r" value={vals.filter_template_id_r} />
                </div>
              )}
              <div className="pt-3 mt-1 border-t border-ink-6">
                <p className="text-xs font-semibold text-ink-45 uppercase tracking-wide mb-2">Chemicaliën</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-70 mb-1">NFC tag ID — Chloor tank vervangen</label>
                <input type="text" value={vals.chloor_nfc_tag_id ?? ""} placeholder="bijv. 04:C8:D2:3E:..."
                  onChange={(e) => setField(cfg.pool_id, "chloor_nfc_tag_id", e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand" />
                <TemplateSelect poolId={cfg.pool_id} field="chloor_template_id" value={vals.chloor_template_id} />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-70 mb-1">NFC tag ID — Zuur tank vervangen</label>
                <input type="text" value={vals.zuur_nfc_tag_id ?? ""} placeholder="bijv. 04:D9:E3:4F:..."
                  onChange={(e) => setField(cfg.pool_id, "zuur_nfc_tag_id", e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand" />
                <TemplateSelect poolId={cfg.pool_id} field="zuur_template_id" value={vals.zuur_template_id} />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-70 mb-1">NFC tag ID — Vlokmiddel bijgevuld</label>
                <input type="text" value={vals.vlokmiddel_nfc_tag_id ?? ""} placeholder="bijv. 04:EA:F4:50:..."
                  onChange={(e) => setField(cfg.pool_id, "vlokmiddel_nfc_tag_id", e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-brand" />
                <TemplateSelect poolId={cfg.pool_id} field="vlokmiddel_template_id" value={vals.vlokmiddel_template_id} />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => handleSave(cfg.pool_id)} disabled={saving === cfg.pool_id}
                className="bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
                {saving === cfg.pool_id ? "Opslaan..." : "Opslaan"}
              </button>
              {success === cfg.pool_id && <span className="text-sm text-done">✓ Opgeslagen</span>}
            </div>
          </Section>
        );
      })}
    </>
  );
}

function ZwembadImportPanel() {
  const [poolId, setPoolId] = useState("wellness");
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleImport() {
    if (!file) return;
    setImporting(true); setResult(null);
    try {
      const res = await poolApi.importCsv(file, poolId);
      const { imported, skipped } = res.data;
      setResult(`${imported} metingen geïmporteerd${skipped > 0 ? `, ${skipped} duplicaten overgeslagen` : ""}.`);
    } catch {
      setResult("Import mislukt — controleer het CSV-formaat.");
    }
    setImporting(false);
  }

  return (
    <Section title="CSV importeren">
      <p className="text-sm text-ink-45">Importeer historische metingen uit een CSV-bestand (;-gescheiden). Duplicaten worden overgeslagen.</p>
      <div className="flex gap-3 items-end flex-wrap">
        <div>
          <label className="block text-sm font-medium text-ink-70 mb-1">Bad</label>
          <select value={poolId} onChange={(e) => setPoolId(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
            <option value="wellness">Wellness</option>
            <option value="zwembad">Zwembad</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-ink-70 mb-1">CSV-bestand</label>
          <input type="file" accept=".csv,.txt" className="text-sm" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </div>
        <button onClick={handleImport} disabled={!file || importing}
          className="bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
          {importing ? "Importeren..." : "Importeren"}
        </button>
      </div>
      {result && <p className={`text-sm ${result.includes("mislukt") ? "text-urgent" : "text-done"}`}>{result}</p>}
    </Section>
  );
}

function ZwembadResetPanel() {
  const [poolId, setPoolId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleReset() {
    setDeleting(true); setResult(null);
    try {
      const res = await poolApi.resetLogs(poolId || undefined);
      setResult(`${res.data.deleted} metingen verwijderd.`);
      setConfirming(false);
    } catch { setResult("Reset mislukt."); }
    setDeleting(false);
  }

  return (
    <div className="bg-paper-raised rounded-2xl shadow p-5 border border-urgent space-y-4">
      <h2 className="font-bold text-base text-urgent">Logboek resetten</h2>
      <p className="text-sm text-ink-45">Verwijder alle metingen uit het logboek. Dit kan niet ongedaan gemaakt worden.</p>
      <div className="flex gap-3 items-end flex-wrap">
        <div>
          <label className="block text-sm font-medium text-ink-70 mb-1">Bad</label>
          <select value={poolId} onChange={(e) => { setPoolId(e.target.value); setConfirming(false); }} className="border rounded-lg px-3 py-2 text-sm">
            <option value="">Alle baden</option>
            <option value="wellness">Wellness</option>
            <option value="zwembad">Zwembad</option>
          </select>
        </div>
        {!confirming ? (
          <button onClick={() => setConfirming(true)} className="bg-urgent text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-urgent">Resetten</button>
        ) : (
          <div className="flex gap-2 items-center">
            <span className="text-urgent text-sm font-medium">Weet je het zeker?</span>
            <button onClick={handleReset} disabled={deleting} className="bg-urgent text-white px-4 py-2 rounded-lg text-sm hover:bg-urgent disabled:opacity-50">
              {deleting ? "Verwijderen..." : "Ja, verwijder alles"}
            </button>
            <button onClick={() => setConfirming(false)} className="border px-4 py-2 rounded-lg text-sm hover:bg-ink-6">Annuleren</button>
          </div>
        )}
      </div>
      {result && <p className={`text-sm ${result.includes("mislukt") ? "text-urgent" : "text-high"}`}>{result}</p>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// FIETSEN
// ══════════════════════════════════════════════════════════════════════════════

const BIKES_ROLES_OPTIONS: { value: BikesModuleRoles; label: string; description: string }[] = [
  { value: "all", label: "Iedereen", description: "Alle ingelogde medewerkers zien de fietsenmodule." },
  { value: "reception", label: "Receptie + leidinggevenden", description: "Alleen receptie, supervisors en admins hebben toegang." },
  { value: "admin_supervisor", label: "Alleen leidinggevenden", description: "Alleen supervisors en admins." },
];

function FietsenZichtbaarheidPanel() {
  const [currentRoles, setCurrentRoles] = useState<BikesModuleRoles>("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    bikesModuleApi.getSetting().then((r) => setCurrentRoles(r.data.bikes_module_roles)).finally(() => setLoading(false));
  }, []);

  async function save(value: BikesModuleRoles) {
    setSaving(true); setSaved(false);
    try {
      const r = await bikesModuleApi.updateSetting(value);
      setCurrentRoles(r.data.bikes_module_roles);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally { setSaving(false); }
  }

  if (loading) return <p className="text-ink-45 text-sm">Laden...</p>;

  return (
    <Section title="Module-zichtbaarheid">
      <p className="text-sm text-ink-45">Bepaal welke medewerkers de fietsenmodule in het menu kunnen zien.</p>
      <div className="space-y-2">
        {BIKES_ROLES_OPTIONS.map((opt) => (
          <label key={opt.value} className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
            currentRoles === opt.value ? "border-blue-500 bg-ink-6" : "border-ink-12 hover:border-ink-12"
          }`}>
            <input type="radio" name="bikes_roles" value={opt.value} checked={currentRoles === opt.value}
              onChange={() => save(opt.value)} disabled={saving} className="mt-0.5 accent-blue-600" />
            <div>
              <p className="font-medium text-sm">{opt.label}</p>
              <p className="text-xs text-ink-45">{opt.description}</p>
            </div>
          </label>
        ))}
      </div>
      {saving && <p className="text-sm text-ink-45">Opslaan...</p>}
      {saved && <p className="text-sm text-done">✓ Opgeslagen</p>}
    </Section>
  );
}

function FietsenExcelPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    ok: boolean; imported: number; skipped: number;
    skipped_duplicates: number; skipped_no_bike: number;
    bikes_created: number; errors: string[];
  } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true); setImportResult(null); setImportError(null);
    try {
      const r = await bikeAdminApi.importExcel(file);
      setImportResult(r.data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setImportError(msg || "Import mislukt");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleExport() {
    setExporting(true);
    try {
      await bikeAdminApi.exportExcel();
    } catch {
      setImportError("Export mislukt");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Section title="Excel import & export">
      <div className="space-y-4">
        {/* Import */}
        <div>
          <p className="text-sm font-medium text-ink-70 mb-1">Importeren</p>
          <p className="text-sm text-ink-45 mb-3">
            Upload een Excel-bestand in het Fietsverhuur-formaat. Bestaande reserveringen (zelfde fiets + datums)
            worden automatisch overgeslagen — je kunt het bestand meerdere keren uploaden.
          </p>
          <div className="flex flex-wrap gap-3 items-center">
            <input ref={fileInputRef} type="file" accept=".xlsx" onChange={handleUpload} className="hidden" id="excel-upload" />
            <label
              htmlFor="excel-upload"
              className={`cursor-pointer bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-colors ${importing ? "opacity-50 pointer-events-none" : ""}`}
            >
              {importing ? "Importeren..." : "📂 Excel uploaden"}
            </label>
          </div>
          {importResult && (
            <div className="mt-3 bg-done-soft rounded-lg p-3 text-sm text-done space-y-1">
              <p>✓ <strong>{importResult.imported}</strong> reserveringen geïmporteerd.</p>
              {importResult.bikes_created > 0 && (
                <p className="text-xs text-brand">
                  🚲 {importResult.bikes_created} nieuwe fiets{importResult.bikes_created !== 1 ? "en" : ""} aangemaakt vanuit de Excel.
                </p>
              )}
              {importResult.skipped_duplicates > 0 && (
                <p className="text-xs text-ink-45">
                  {importResult.skipped_duplicates} duplicaten overgeslagen.
                </p>
              )}
              {importResult.errors.length > 0 && (
                <ul className="mt-1 text-xs text-high space-y-0.5">
                  {importResult.errors.map((e, i) => <li key={i}>⚠ {e}</li>)}
                </ul>
              )}
            </div>
          )}
          {importError && <p className="mt-2 text-sm text-urgent">{importError}</p>}
        </div>

        {/* Divider */}
        <div className="border-t border-ink-6 pt-4">
          <p className="text-sm font-medium text-ink-70 mb-1">Exporteren</p>
          <p className="text-sm text-ink-45 mb-3">
            Download alle reserveringen (verleden + toekomst) als Excel-bestand.
          </p>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {exporting ? "Exporteren..." : "⬇ Exporteren als Excel"}
          </button>
        </div>
      </div>
    </Section>
  );
}

function FietsenResetPanel() {
  const [confirming, setConfirming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleReset() {
    setResetting(true);
    setResult(null);
    try {
      const res = await bikeAdminApi.resetDatabase();
      setResult({ ok: true, text: res.data.message });
      setConfirming(false);
    } catch {
      setResult({ ok: false, text: "Reset mislukt. Probeer het opnieuw." });
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="bg-paper-raised rounded-2xl shadow p-5 border border-urgent space-y-4">
      <h2 className="font-bold text-base text-urgent">Database resetten</h2>
      <p className="text-sm text-ink-45">
        Verwijdert <strong>alle</strong> fietsdata: reserveringen, fietsen en fietstypes.
        Dit kan <strong>niet</strong> ongedaan worden gemaakt.
      </p>
      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="bg-urgent text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-urgent"
        >
          🗑 Database resetten
        </button>
      ) : (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-urgent text-sm font-medium">Weet je het zeker? Dit verwijdert alles.</span>
          <button
            onClick={handleReset}
            disabled={resetting}
            className="bg-urgent text-white px-4 py-2 rounded-lg text-sm hover:bg-urgent disabled:opacity-50"
          >
            {resetting ? "Verwijderen..." : "Ja, alles verwijderen"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="border px-4 py-2 rounded-lg text-sm hover:bg-ink-6"
          >
            Annuleren
          </button>
        </div>
      )}
      {result && (
        <p className={`text-sm ${result.ok ? "text-high" : "text-urgent"}`}>
          {result.ok ? "✓ " : "✗ "}{result.text}
        </p>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// HUISSTIJL
// ══════════════════════════════════════════════════════════════════════════════

function ColorRow({
  label, value, onChange,
}: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-sm text-ink-70 w-32 shrink-0">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-9 h-9 rounded cursor-pointer border border-ink-12 shrink-0"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border rounded-lg px-3 py-1.5 text-sm font-mono w-28 focus:outline-none focus:ring-2 focus:ring-brand"
      />
      <div className="flex-1 h-9 rounded-lg border border-ink-12" style={{ backgroundColor: value }} />
    </div>
  );
}

function HuisstijlPanel() {
  const [brandColor, setBrandColor] = useState("#1e3a5f");
  const [btnColor, setBtnColor] = useState("#2563eb");
  const [bgColor, setBgColor] = useState("#f9fafb");
  const [bgImage, setBgImage] = useState<string | null>(null);
  const [logo, setLogo] = useState<string | null>(null);

  const [savingColors, setSavingColors] = useState(false);
  const [savedColors, setSavedColors] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [logoMsg, setLogoMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [bgUploading, setBgUploading] = useState(false);
  const [bgMsg, setBgMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [bgMode, setBgMode] = useState<"color" | "image">("color");

  const logoInputRef = useRef<HTMLInputElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    brandingApi.get().then((r) => {
      const d = r.data;
      if (d.brand_color) setBrandColor(d.brand_color);
      if (d.btn_color) setBtnColor(d.btn_color);
      if (d.bg_color) { setBgColor(d.bg_color); setBgMode("color"); }
      if (d.bg_image) { setBgImage(d.bg_image); setBgMode("image"); }
      setLogo(d.brand_logo);
    }).catch(() => {});
  }, []);

  async function saveColors() {
    setSavingColors(true); setSavedColors(false);
    try {
      await brandingApi.update({
        brand_color: brandColor,
        btn_color: btnColor,
        bg_color: bgMode === "color" ? bgColor : undefined,
      });
      setSavedColors(true);
      setTimeout(() => { setSavedColors(false); window.location.reload(); }, 1200);
    } finally { setSavingColors(false); }
  }

  async function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLogoUploading(true); setLogoMsg(null);
    try {
      const r = await brandingApi.uploadLogo(file);
      setLogo(r.data.brand_logo);
      setLogoMsg({ type: "ok", text: "Logo opgeslagen." });
      setTimeout(() => { setLogoMsg(null); window.location.reload(); }, 1200);
    } catch {
      setLogoMsg({ type: "err", text: "Upload mislukt. Maximaal 500 KB, PNG/JPEG." });
    } finally {
      setLogoUploading(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
    }
  }

  async function handleBgUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBgUploading(true); setBgMsg(null);
    try {
      const r = await brandingApi.uploadBackground(file);
      setBgImage(r.data.bg_image);
      setBgMode("image");
      setBgMsg({ type: "ok", text: "Achtergrond opgeslagen." });
      setTimeout(() => { setBgMsg(null); window.location.reload(); }, 1200);
    } catch {
      setBgMsg({ type: "err", text: "Upload mislukt. Maximaal 2 MB, PNG/JPEG." });
    } finally {
      setBgUploading(false);
      if (bgInputRef.current) bgInputRef.current.value = "";
    }
  }

  async function removeBgImage() {
    setBgUploading(true); setBgMsg(null);
    try {
      await brandingApi.deleteBackground();
      setBgImage(null);
      setBgMode("color");
      setBgMsg({ type: "ok", text: "Achtergrond verwijderd." });
      setTimeout(() => { setBgMsg(null); window.location.reload(); }, 1200);
    } catch {
      setBgMsg({ type: "err", text: "Verwijderen mislukt." });
    } finally { setBgUploading(false); }
  }

  return (
    <div className="space-y-5">
      {/* ── Kleuren ── */}
      <Section title="Kleuren">
        <p className="text-sm text-ink-45 mb-3">
          Stel de kleuren in voor de navigatiebalk, knoppen en achtergrond.
        </p>
        <div className="space-y-3">
          <ColorRow label="Navigatiebalk" value={brandColor} onChange={setBrandColor} />
          <ColorRow label="Knoppen" value={btnColor} onChange={setBtnColor} />
        </div>
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={saveColors}
            disabled={savingColors}
            className="bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
          >
            {savingColors ? "Opslaan..." : "Kleuren opslaan"}
          </button>
          {savedColors && <span className="text-sm text-done">✓ Opgeslagen</span>}
        </div>
      </Section>

      {/* ── Achtergrond ── */}
      <Section title="Achtergrond">
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setBgMode("color")}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${bgMode === "color" ? "bg-brand text-white border-brand" : "bg-paper-raised text-ink-70 border-ink-12 hover:border-ink-25"}`}
          >
            Kleur
          </button>
          <button
            onClick={() => setBgMode("image")}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${bgMode === "image" ? "bg-brand text-white border-brand" : "bg-paper-raised text-ink-70 border-ink-12 hover:border-ink-25"}`}
          >
            Afbeelding
          </button>
        </div>

        {bgMode === "color" && (
          <div className="space-y-3">
            <ColorRow label="Achtergrondkleur" value={bgColor} onChange={setBgColor} />
            <button
              onClick={saveColors}
              disabled={savingColors}
              className="bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {savingColors ? "Opslaan..." : "Opslaan"}
            </button>
          </div>
        )}

        {bgMode === "image" && (
          <div className="space-y-3">
            {bgImage && (
              <div className="relative w-full h-28 rounded-lg overflow-hidden border border-ink-12">
                <img src={bgImage} alt="Achtergrond" className="w-full h-full object-cover" />
                <button
                  onClick={removeBgImage}
                  disabled={bgUploading}
                  className="absolute top-2 right-2 bg-urgent text-white text-xs px-2 py-1 rounded hover:bg-urgent disabled:opacity-50"
                >
                  Verwijderen
                </button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <input ref={bgInputRef} type="file" accept="image/png,image/jpeg,image/webp"
                onChange={handleBgUpload} className="hidden" id="bg-upload" />
              <label
                htmlFor="bg-upload"
                className={`cursor-pointer bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-colors ${bgUploading ? "opacity-50 pointer-events-none" : ""}`}
              >
                {bgUploading ? "Bezig..." : "📂 Achtergrond uploaden"}
              </label>
              <span className="text-xs text-ink-45">PNG, JPEG of WebP · max 2 MB</span>
            </div>
          </div>
        )}

        {bgMsg && (
          <p className={`text-sm mt-2 ${bgMsg.type === "ok" ? "text-done" : "text-urgent"}`}>
            {bgMsg.type === "ok" ? "✓ " : "✗ "}{bgMsg.text}
          </p>
        )}
      </Section>

      {/* ── Logo ── */}
      <Section title="Logo">
        <p className="text-sm text-ink-45">
          Upload een logo (PNG of JPEG, max 500 KB). Verschijnt links bovenin en is op mobiel de menu-knop.
        </p>
        {logo && (
          <div className="flex items-center gap-4">
            <img src={logo} alt="Huidig logo" className="w-16 h-16 object-contain rounded-lg border border-ink-12 bg-ink-6 p-1" />
            <span className="text-sm text-ink-45">Huidig logo</span>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp"
            onChange={handleLogoUpload} className="hidden" id="logo-upload" />
          <label
            htmlFor="logo-upload"
            className={`cursor-pointer bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-colors ${logoUploading ? "opacity-50 pointer-events-none" : ""}`}
          >
            {logoUploading ? "Uploaden..." : "📂 Logo uploaden"}
          </label>
          <span className="text-xs text-ink-45">PNG, JPEG of WebP · max 500 KB</span>
        </div>
        {logoMsg && (
          <p className={`text-sm ${logoMsg.type === "ok" ? "text-done" : "text-urgent"}`}>
            {logoMsg.type === "ok" ? "✓ " : "✗ "}{logoMsg.text}
          </p>
        )}
      </Section>
    </div>
  );
}

// ── Loginpagina huisstijl ──────────────────────────────────────────────────────
// Eigen teksten, kleuren, logo en achtergrond voor de standalone loginpagina.
// Alles wat hier niet expliciet wordt ingesteld erft van de algemene huisstijl.

function LoginPaginaPanel() {
  const [loaded, setLoaded] = useState<LoginBranding | null>(null);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [footer, setFooter] = useState("");
  const [btnColor, setBtnColor] = useState("#2563eb");
  const [bgColor, setBgColor] = useState("#f9fafb");

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  const logoInputRef = useRef<HTMLInputElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);

  function applyBranding(b: LoginBranding) {
    setLoaded(b);
    setTitle(b.title);
    setSubtitle(b.subtitle);
    setFooter(b.footer);
    if (b.btn_color) setBtnColor(b.btn_color);
    if (b.bg_color) setBgColor(b.bg_color);
  }

  useEffect(() => {
    loginBrandingApi.get().then((r) => applyBranding(r.data)).catch(() => {});
  }, []);

  function flash(type: "ok" | "err", text: string) {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 2500);
  }

  async function save() {
    if (!loaded) return;
    setSaving(true);
    try {
      // Alleen gewijzigde velden meesturen, zodat geërfde waarden niet
      // onbedoeld als eigen loginpagina-waarde worden vastgezet
      const changes: Record<string, string> = {};
      if (title !== loaded.title) changes.title = title;
      if (subtitle !== loaded.subtitle) changes.subtitle = subtitle;
      if (footer !== loaded.footer) changes.footer = footer;
      if (btnColor !== (loaded.btn_color || "#2563eb")) changes.btn_color = btnColor;
      if (bgColor !== (loaded.bg_color || "#f9fafb")) changes.bg_color = bgColor;
      if (Object.keys(changes).length === 0) {
        flash("ok", "Geen wijzigingen.");
        return;
      }
      const r = await loginBrandingApi.update(changes);
      applyBranding(r.data);
      flash("ok", "Opgeslagen.");
    } catch {
      flash("err", "Opslaan mislukt.");
    } finally { setSaving(false); }
  }

  async function resetAll() {
    setSaving(true);
    try {
      await loginBrandingApi.update({ title: null, subtitle: null, footer: null, btn_color: null, bg_color: null });
      await loginBrandingApi.deleteLogo();
      const r = await loginBrandingApi.deleteBackground();
      applyBranding(r.data);
      flash("ok", "Loginpagina volgt weer de algemene huisstijl.");
    } catch {
      flash("err", "Herstellen mislukt.");
    } finally { setSaving(false); }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>, kind: "logo" | "background") {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const r = kind === "logo"
        ? await loginBrandingApi.uploadLogo(file)
        : await loginBrandingApi.uploadBackground(file);
      applyBranding(r.data);
      flash("ok", kind === "logo" ? "Logo opgeslagen." : "Achtergrond opgeslagen.");
    } catch {
      flash("err", "Upload mislukt. PNG/JPEG/WebP, logo max 500 KB, achtergrond max 2 MB.");
    } finally {
      setUploading(false);
      if (logoInputRef.current) logoInputRef.current.value = "";
      if (bgInputRef.current) bgInputRef.current.value = "";
    }
  }

  async function handleDelete(kind: "logo" | "background") {
    setUploading(true);
    try {
      const r = kind === "logo"
        ? await loginBrandingApi.deleteLogo()
        : await loginBrandingApi.deleteBackground();
      applyBranding(r.data);
      flash("ok", "Verwijderd — volgt weer de algemene huisstijl.");
    } catch {
      flash("err", "Verwijderen mislukt.");
    } finally { setUploading(false); }
  }

  const inherited = (key: string) => loaded && !loaded.custom[key];

  return (
    <Section title="Loginpagina">
      <p className="text-sm text-ink-45">
        Teksten, kleuren, logo en achtergrond van de standalone loginpagina. Velden die je hier
        niet aanpast volgen automatisch de algemene huisstijl hierboven.{" "}
        <a href="#/login" className="text-brand hover:underline">Bekijk de loginpagina →</a>
      </p>

      {/* Teksten */}
      <div className="space-y-2">
        <label className="block text-sm text-ink-70">
          Titel {inherited("title") && <span className="text-xs text-ink-45">(standaard)</span>}
          <input value={title} onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="block text-sm text-ink-70">
          Ondertitel {inherited("subtitle") && <span className="text-xs text-ink-45">(standaard)</span>}
          <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)}
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
        </label>
        <label className="block text-sm text-ink-70">
          Voettekst {inherited("footer") && <span className="text-xs text-ink-45">(standaard)</span>}
          <input value={footer} onChange={(e) => setFooter(e.target.value)}
            className="mt-1 w-full border rounded-lg px-3 py-2 text-sm" />
        </label>
      </div>

      {/* Kleuren */}
      <div className="space-y-3 pt-1">
        <ColorRow label={`Knopkleur${inherited("btn_color") ? " (huisstijl)" : ""}`} value={btnColor} onChange={setBtnColor} />
        <ColorRow label={`Achtergrond${inherited("bg_color") ? " (huisstijl)" : ""}`} value={bgColor} onChange={setBgColor} />
      </div>

      {/* Logo */}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        {loaded?.logo && (
          <img src={loaded.logo} alt="Login logo" className="w-12 h-12 object-contain rounded-lg border border-ink-12 bg-ink-6 p-1" />
        )}
        <input ref={logoInputRef} type="file" accept="image/png,image/jpeg,image/webp"
          onChange={(e) => handleUpload(e, "logo")} className="hidden" id="login-logo-upload" />
        <label htmlFor="login-logo-upload"
          className={`cursor-pointer border border-ink-12 px-3 py-1.5 rounded-lg text-sm hover:border-ink-25 ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
          📂 Eigen login-logo
        </label>
        {loaded?.custom.logo && (
          <button onClick={() => handleDelete("logo")} disabled={uploading}
            className="text-sm text-urgent hover:underline disabled:opacity-50">
            Logo verwijderen
          </button>
        )}
      </div>

      {/* Achtergrondafbeelding */}
      <div className="flex flex-wrap items-center gap-3">
        {loaded?.bg_image && loaded?.custom.bg_image && (
          <img src={loaded.bg_image} alt="Login achtergrond" className="w-20 h-12 object-cover rounded-lg border border-ink-12" />
        )}
        <input ref={bgInputRef} type="file" accept="image/png,image/jpeg,image/webp"
          onChange={(e) => handleUpload(e, "background")} className="hidden" id="login-bg-upload" />
        <label htmlFor="login-bg-upload"
          className={`cursor-pointer border border-ink-12 px-3 py-1.5 rounded-lg text-sm hover:border-ink-25 ${uploading ? "opacity-50 pointer-events-none" : ""}`}>
          📂 Eigen achtergrondafbeelding
        </label>
        {loaded?.custom.bg_image && (
          <button onClick={() => handleDelete("background")} disabled={uploading}
            className="text-sm text-urgent hover:underline disabled:opacity-50">
            Achtergrond verwijderen
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button onClick={save} disabled={saving}
          className="bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50">
          {saving ? "Opslaan..." : "Opslaan"}
        </button>
        <BevestigKnop
          label="Herstel algemene huisstijl"
          vraag="Alle eigen loginpagina-instellingen wissen?"
          bevestigLabel="Ja, wissen"
          onBevestig={resetAll}
          disabled={saving}
          className="border px-4 py-2 rounded-lg text-sm text-ink-70 hover:border-ink-25 disabled:opacity-50"
        />
        {msg && (
          <span className={`text-sm ${msg.type === "ok" ? "text-done" : "text-urgent"}`}>
            {msg.type === "ok" ? "✓ " : "✗ "}{msg.text}
          </span>
        )}
      </div>
    </Section>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// HOOFD COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

const AI_MODELS = [
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 — snel & goedkoop (aanbevolen)" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 — balans" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8 — krachtigst" },
];

function KennisbotAiPanel() {
  const [settings, setSettings] = useState<KnowledgeAiSettings | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("claude-haiku-4-5");
  const [webDomains, setWebDomains] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);

  function load() {
    knowledgeApi.getAiSettings().then((r) => {
      setSettings(r.data);
      setModel(r.data.model);
      setWebDomains(r.data.web_domains);
    }).catch(() => {});
  }
  useEffect(load, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const payload: { model: string; api_key?: string; web_domains: string } = {
        model,
        web_domains: webDomains,
      };
      if (apiKey.trim()) payload.api_key = apiKey.trim();
      const r = await knowledgeApi.updateAiSettings(payload);
      setSettings(r.data);
      setApiKey("");
      setMsg({ type: "ok", text: "Opgeslagen." });
    } catch {
      setMsg({ type: "err", text: "Opslaan mislukt." });
    } finally {
      setSaving(false);
    }
  }

  async function clearKey() {
    const r = await knowledgeApi.updateAiSettings({ api_key: "   " });
    setSettings(r.data);
    setMsg({ type: "ok", text: "Sleutel verwijderd." });
  }

  async function toggle(enabled: boolean) {
    const r = await knowledgeApi.updateAiSettings({ enabled });
    setSettings(r.data);
  }

  async function toggleWebSearch(enabled: boolean) {
    const r = await knowledgeApi.updateAiSettings({ web_search_enabled: enabled });
    setSettings(r.data);
  }

  return (
    <Section title="AI / Kennisbot">
      <p className="text-sm text-ink-70">
        Koppel Claude om vragen te laten beantwoorden uit je documenten. Zonder sleutel
        valt de kennisbot terug op trefwoord-zoeken. De bot put altijd alleen uit jouw
        eigen kennis en verzint nooit antwoorden. Optioneel mag de bot óók zoeken op
        websites die jij hieronder toestaat — en nergens anders.
      </p>

      {settings && (
        <div className="flex items-center justify-between bg-ink-6 rounded-lg p-3">
          <div>
            <p className="text-sm font-medium text-ink">AI-modus</p>
            <p className="text-xs text-ink-45">
              {settings.has_key
                ? settings.key_from_addon
                  ? "Sleutel actief (via addon-optie)"
                  : "Sleutel actief (in de app ingesteld)"
                : "Nog geen sleutel ingesteld"}
            </p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={settings.ai_enabled}
              disabled={!settings.ai_available}
              onChange={(e) => toggle(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-sm">{settings.ai_enabled ? "Aan" : "Uit"}</span>
          </label>
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-ink-70">Claude API-sleutel</label>
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={settings?.has_key ? "•••••••• (laat leeg om te behouden)" : "sk-ant-..."}
          className="block w-full border border-ink-12 rounded-lg px-3 py-2 text-sm"
          autoComplete="off"
        />
        <p className="text-xs text-ink-45">
          Een sleutel haal je op bij console.anthropic.com. Wordt versleuteld bewaard en
          nooit teruggetoond.
        </p>
        {settings?.has_key && !settings.key_from_addon && (
          <BevestigKnop
            label="Sleutel verwijderen"
            vraag="De opgeslagen API-sleutel verwijderen?"
            onBevestig={clearKey}
            className="text-xs text-urgent hover:underline"
          />
        )}
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-ink-70">Model</label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="block w-full border border-ink-12 rounded-lg px-3 py-2 text-sm bg-paper-raised"
        >
          {AI_MODELS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
          {!AI_MODELS.some((m) => m.id === model) && <option value={model}>{model}</option>}
        </select>
      </div>

      {settings && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between bg-ink-6 rounded-lg p-3">
            <div>
              <p className="text-sm font-medium text-ink">Zoeken op websites</p>
              <p className="text-xs text-ink-45">
                {settings.web_search_enabled
                  ? "De bot mag uitsluitend op onderstaande websites zoeken"
                  : "De bot zoekt alleen in je eigen kennisbank"}
              </p>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={settings.web_search_enabled}
                disabled={!settings.ai_available}
                onChange={(e) => toggleWebSearch(e.target.checked)}
                className="w-4 h-4"
              />
              <span className="text-sm">{settings.web_search_enabled ? "Aan" : "Uit"}</span>
            </label>
          </div>
          <label className="text-sm font-medium text-ink-70">Toegestane websites</label>
          <textarea
            value={webDomains}
            onChange={(e) => setWebDomains(e.target.value)}
            rows={4}
            placeholder={"Eén website per regel, met daarachter waarvoor die dient, bijv.:\nmiele.nl — handleidingen keukenapparatuur\nsupport.kassaleverancier.com — storingen kassasysteem"}
            className="block w-full border border-ink-12 rounded-lg px-3 py-2 text-sm font-mono"
          />
          <p className="text-xs text-ink-45">
            Eén website per regel. Zet er (na een spatie of streepje) bij waarvoor de
            website bedoeld is — de bot gebruikt die omschrijving om bij een vraag de
            juiste website te kiezen. De bot zoekt alléén op deze websites, en alleen
            wanneer je eigen kennisbank geen antwoord geeft. Zonder ingevulde websites
            blijft zoeken op het web uit, ook met de schakelaar aan.
          </p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={saving}
          className="bg-brand text-white px-5 py-2 rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Opslaan..." : "Opslaan"}
        </button>
        {msg && (
          <span className={`text-sm ${msg.type === "ok" ? "text-done" : "text-urgent"}`}>
            {msg.text}
          </span>
        )}
      </div>
    </Section>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// LOGBOEKEN — objecten beheren
// ══════════════════════════════════════════════════════════════════════════════

const OBJECT_TYPES: { value: LogObjectType; label: string }[] = [
  { value: "installatie", label: "Installatie" },
  { value: "apparaat", label: "Apparaat" },
  { value: "gereedschap", label: "Gereedschap" },
];

const LEEG_OBJECT = {
  name: "",
  type: "installatie" as LogObjectType,
  location_id: null as string | null,
  department: null as Category | null,
  serial: "",
  description: "",
  nfc_tag_id: "",
  folder: "",
  kind: "",
  purchase_date: "",
  supplier: "",
  // Als tekst in het formulier, zodat "leeg" ook echt leeg is en niet 0.
  maintenance_interval_days: "",
};

/**
 * Veelgebruikte onderhoudsintervallen. Een vrij veld in dagen blijft ernaast
 * bestaan — een keuring is soms elke 14 maanden.
 */
const INTERVALLEN: { label: string; dagen: string }[] = [
  { label: "Geen", dagen: "" },
  { label: "Wekelijks", dagen: "7" },
  { label: "Maandelijks", dagen: "30" },
  { label: "Per kwartaal", dagen: "91" },
  { label: "Halfjaarlijks", dagen: "182" },
  { label: "Jaarlijks", dagen: "365" },
];

/**
 * Objecten zijn de dingen met een logboek: de brandmeldcentrale, een airco,
 * een slijptol. Aanmaken is inrichtingswerk — het staat daarom hier en niet in
 * het naslagscherm zelf.
 */
function LogboekObjectenPanel() {
  const [objecten, setObjecten] = useState<LogObject[]>([]);
  const [locaties, setLocaties] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...LEEG_OBJECT });
  const [bewerkt, setBewerkt] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  const laden = () =>
    Promise.allSettled([logbookApi.listObjects(), locationApi.list()]).then(([objs, locs]) => {
      if (objs.status === "fulfilled") setObjecten(objs.value.data);
      if (locs.status === "fulfilled") {
        setLocaties(Object.fromEntries(locs.value.data.map((l) => [l.id, l.name])));
      }
    });

  useEffect(() => { laden().finally(() => setLoading(false)); }, []);

  // Bestaande mappen als suggestie, zodat je niet drie keer "Gereedschap"
  // anders spelt.
  const bekendeMappen = Array.from(
    new Set(objecten.map((o) => (o.folder ?? "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "nl"));

  const bekendeSoorten = Array.from(
    new Set(objecten.map((o) => (o.kind ?? "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "nl"));

  const bekendeLeveranciers = Array.from(
    new Set(objecten.map((o) => (o.supplier ?? "").trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b, "nl"));

  const perMap = (() => {
    const groepen = new Map<string, LogObject[]>();
    for (const o of objecten) {
      const map = mapVan(o);
      groepen.set(map, [...(groepen.get(map) ?? []), o]);
    }
    return [...groepen.entries()]
      .map(([map, lijst]) => ({ map, lijst: lijst.sort((a, b) => a.name.localeCompare(b.name, "nl")) }))
      .sort((a, b) => a.map.localeCompare(b.map, "nl"));
  })();

  async function opslaan() {
    if (!form.name.trim()) return;
    setFout(null);
    const data = {
      ...form,
      name: form.name.trim(),
      serial: form.serial.trim() || null,
      description: form.description.trim() || null,
      nfc_tag_id: form.nfc_tag_id.trim() || null,
      folder: form.folder.trim() || null,
      kind: form.kind.trim() || null,
      purchase_date: form.purchase_date || null,
      supplier: form.supplier.trim() || null,
      maintenance_interval_days: Number(form.maintenance_interval_days) || null,
    };
    try {
      if (bewerkt) await logbookApi.updateObject(bewerkt, data);
      else await logbookApi.createObject(data);
      setForm({ ...LEEG_OBJECT });
      setBewerkt(null);
      setOpen(false);
      await laden();
    } catch (err) {
      setFout(apiErrorText(err, "Opslaan mislukt"));
    }
  }

  async function zetActief(o: LogObject, actief: boolean) {
    await logbookApi.updateObject(o.id, { is_active: actief });
    await laden();
  }

  return (
    <Section title="Logboekobjecten">
      <p className="text-sm text-ink-45">
        Een object is een ding met een naam, een plek en een geschiedenis. Zet er een
        onderhoudsinterval op en de controle komt vanzelf als taak op Vandaag; het
        afvinken schrijft dan een onwisbare regel in het boek.
      </p>

      {!open && (
        <button
          onClick={() => { setForm({ ...LEEG_OBJECT }); setBewerkt(null); setOpen(true); }}
          className="btn-primary w-fit"
        >
          + Object toevoegen
        </button>
      )}

      {open && (
        <div className="rounded-[10px] border border-ink-12 p-4 space-y-3">
          <h3 className="text-sm font-semibold">{bewerkt ? "Object bewerken" : "Nieuw object"}</h3>
          <div className="grid sm:grid-cols-2 gap-2">
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Naam, bijv. Brandmeldcentrale"
              className="h-tap rounded-[10px] border border-ink-12 px-3 text-body"
            />
            <select
              value={form.type}
              onChange={(e) => setForm({ ...form, type: e.target.value as LogObjectType })}
              className="h-tap rounded-[10px] border border-ink-12 px-3 text-body bg-paper-raised"
            >
              {OBJECT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <select
              value={form.department ?? ""}
              onChange={(e) => setForm({ ...form, department: (e.target.value || null) as Category | null })}
              className="h-tap rounded-[10px] border border-ink-12 px-3 text-body bg-paper-raised"
            >
              <option value="">— Iedereen mag schrijven —</option>
              {(Object.keys(DEPT_FULL_LABELS) as Category[]).map((d) => (
                <option key={d} value={d}>{DEPT_FULL_LABELS[d]}</option>
              ))}
            </select>
            <input
              value={form.serial}
              onChange={(e) => setForm({ ...form, serial: e.target.value })}
              placeholder="Serienummer (optioneel)"
              className="h-tap rounded-[10px] border border-ink-12 px-3 text-body font-mono"
            />
            <input
              value={form.nfc_tag_id}
              onChange={(e) => setForm({ ...form, nfc_tag_id: e.target.value })}
              placeholder="NFC-tag ID (optioneel)"
              className="h-tap rounded-[10px] border border-ink-12 px-3 text-body font-mono"
            />
            <input
              value={form.folder}
              onChange={(e) => setForm({ ...form, folder: e.target.value })}
              placeholder="Map, bijv. Gereedschap"
              list="logboek-mappen"
              className="h-tap rounded-[10px] border border-ink-12 px-3 text-body"
            />
            <datalist id="logboek-mappen">
              {bekendeMappen.map((m) => <option key={m} value={m} />)}
            </datalist>
            <input
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value })}
              placeholder="Soort, bijv. boormachine"
              list="logboek-soorten"
              className="h-tap rounded-[10px] border border-ink-12 px-3 text-body"
            />
            <datalist id="logboek-soorten">
              {bekendeSoorten.map((k) => <option key={k} value={k} />)}
            </datalist>
            <label className="flex flex-col gap-1">
              <span className="meta">Aankoopdatum</span>
              <input
                type="date"
                value={form.purchase_date}
                onChange={(e) => setForm({ ...form, purchase_date: e.target.value })}
                className="h-tap rounded-[10px] border border-ink-12 px-3 text-body"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="meta">Leverancier</span>
              <input
                value={form.supplier}
                onChange={(e) => setForm({ ...form, supplier: e.target.value })}
                placeholder="bijv. Van der Meer Techniek"
                list="logboek-leveranciers"
                className="h-tap rounded-[10px] border border-ink-12 px-3 text-body"
              />
            </label>
            <datalist id="logboek-leveranciers">
              {bekendeLeveranciers.map((l) => <option key={l} value={l} />)}
            </datalist>
          </div>
          <AreaSelector value={form.location_id} onChange={(id) => setForm({ ...form, location_id: id })} />

          {/* Onderhoudsinterval — wordt een herhaaltaak op dit object */}
          <div className="rounded-[10px] bg-ink-6 p-3 space-y-2">
            <p className="text-sm font-semibold text-ink">Onderhoudsinterval</p>
            <div className="flex flex-wrap gap-1.5">
              {INTERVALLEN.map((i) => (
                <button
                  key={i.label}
                  type="button"
                  onClick={() => setForm({ ...form, maintenance_interval_days: i.dagen })}
                  className={`h-tap px-3.5 inline-flex items-center rounded-full text-meta font-medium transition-colors ${
                    form.maintenance_interval_days === i.dagen
                      ? "bg-ink text-paper font-semibold"
                      : "bg-paper-raised border border-ink-12 text-ink-70 hover:bg-ink-6"
                  }`}
                >
                  {i.label}
                </button>
              ))}
              <span className="flex items-center gap-1.5">
                <span className="meta">of elke</span>
                <input
                  type="number"
                  min={1}
                  inputMode="numeric"
                  value={form.maintenance_interval_days}
                  onChange={(e) => setForm({ ...form, maintenance_interval_days: e.target.value })}
                  placeholder="90"
                  className="h-tap w-20 rounded-[10px] border border-ink-12 px-3 text-body"
                />
                <span className="meta">dagen</span>
              </span>
            </div>
            <p className="meta">
              De teller loopt vanaf de laatste registratie, niet vanaf een vaste
              kalenderdag. De controle verschijnt als gewone taak op Vandaag;
              afvinken schrijft de regel in dit boek.
            </p>
          </div>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={2}
            placeholder="Omschrijving (optioneel), bijv. wat de maandelijkse controle inhoudt"
            className="w-full rounded-[10px] border border-ink-12 px-3 py-2 text-body resize-none"
          />
          {fout && <p className="text-sm text-urgent">{fout}</p>}
          <div className="flex gap-2">
            <button onClick={opslaan} className="btn-primary">Opslaan</button>
            <button onClick={() => { setOpen(false); setBewerkt(null); setFout(null); }} className="btn-secondary">
              Annuleren
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink-45">Laden…</p>
      ) : objecten.length === 0 ? (
        <p className="text-sm text-ink-45">Nog geen objecten.</p>
      ) : (
        <div className="space-y-4">
          {perMap.map((groep) => (
            <div key={groep.map}>
              <p className="mb-2 font-mono text-xs uppercase tracking-[0.14em] text-ink-45">
                {groep.map}
              </p>
              <ul className="grid gap-2">
          {groep.lijst.map((o) => (
            <li key={o.id} className="row min-h-[66px]">
              <span className="flex-1 min-w-0">
                <span className="block text-row text-ink">{o.name}</span>
                <span className="meta">
                  {[
                    o.kind || OBJECT_TYPES.find((t) => t.value === o.type)?.label,
                    o.location_id ? (locaties[o.location_id] ?? o.location_id) : null,
                    o.department ? DEPT_FULL_LABELS[o.department] : "iedereen mag schrijven",
                    o.maintenance_interval_days
                      ? `onderhoud ${intervalTekst(o.maintenance_interval_days)}`
                      : null,
                    o.supplier,
                    o.nfc_tag_id ? "NFC" : null,
                  ].filter(Boolean).join(" · ")}
                </span>
              </span>
              <button
                onClick={() => {
                  setBewerkt(o.id);
                  setOpen(true);
                  setForm({
                    name: o.name, type: o.type, location_id: o.location_id,
                    department: o.department, serial: o.serial ?? "", description: o.description ?? "",
                    nfc_tag_id: o.nfc_tag_id ?? "", folder: o.folder ?? "", kind: o.kind ?? "",
                    purchase_date: o.purchase_date ?? "", supplier: o.supplier ?? "",
                    maintenance_interval_days: o.maintenance_interval_days
                      ? String(o.maintenance_interval_days) : "",
                  });
                }}
                className="shrink-0 h-tap px-3 rounded-[10px] border border-ink-12 text-ink-70 text-meta font-semibold hover:bg-ink-6"
              >
                Wijzig
              </button>
              <BevestigKnop
                label={o.is_active ? "Archiveren" : "Terugzetten"}
                vraag={o.is_active ? "Object archiveren? Het boek blijft bewaard." : "Object terugzetten?"}
                bevestigLabel="Ja"
                onBevestig={() => zetActief(o, !o.is_active)}
                className="shrink-0 h-tap px-3 text-meta font-semibold text-ink-45 hover:text-ink"
              />
            </li>
          ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// BETA
// ══════════════════════════════════════════════════════════════════════════════

const TABEL_LABELS: Record<string, string> = {
  tickets: "Tickets",
  ticket_comments: "Commentaren",
  ticket_pins: "Vastgezette tickets",
  recurring_templates: "Herhaaltaken",
  user_roles: "Medewerkers",
  direct_messages: "Berichten",
  knowledge_entries: "Kennisbank Q&A",
  knowledge_documents: "Kennisbank documenten",
  knowledge_chunks: "Kennisbank tekstblokken",
  knowledge_questions: "Gestelde vragen",
  bikes: "Fietsen",
  bike_types: "Fietstypes",
  bike_reservations: "Fietsreserveringen",
  bike_maintenance_records: "Fietsonderhoud",
  bike_logs: "Fietslogboek",
  pool_logs: "Zwembadmetingen",
  pool_configs: "Zwembadinstellingen",
  pool_incidents: "Zwembadincidenten",
  system_settings: "Instellingen",
  ticket_notifications: "Meldingen",
  login_bans: "Login-blokkades",
};

function bytesLabel(bytes?: number | null): string {
  if (!bytes) return "";
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} kB`;
}

function BetaDataPanel({ status, onCopied }: { status: BetaStatus; onCopied: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [copying, setCopying] = useState(false);
  const [result, setResult] = useState<BetaCopyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCopy() {
    setCopying(true);
    setError(null);
    setResult(null);
    try {
      const r = await betaApi.copyProduction();
      setResult(r.data);
      setConfirming(false);
      onCopied();
    } catch (err) {
      setError(apiErrorText(err, "Kopiëren mislukt. Kijk in het addon-logboek voor details."));
    } finally {
      setCopying(false);
    }
  }

  return (
    <div className="bg-paper-raised rounded-2xl shadow p-5 border border-high space-y-4">
      <h2 className="font-bold text-base text-high">Productiedata kopiëren</h2>
      <p className="text-sm text-ink-45">
        Haalt een verse kopie van <strong>alle</strong> data uit de productie-addon:
        tickets, herhaaltaken, medewerkers, kennisbank, fietsen, zwembadlogboek en
        de bijbehorende foto's. Alles wat nu in deze beta staat wordt daarbij
        <strong> overschreven</strong>. De productie-addon wordt alleen gelezen en
        verandert niet.
      </p>

      <dl className="text-sm bg-ink-6 rounded-xl p-4 space-y-1.5">
        <div className="flex justify-between gap-4">
          <dt className="text-ink-45">Productiedatabase</dt>
          <dd className="font-medium text-right">
            {status.source.available ? (
              <>
                {bytesLabel(status.source.size_bytes)}
                {status.source.modified_at && (
                  <span className="text-ink-45 font-normal">
                    {" · "}gewijzigd {sessieGeleden(status.source.modified_at)}
                  </span>
                )}
              </>
            ) : (
              <span className="text-urgent">niet gevonden</span>
            )}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-ink-45">Laatste kopie</dt>
          <dd className="font-medium text-right">
            {status.last_copy_at ? sessieGeleden(status.last_copy_at) : "nog nooit"}
          </dd>
        </div>
      </dl>

      {!status.source.available ? (
        <p className="text-sm text-urgent">
          De database van de productie-addon is niet zichtbaar. Controleer of de
          gewone Hotel Ticket System addon geïnstalleerd is en of deze beta-addon
          <code className="mx-1 bg-ink-6 px-1 rounded">config:rw</code> in zijn
          mapping heeft.
        </p>
      ) : !confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-amber-700"
        >
          ⬇ Productiedata kopiëren
        </button>
      ) : (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-high text-sm font-medium">
            Weet je het zeker? Alle huidige beta-data verdwijnt.
          </span>
          <button
            onClick={handleCopy}
            disabled={copying}
            className="bg-amber-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-amber-700 disabled:opacity-50"
          >
            {copying ? "Kopiëren..." : "Ja, kopieer productiedata"}
          </button>
          <button
            onClick={() => setConfirming(false)}
            className="border px-4 py-2 rounded-lg text-sm hover:bg-ink-6"
          >
            Annuleren
          </button>
        </div>
      )}

      {error && <p className="text-sm text-urgent">✗ {error}</p>}

      {result && (
        <div className="space-y-2">
          <p className="text-sm text-done">✓ {result.message}</p>
          <ul className="text-sm text-ink-70 grid grid-cols-2 gap-x-4 gap-y-0.5">
            {Object.entries(result.tables).map(([table, count]) => (
              <li key={table} className="flex justify-between gap-2">
                <span className="truncate">{TABEL_LABELS[table] ?? table}</span>
                <span className="font-medium tabular-nums">{count}</span>
              </li>
            ))}
            <li className="flex justify-between gap-2">
              <span className="truncate">Foto's / afbeeldingen</span>
              <span className="font-medium tabular-nums">{result.photos}</span>
            </li>
          </ul>
          <p className="text-xs text-ink-45">
            Ververs de pagina om overal met de gekopieerde data te werken.
          </p>
        </div>
      )}
    </div>
  );
}

function BetaPanel({ status }: { status: BetaStatus }) {
  return (
    <Section title="Over deze omgeving">
      <p className="text-sm text-ink-45">
        Dit is de <strong>beta-omgeving</strong> (versie {status.version}): dezelfde app als
        productie, maar met een eigen database. Wat je hier doet komt nooit in de
        echte administratie terecht.
      </p>
      <ul className="text-sm text-ink-45 list-disc pl-5 space-y-1">
        <li>Pushmeldingen en e-mails worden <strong>niet</strong> verstuurd</li>
        <li>De <code className="bg-ink-6 px-1 rounded">sensor.hotel_tickets_*</code> entiteiten in Home Assistant blijven van productie</li>
        <li>De HA-integratie kan hier niet geïnstalleerd worden</li>
        <li>Herhaaltaken lopen wél — er komen dus vanzelf testtickets bij</li>
      </ul>
    </Section>
  );
}

export default function Instellingen() {
  const [tab, setTab] = useState<Tab>("systeem");
  const [me, setMe] = useState<UserRole | null>(null);
  const [beta, setBeta] = useState<BetaStatus | null>(null);

  useEffect(() => {
    userApi.me().then((r) => setMe(r.data)).catch(() => {});
  }, []);

  const loadBeta = () => {
    betaApi.status().then((r) => setBeta(r.data)).catch(() => {});
  };
  useEffect(loadBeta, []);

  const isAdmin = me?.role === "admin" || me?.role === "supervisor";

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "systeem", label: "Systeem", icon: "🏠" },
    { id: "logboeken", label: "Logboeken", icon: "📘" },
    { id: "zwembaden", label: "Zwembaden", icon: "🏊" },
    { id: "fietsen", label: "Fietsen", icon: "🚲" },
    { id: "kennisbot", label: "Kennisbot", icon: "💡" },
    { id: "huisstijl", label: "Huisstijl", icon: "🎨" },
    // Alleen zichtbaar in de beta-addon
    ...(beta?.beta_mode ? [{ id: "beta" as Tab, label: "Beta", icon: "🧪" }] : []),
  ];

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Instellingen</h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-ink-6 p-1 rounded-xl w-fit max-w-full overflow-x-auto scrollbar-none">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors shrink-0 whitespace-nowrap ${
              tab === t.id ? "bg-paper-raised shadow text-ink" : "text-ink-45 hover:text-ink-70"
            }`}>
            <span>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>

      {/* Inhoud per tab */}
      {tab === "systeem" && (
        <div className="space-y-5">
          <IntegratieWidget />
          <NotificatieInstellingen />
          <MedewerkersBeheer isAdmin={isAdmin} />
          {isAdmin && <ActieveSessiesPanel />}
          {isAdmin && <BeveiligingPanel />}
        </div>
      )}

      {tab === "zwembaden" && (
        <div className="space-y-5">
          <ZwembadConfigPanel />
          <ZwembadImportPanel />
          <ZwembadResetPanel />
        </div>
      )}

      {tab === "fietsen" && (
        <div className="space-y-5">
          <FietsenZichtbaarheidPanel />
          {isAdmin && <FietsenExcelPanel />}
          {me?.role === "admin" && <FietsenResetPanel />}
        </div>
      )}

      {tab === "kennisbot" && me?.role === "admin" && (
        <div className="space-y-5">
          <KennisbotAiPanel />
        </div>
      )}
      {tab === "kennisbot" && me?.role !== "admin" && (
        <p className="text-sm text-ink-45">Alleen admins kunnen de kennisbot-instellingen aanpassen.</p>
      )}

      {tab === "logboeken" && (
        <div className="space-y-5">
          {isAdmin ? <LogboekObjectenPanel /> : (
            <p className="text-sm text-ink-45">Alleen leidinggevenden kunnen objecten beheren.</p>
          )}
        </div>
      )}

      {tab === "beta" && beta?.beta_mode && (
        <div className="space-y-5">
          <BetaPanel status={beta} />
          {me?.role === "admin" ? (
            <BetaDataPanel status={beta} onCopied={loadBeta} />
          ) : (
            <p className="text-sm text-ink-45">
              Alleen admins kunnen productiedata naar de beta kopiëren.
            </p>
          )}
        </div>
      )}

      {tab === "huisstijl" && isAdmin && (
        <>
          <HuisstijlPanel />
          <LoginPaginaPanel />
        </>
      )}
      {tab === "huisstijl" && !isAdmin && (
        <p className="text-sm text-ink-45">Alleen admins kunnen de huisstijl aanpassen.</p>
      )}
    </div>
  );
}
