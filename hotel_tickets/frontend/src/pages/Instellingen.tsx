import { useEffect, useRef, useState } from "react";
import {
  userApi, integrationApi, systemSettingsApi, poolApi, bikesModuleApi, bikeAdminApi,
  type UserRole, type Role, type Category, type IntegrationStatus, type PoolConfigItem, type BikesModuleRoles,
} from "../api/client";

type Tab = "systeem" | "zwembaden" | "fietsen";

// ── Gedeelde hulpcomponent ─────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow p-5 space-y-4">
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
        <p className="text-sm text-gray-600">
          Versie addon: <span className="font-mono font-medium">{status.bundled_version}</span>
          {status.installed && (
            <> · geïnstalleerd: <span className="font-mono font-medium">{status.installed_version}</span></>
          )}
        </p>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
          isUpToDate ? "bg-green-100 text-green-700" :
          status.installed ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
        }`}>
          {isUpToDate ? "Geïnstalleerd" : status.installed ? "Update beschikbaar" : "Niet geïnstalleerd"}
        </span>
      </div>
      {message && (
        <div className={`text-sm rounded-lg px-3 py-2 ${message.type === "ok" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>
          {message.text}
          {message.type === "ok" && <p className="mt-1 font-medium">Herstart Home Assistant via Instellingen → Systeem → Herstarten.</p>}
        </div>
      )}
      {!isUpToDate && (
        <button onClick={install} disabled={installing} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 w-full">
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
        <label className="block text-sm font-medium text-gray-700 mb-1">Basis-URL voor notificatielinks</label>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-300"
          placeholder="/hassio/ingress/hotel_tickets"
        />
        <p className="text-xs text-gray-500 mt-1">Standaard: <code>/hassio/ingress/hotel_tickets</code></p>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {saving ? "Opslaan..." : "Opslaan"}
        </button>
        {saved && <span className="text-sm text-green-600">✓ Opgeslagen</span>}
      </div>
    </Section>
  );
}

const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin", supervisor: "Supervisor", technician: "Technicus",
  housekeeping: "Huishouding", reception: "Receptie",
};
const DEPT_LABELS: Record<Category, string> = {
  technical: "TD", housekeeping: "Huishouding", reception: "Receptie",
};

function MedewerkersBeheer({ isAdmin }: { isAdmin: boolean }) {
  const [users, setUsers] = useState<UserRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<UserRole>>({});
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({ ha_user_id: "", display_name: "", role: "technician" as Role, email: "", ha_notify_service: "" });

  useEffect(() => {
    userApi.list().then((r) => setUsers(r.data)).finally(() => setLoading(false));
  }, []);

  async function saveEdit(userId: string) {
    const r = await userApi.update(userId, editForm);
    setUsers((prev) => prev.map((u) => u.ha_user_id === userId ? r.data : u));
    setEditing(null);
  }

  async function deleteUser(userId: string) {
    if (!confirm("Gebruiker verwijderen?")) return;
    await userApi.remove(userId);
    setUsers((prev) => prev.filter((u) => u.ha_user_id !== userId));
  }

  async function createUser() {
    const r = await userApi.create({ ...newForm, notify_push: true, notify_email: !!newForm.email });
    setUsers((prev) => [...prev, r.data]);
    setNewForm({ ha_user_id: "", display_name: "", role: "technician", email: "", ha_notify_service: "" });
    setShowNew(false);
  }

  return (
    <Section title="Medewerkers & rollen">
      <div className="flex justify-end">
        {isAdmin && <button onClick={() => setShowNew(true)} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700">+ Toevoegen</button>}
      </div>

      {showNew && (
        <div className="bg-blue-50 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-semibold">Nieuwe medewerker</h3>
          <div className="grid grid-cols-2 gap-2">
            <input placeholder="HA user_id" value={newForm.ha_user_id}
              onChange={(e) => setNewForm({ ...newForm, ha_user_id: e.target.value })}
              className="border rounded px-2 py-1 text-sm" />
            <input placeholder="Naam" value={newForm.display_name}
              onChange={(e) => setNewForm({ ...newForm, display_name: e.target.value })}
              className="border rounded px-2 py-1 text-sm" />
            <select value={newForm.role} onChange={(e) => setNewForm({ ...newForm, role: e.target.value as Role })}
              className="border rounded px-2 py-1 text-sm bg-white">
              {(Object.keys(ROLE_LABELS) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </select>
            <input placeholder="E-mail (optioneel)" value={newForm.email}
              onChange={(e) => setNewForm({ ...newForm, email: e.target.value })}
              className="border rounded px-2 py-1 text-sm" />
            <input placeholder="HA notify service" value={newForm.ha_notify_service}
              onChange={(e) => setNewForm({ ...newForm, ha_notify_service: e.target.value })}
              className="col-span-2 border rounded px-2 py-1 text-sm" />
          </div>
          <div className="flex gap-2">
            <button onClick={createUser} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm">Opslaan</button>
            <button onClick={() => setShowNew(false)} className="border px-3 py-1.5 rounded-lg text-sm text-gray-600">Annuleren</button>
          </div>
        </div>
      )}

      {loading ? <p className="text-gray-400 text-sm">Laden...</p> : (
        <div className="divide-y divide-gray-100">
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
                        className="border rounded px-2 py-1 text-sm bg-white">
                        {(Object.keys(ROLE_LABELS) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                    ) : (
                      <span className="border rounded px-2 py-1 text-sm bg-gray-50 text-gray-500">{ROLE_LABELS[user.role]}</span>
                    )}
                    <input value={editForm.email || ""} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                      placeholder="E-mail" className="border rounded px-2 py-1 text-sm" />
                    <input value={editForm.ha_notify_service || ""} onChange={(e) => setEditForm({ ...editForm, ha_notify_service: e.target.value })}
                      placeholder="Notify service" className="border rounded px-2 py-1 text-sm" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => saveEdit(user.ha_user_id)} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm">Opslaan</button>
                    <button onClick={() => setEditing(null)} className="border px-3 py-1.5 rounded-lg text-sm text-gray-600">Annuleren</button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <p className="font-medium text-sm">{user.display_name}</p>
                    <p className="text-xs text-gray-400">{user.ha_user_id}</p>
                    <div className="flex gap-1.5 mt-1">
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">{ROLE_LABELS[user.role]}</span>
                      {user.department && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{DEPT_LABELS[user.department]}</span>}
                    </div>
                  </div>
                  <div className="flex gap-3 text-sm">
                    <button onClick={() => { setEditing(user.ha_user_id); setEditForm({ ...user }); }} className="text-blue-600 hover:underline">Bewerken</button>
                    {isAdmin && <button onClick={() => deleteUser(user.ha_user_id)} className="text-red-600 hover:underline">Verwijderen</button>}
                  </div>
                </div>
              )}
            </div>
          ))}
          {users.length === 0 && <p className="py-4 text-center text-gray-500 text-sm italic">Nog geen medewerkers</p>}
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

  useEffect(() => {
    poolApi.getConfigs().then((r) => {
      setConfigs(r.data);
      const vals: Record<string, Partial<PoolConfigItem>> = {};
      for (const c of r.data) vals[c.pool_id] = { ...c };
      setEditValues(vals);
    }).finally(() => setLoading(false));
  }, []);

  function setField(poolId: string, key: string, val: string) {
    setEditValues((v) => ({ ...v, [poolId]: { ...v[poolId], [key]: val || null } }));
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

  if (loading) return <p className="text-gray-400 text-sm">Laden...</p>;

  return (
    <>
      {configs.map((cfg) => {
        const vals = editValues[cfg.pool_id] || {};
        const isZwembad = cfg.pool_id === "zwembad";
        return (
          <Section key={cfg.pool_id} title={`${cfg.label} — configuratie`}>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Naam</label>
                <input type="text" value={vals.label ?? ""} onChange={(e) => setField(cfg.pool_id, "label", e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {isZwembad ? "NFC tag ID — filter links" : "NFC tag ID — filter"}
                </label>
                <input type="text" value={vals.filter_nfc_tag_id ?? ""} placeholder="bijv. 04:A2:F3:1A:..."
                  onChange={(e) => setField(cfg.pool_id, "filter_nfc_tag_id", e.target.value)}
                  className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-300" />
              </div>
              {isZwembad && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">NFC tag ID — filter rechts</label>
                  <input type="text" value={vals.filter_nfc_tag_id_r ?? ""} placeholder="bijv. 04:B7:E1:2C:..."
                    onChange={(e) => setField(cfg.pool_id, "filter_nfc_tag_id_r", e.target.value)}
                    className="w-full border rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-300" />
                </div>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => handleSave(cfg.pool_id)} disabled={saving === cfg.pool_id}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {saving === cfg.pool_id ? "Opslaan..." : "Opslaan"}
              </button>
              {success === cfg.pool_id && <span className="text-sm text-green-600">✓ Opgeslagen</span>}
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
      <p className="text-sm text-gray-500">Importeer historische metingen uit een CSV-bestand (;-gescheiden). Duplicaten worden overgeslagen.</p>
      <div className="flex gap-3 items-end flex-wrap">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Bad</label>
          <select value={poolId} onChange={(e) => setPoolId(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
            <option value="wellness">Wellness</option>
            <option value="zwembad">Zwembad</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">CSV-bestand</label>
          <input type="file" accept=".csv,.txt" className="text-sm" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </div>
        <button onClick={handleImport} disabled={!file || importing}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
          {importing ? "Importeren..." : "Importeren"}
        </button>
      </div>
      {result && <p className={`text-sm ${result.includes("mislukt") ? "text-red-600" : "text-green-700"}`}>{result}</p>}
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
    <div className="bg-white rounded-2xl shadow p-5 border border-red-200 space-y-4">
      <h2 className="font-bold text-base text-red-700">Logboek resetten</h2>
      <p className="text-sm text-gray-500">Verwijder alle metingen uit het logboek. Dit kan niet ongedaan gemaakt worden.</p>
      <div className="flex gap-3 items-end flex-wrap">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Bad</label>
          <select value={poolId} onChange={(e) => { setPoolId(e.target.value); setConfirming(false); }} className="border rounded-lg px-3 py-2 text-sm">
            <option value="">Alle baden</option>
            <option value="wellness">Wellness</option>
            <option value="zwembad">Zwembad</option>
          </select>
        </div>
        {!confirming ? (
          <button onClick={() => setConfirming(true)} className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-700">Resetten</button>
        ) : (
          <div className="flex gap-2 items-center">
            <span className="text-red-600 text-sm font-medium">Weet je het zeker?</span>
            <button onClick={handleReset} disabled={deleting} className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700 disabled:opacity-50">
              {deleting ? "Verwijderen..." : "Ja, verwijder alles"}
            </button>
            <button onClick={() => setConfirming(false)} className="border px-4 py-2 rounded-lg text-sm hover:bg-gray-50">Annuleren</button>
          </div>
        )}
      </div>
      {result && <p className={`text-sm ${result.includes("mislukt") ? "text-red-600" : "text-orange-600"}`}>{result}</p>}
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

  if (loading) return <p className="text-gray-400 text-sm">Laden...</p>;

  return (
    <Section title="Module-zichtbaarheid">
      <p className="text-sm text-gray-500">Bepaal welke medewerkers de fietsenmodule in het menu kunnen zien.</p>
      <div className="space-y-2">
        {BIKES_ROLES_OPTIONS.map((opt) => (
          <label key={opt.value} className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
            currentRoles === opt.value ? "border-blue-500 bg-blue-50" : "border-gray-200 hover:border-gray-300"
          }`}>
            <input type="radio" name="bikes_roles" value={opt.value} checked={currentRoles === opt.value}
              onChange={() => save(opt.value)} disabled={saving} className="mt-0.5 accent-blue-600" />
            <div>
              <p className="font-medium text-sm">{opt.label}</p>
              <p className="text-xs text-gray-500">{opt.description}</p>
            </div>
          </label>
        ))}
      </div>
      {saving && <p className="text-sm text-gray-400">Opslaan...</p>}
      {saved && <p className="text-sm text-green-600">✓ Opgeslagen</p>}
    </Section>
  );
}

function FietsenExcelPanel() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ ok: boolean; imported: number; skipped: number; errors: string[] } | null>(null);
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

  async function resetImport() {
    if (!window.confirm("Import-vlag resetten zodat je opnieuw kunt importeren?")) return;
    try {
      await bikeAdminApi.resetImport();
      setImportResult(null); setImportError(null);
      alert("Reset gelukt.");
    } catch { setImportError("Reset mislukt"); }
  }

  return (
    <Section title="Historische data importeren (Excel)">
      <p className="text-sm text-gray-500">Upload een Excel-bestand in het Fietsverhuur-formaat om historische reserveringen te importeren. Kan slechts één keer; gebruik reset om opnieuw te importeren.</p>
      <div className="flex flex-wrap gap-3 items-center">
        <input ref={fileInputRef} type="file" accept=".xlsx" onChange={handleUpload} className="hidden" id="excel-upload" />
        <label htmlFor="excel-upload" className={`cursor-pointer bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors ${importing ? "opacity-50 pointer-events-none" : ""}`}>
          {importing ? "Importeren..." : "📂 Excel uploaden"}
        </label>
        <button onClick={resetImport} className="text-sm text-gray-400 hover:text-red-600 underline">Reset import-vlag</button>
      </div>
      {importResult && (
        <div className="bg-green-50 rounded-lg p-3 text-sm text-green-800">
          ✓ <strong>{importResult.imported}</strong> reserveringen geïmporteerd, <strong>{importResult.skipped}</strong> overgeslagen.
          {importResult.errors.length > 0 && (
            <ul className="mt-2 text-xs text-orange-700 space-y-0.5">{importResult.errors.map((e, i) => <li key={i}>⚠ {e}</li>)}</ul>
          )}
        </div>
      )}
      {importError && <p className="text-sm text-red-600">{importError}</p>}
    </Section>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// HOOFD COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

export default function Instellingen() {
  const [tab, setTab] = useState<Tab>("systeem");
  const [me, setMe] = useState<UserRole | null>(null);

  useEffect(() => {
    userApi.me().then((r) => setMe(r.data)).catch(() => {});
  }, []);

  const isAdmin = me?.role === "admin" || me?.role === "supervisor";

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "systeem", label: "Systeem", icon: "🏠" },
    { id: "zwembaden", label: "Zwembaden", icon: "🏊" },
    { id: "fietsen", label: "Fietsen", icon: "🚲" },
  ];

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Instellingen</h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
        {tabs.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === t.id ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"
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
        </div>
      )}
    </div>
  );
}
