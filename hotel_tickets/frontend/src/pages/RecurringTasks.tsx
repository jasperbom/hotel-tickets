import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { recurringApi, locationApi, ticketApi, userApi, type RecurringTemplate, type Category, type Priority, type SubtaskMode, type UserRole } from "../api/client";
import { herhaalKort } from "../werk";
import RecurrenceEditor, { cronToHuman } from "../components/RecurrenceEditor";
import AreaSelector from "../components/AreaSelector";
import MultiAreaSelector from "../components/MultiAreaSelector";
import { CategoryBadge, PriorityBadge } from "../components/StatusBadge";
import { BevestigKnop } from "../components/BevestigKnop";

const DEFAULT_CRON = "0 8 * * *";

const EMPTY_FORM = {
  title: "",
  description: "",
  category: "technical" as Category,
  priority: "medium" as Priority,
  location_id: null as string | null,
  cron_expression: DEFAULT_CRON,
  advance_days: 0,
  interval_days: null as number | null,
  is_active: true,
  nfc_tag_id: "",
  notify_when_free: false,
  subtask_mode: "none" as SubtaskMode,
  subtask_items: [] as string[],
  folder: "",
};

const NO_FOLDER_KEY = "__no_folder__";
const NO_FOLDER_LABEL = "Zonder map";

const CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: "technical", label: "TD" },
  { value: "housekeeping", label: "Huishouding" },
  { value: "reception", label: "Receptie" },
  { value: "service", label: "Bediening" },
  { value: "kitchen", label: "Keuken" },
  { value: "sales", label: "Sales" },
  { value: "garden", label: "Tuin" },
];

function folderKey(t: RecurringTemplate): string {
  const f = (t.folder || "").trim();
  return f === "" ? NO_FOLDER_KEY : f;
}

/**
 * Herhalend — twee gezichten, één scherm.
 *
 * Voor een medewerker: een leeslijst van wat er terugkomt, gegroepeerd per
 * herhaalpatroon, met de kamers erbij. Geen afvinkknoppen — dat doe je op
 * Vandaag. Voor een admin: hetzelfde, plus de bewerkvelden en het signaal
 * "overgeslagen": een sjabloon waarvan exemplaren blijven openstaan, is óf
 * onnodig óf er is te weinig personeel.
 */
export default function RecurringTasks() {
  const [templates, setTemplates] = useState<RecurringTemplate[]>([]);
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [newSubtask, setNewSubtask] = useState("");
  const [collapsedFolders, setCollapsedFolders] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [me, setMe] = useState<UserRole | null>(null);
  const [formError, setFormError] = useState("");
  // Open exemplaren per sjabloon: dat is het "overgeslagen"-signaal.
  const [openPerSjabloon, setOpenPerSjabloon] = useState<Record<string, number>>({});
  const [beheerOpen, setBeheerOpen] = useState(false);

  useEffect(() => {
    Promise.allSettled([recurringApi.list(), locationApi.list(), userApi.me()])
      .then(([r, locs, meRes]) => {
        if (r.status === "fulfilled") setTemplates(r.value.data);
        if (locs.status === "fulfilled") {
          setLocations(Object.fromEntries(locs.value.data.map((l) => [l.id, l.name])));
        }
        if (meRes.status === "fulfilled") setMe(meRes.value.data);
      })
      .finally(() => setLoading(false));

    // Openstaande exemplaren tellen: een sjabloon waarvan er meerdere blijven
    // hangen is niet afgevinkt en dat is het signaal dat je hier wil zien.
    ticketApi.list({ status: "open,in_progress" })
      .then((r) => {
        const per: Record<string, number> = {};
        for (const t of r.data) {
          if (!t.recurring_template_id) continue;
          per[t.recurring_template_id] = (per[t.recurring_template_id] ?? 0) + 1;
        }
        setOpenPerSjabloon(per);
      })
      .catch(() => {});
  }, []);

  const isManager = me?.role === "admin" || me?.role === "supervisor";
  // Medewerkers beheren alleen sjablonen van hun eigen afdeling
  const canManage = (category: Category) => isManager || me?.department === category;
  const categoryOptions = isManager || !me?.department
    ? CATEGORY_OPTIONS
    : CATEGORY_OPTIONS.filter((c) => c.value === me.department);

  function openNewForm() {
    // Medewerkers kunnen alleen voor hun eigen afdeling aanmaken — vul die vast in
    const category = !isManager && me?.department ? me.department : EMPTY_FORM.category;
    setForm({ ...EMPTY_FORM, category });
    setEditId(null);
    setFormError("");
    setShowForm(true);
  }

  function resetForm() {
    setForm({ ...EMPTY_FORM });
    setEditId(null);
    setShowForm(false);
    setNewSubtask("");
    setFormError("");
  }

  function setSubtaskMode(mode: SubtaskMode) {
    setForm({ ...form, subtask_mode: mode, subtask_items: [], location_id: mode === "rooms" ? null : form.location_id });
  }

  function addSubtask() {
    if (!newSubtask.trim()) return;
    setForm({ ...form, subtask_items: [...form.subtask_items, newSubtask.trim()] });
    setNewSubtask("");
  }

  function removeSubtask(idx: number) {
    setForm({ ...form, subtask_items: form.subtask_items.filter((_, i) => i !== idx) });
  }

  function apiErrorText(err: unknown): string {
    const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
    return typeof detail === "string" ? detail : "Opslaan mislukt — probeer het opnieuw";
  }

  async function saveTemplate() {
    if (!form.title.trim()) return;
    const payload: Partial<RecurringTemplate> = {
      ...form,
      nfc_tag_id: form.nfc_tag_id || null,
      emoji: null,
      folder: form.folder.trim(),
      subtask_items: form.subtask_items.length > 0 ? form.subtask_items : null,
    };
    setFormError("");
    try {
      if (editId) {
        const r = await recurringApi.update(editId, payload);
        setTemplates((prev) => prev.map((t) => t.id === editId ? r.data : t));
      } else {
        const r = await recurringApi.create(payload);
        setTemplates((prev) => [...prev, r.data]);
      }
      resetForm();
    } catch (err) {
      setFormError(apiErrorText(err));
    }
  }

  async function toggleActive(template: RecurringTemplate) {
    try {
      const r = await recurringApi.update(template.id, { is_active: !template.is_active });
      setTemplates((prev) => prev.map((t) => t.id === template.id ? r.data : t));
    } catch (err) {
      alert(apiErrorText(err));
    }
  }

  async function deleteTemplate(id: string) {
    try {
      await recurringApi.remove(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch (err) {
      alert(apiErrorText(err));
    }
  }

  function startEdit(template: RecurringTemplate) {
    setForm({
      title: template.title,
      description: template.description || "",
      category: template.category,
      priority: template.priority,
      location_id: template.location_id,
      cron_expression: template.cron_expression,
      advance_days: template.advance_days,
      interval_days: template.interval_days,
      is_active: template.is_active,
      nfc_tag_id: template.nfc_tag_id || "",
      notify_when_free: template.notify_when_free,
      subtask_mode: template.subtask_mode || "none",
      subtask_items: template.subtask_items || [],
      folder: template.folder || "",
    });
    setEditId(template.id);
    setFormError("");
    setShowForm(true);
  }

  const knownFolders = Array.from(
    new Set(
      templates
        .map((t) => (t.folder || "").trim())
        .filter((f) => f !== "")
    )
  ).sort((a, b) => a.localeCompare(b, "nl"));

  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return templates;
    return templates.filter((t) =>
      t.title.toLowerCase().includes(q) ||
      (t.description?.toLowerCase().includes(q) ?? false) ||
      (t.folder?.toLowerCase().includes(q) ?? false)
    );
  }, [templates, search]);

  const groupedTemplates = useMemo(() => {
    const groups = new Map<string, RecurringTemplate[]>();
    for (const t of filteredTemplates) {
      const key = folderKey(t);
      const list = groups.get(key) ?? [];
      list.push(t);
      groups.set(key, list);
    }
    const sortedKeys = Array.from(groups.keys()).sort((a, b) => {
      if (a === NO_FOLDER_KEY) return 1;
      if (b === NO_FOLDER_KEY) return -1;
      return a.localeCompare(b, "nl");
    });
    return sortedKeys.map((key) => ({
      key,
      label: key === NO_FOLDER_KEY ? NO_FOLDER_LABEL : key,
      templates: groups.get(key)!,
    }));
  }, [filteredTemplates]);

  /** Leeslijst: gegroepeerd op herhaalpatroon in plaats van op map. */
  const perPatroon = useMemo(() => {
    const groepen = new Map<string, RecurringTemplate[]>();
    for (const t of templates.filter((x) => x.is_active)) {
      const label = herhaalKort(t.cron_expression, t.interval_days) ?? "onbekend";
      const lijst = groepen.get(label) ?? [];
      lijst.push(t);
      groepen.set(label, lijst);
    }
    return [...groepen.entries()]
      .map(([label, lijst]) => ({ label, lijst: lijst.sort((a, b) => a.title.localeCompare(b.title, "nl")) }))
      .sort((a, b) => a.label.localeCompare(b.label, "nl"));
  }, [templates]);

  function kamersVan(t: RecurringTemplate): string {
    const ids = t.subtask_mode === "rooms" && t.subtask_items?.length
      ? t.subtask_items
      : t.location_id ? [t.location_id] : [];
    return ids.map((id) => locations[id] ?? id).join(" · ");
  }

  function toggleFolder(key: string) {
    setCollapsedFolders((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const leeslijst = (
    <div className="space-y-5 max-w-3xl">
      {perPatroon.length === 0 ? (
        <p className="meta">Er komt op dit moment niets terug.</p>
      ) : (
        perPatroon.map((groep) => (
          <section key={groep.label}>
            <p className="mb-2.5 font-mono text-xs uppercase tracking-[0.14em] text-ink-45">{groep.label}</p>
            <ul className="grid gap-2">
              {groep.lijst.map((t) => {
                const blijftLiggen = openPerSjabloon[t.id] ?? 0;
                return (
                  <li key={t.id} className="row min-h-[66px]">
                    <span className="flex-1 min-w-0">
                      <span className="block text-row text-ink">{t.title}</span>
                      <span className="meta">
                        {kamersVan(t) || "geen kamer"}
                        {blijftLiggen > 1 && (
                          <>
                            <span className="text-ink-25"> · </span>
                            <strong className="font-semibold text-high" title="Deze taak wordt herhaaldelijk niet afgerond">
                              {blijftLiggen}× overgeslagen
                            </strong>
                          </>
                        )}
                      </span>
                    </span>
                    {isManager && (
                      <button
                        onClick={() => startEdit(t)}
                        className="shrink-0 h-tap px-3 rounded-[10px] border border-ink-12 text-ink-70 text-meta font-semibold hover:bg-ink-6"
                      >
                        Wijzig
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );

  // Een medewerker ziet alleen wat er terugkomt; instellen is beheerwerk.
  if (!isManager) {
    return (
      <div className="space-y-4">
        <h1 className="hidden md:block text-2xl font-bold text-ink">Herhalend</h1>
        <p className="meta max-w-prose">
          Wat er automatisch terugkomt. Afvinken doe je op Vandaag, zodra de taak
          aan de beurt is.
        </p>
        {leeslijst}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="hidden md:block text-2xl font-bold text-ink">Herhalend</h1>
        <button onClick={openNewForm} className="btn-primary whitespace-nowrap ml-auto">+ Nieuw sjabloon</button>
      </div>

      {!showForm && leeslijst}

      {/* Beheerlijst: dezelfde sjablonen, maar per map en met aan/uit en
          verwijderen. Standaard ingeklapt zodat het scherm niet twee keer
          dezelfde lijst toont. */}
      {!showForm && (
        <button
          onClick={() => setBeheerOpen(!beheerOpen)}
          className="flex items-center gap-2 w-full min-h-tap text-left pt-5 border-t border-ink-12"
        >
          <span className="font-mono text-xs uppercase tracking-[0.14em] text-ink-45">
            Alle sjablonen · mappen, aan/uit, verwijderen
          </span>
          <span className="ml-auto meta">{beheerOpen ? "verbergen" : "tonen"}</span>
        </button>
      )}

      {/* Zoekbalk */}
      <div className={showForm || beheerOpen ? "relative" : "hidden"}>
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-45 pointer-events-none">🔍</span>
        <input
          type="search"
          placeholder="Zoek in taken (titel, omschrijving of map)…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full border border-ink-12 rounded-lg pl-9 pr-3 py-2 text-sm bg-paper-raised focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>

      {/* Formulier */}
      {showForm && (
        <div className="card space-y-4">
          <h2 className="font-semibold">{editId ? "Sjabloon bewerken" : "Nieuw sjabloon"}</h2>

          <div>
            <label className="block text-sm font-medium text-ink-70 mb-1">Naam *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="block w-full border border-ink-12 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-70 mb-1">Beschrijving</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className="block w-full border border-ink-12 rounded-lg px-3 py-2 text-sm resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-70 mb-1">
              Map <span className="text-ink-45 font-normal">(optioneel)</span>
            </label>
            <input
              type="text"
              list="folder-suggestions"
              value={form.folder}
              onChange={(e) => setForm({ ...form, folder: e.target.value })}
              placeholder="bijv. Dagelijks, Onderhoud, Schoonmaak..."
              className="block w-full border border-ink-12 rounded-lg px-3 py-2 text-sm"
            />
            <datalist id="folder-suggestions">
              {knownFolders.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
            <p className="text-xs text-ink-45 mt-1">Gebruik mappen om sjablonen te groeperen. Laat leeg voor "Zonder map".</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-ink-70 mb-1">Categorie</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as Category })}
                className="block w-full border border-ink-12 rounded-lg px-3 py-2 text-sm bg-paper-raised"
              >
                {categoryOptions.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              {!isManager && me?.department && (
                <p className="text-xs text-ink-45 mt-1">Je kunt alleen taken voor je eigen afdeling aanmaken.</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-ink-70 mb-1">Prioriteit</label>
              <select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}
                className="block w-full border border-ink-12 rounded-lg px-3 py-2 text-sm bg-paper-raised"
              >
                <option value="low">Laag</option>
                <option value="medium">Normaal</option>
                <option value="high">Hoog</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          {/* Subtaken / Kamers switcher */}
          <div className="border border-ink-12 rounded-xl p-4 space-y-3">
            <p className="text-sm font-medium text-ink-70">Type uitvoering</p>
            <div className="grid grid-cols-3 gap-2">
              {([["none", "Enkelvoudig", "📋"], ["subtasks", "Subtaken", "☑️"], ["rooms", "Kamers", "🚪"]] as const).map(([mode, label, icon]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSubtaskMode(mode)}
                  className={`flex flex-col items-center gap-1 py-2 px-2 rounded-xl border-2 text-xs font-medium transition-all ${
                    form.subtask_mode === mode
                      ? "border-brand bg-ink-6 text-brand"
                      : "border-ink-12 bg-paper-raised text-ink-70 hover:border-ink-12"
                  }`}
                >
                  <span className="text-lg">{icon}</span>
                  {label}
                </button>
              ))}
            </div>

            {form.subtask_mode === "subtasks" && (
              <div className="space-y-2">
                <p className="text-xs text-ink-45">Voeg stappen toe die afgevinkt moeten worden</p>
                {form.subtask_items.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="flex-1 text-sm bg-ink-6 border border-ink-12 rounded-lg px-3 py-1.5">{item}</span>
                    <button type="button" onClick={() => removeSubtask(idx)} className="text-urgent hover:text-urgent text-sm px-1">✕</button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newSubtask}
                    onChange={(e) => setNewSubtask(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSubtask())}
                    placeholder="bijv. Vloer dweilen..."
                    className="flex-1 border border-ink-12 rounded-lg px-3 py-1.5 text-sm"
                  />
                  <button type="button" onClick={addSubtask} className="btn-secondary text-sm">+ Toevoegen</button>
                </div>
              </div>
            )}

            {form.subtask_mode === "rooms" && (
              <div className="space-y-2">
                <p className="text-xs text-ink-45">Selecteer de kamers waarvoor deze taak uitgevoerd moet worden</p>
                <MultiAreaSelector
                  value={form.subtask_items}
                  onChange={(ids) => setForm({ ...form, subtask_items: ids })}
                />
              </div>
            )}
          </div>

          {/* Locatie — alleen tonen bij enkelvoudig of subtaken */}
          {form.subtask_mode !== "rooms" && (
            <div>
              <label className="block text-sm font-medium text-ink-70 mb-1">Locatie</label>
              <AreaSelector value={form.location_id} onChange={(id) => setForm({ ...form, location_id: id })} />
            </div>
          )}

          {/* Kamerpas notificatie */}
          {(form.subtask_mode !== "rooms" && form.location_id) && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setForm({ ...form, notify_when_free: !form.notify_when_free })}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${form.notify_when_free ? "bg-high-soft0" : "bg-ink-12"}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-paper-raised rounded-full shadow transition-transform ${form.notify_when_free ? "translate-x-5" : "translate-x-0"}`} />
              </button>
              <label className="text-sm text-ink-70">🔑 Meld mij wanneer de kamer vrij is</label>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-ink-70 mb-2">Schema</label>
            <RecurrenceEditor
              value={form.cron_expression}
              intervalDays={form.interval_days}
              onChange={(cron, intervalDays) => setForm({ ...form, cron_expression: cron, interval_days: intervalDays })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-ink-70 mb-1">NFC-tag ID <span className="text-ink-45 font-normal">(optioneel)</span></label>
            <input
              type="text"
              value={form.nfc_tag_id}
              onChange={(e) => setForm({ ...form, nfc_tag_id: e.target.value })}
              placeholder="bijv. abc123-def456-..."
              className="block w-full border border-ink-12 rounded-lg px-3 py-2 text-sm font-mono"
            />
          </div>

          {formError && (
            <div className="flex items-center gap-2 bg-urgent-soft border border-urgent rounded-xl px-4 py-3 text-sm text-urgent">
              <span>⚠</span>
              <p>{formError}</p>
            </div>
          )}

          <div className="flex gap-2">
            <button onClick={saveTemplate} className="btn-primary">Opslaan</button>
            <button onClick={resetForm} className="btn-secondary">Annuleren</button>
          </div>
        </div>
      )}

      {/* Beheerlijst per map */}
      {!showForm && !beheerOpen ? null : loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
        </div>
      ) : templates.length === 0 ? (
        <div className="card py-12 text-center text-ink-45">
          Geen terugkerende taken. Maak een sjabloon aan.
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="card py-12 text-center text-ink-45">
          Geen taken gevonden voor "{search}"
        </div>
      ) : (
        <div className="space-y-5">
          {groupedTemplates.map((group) => {
            const collapsed = !!collapsedFolders[group.key];
            const isNoFolder = group.key === NO_FOLDER_KEY;
            return (
              <div key={group.key} className="space-y-3">
                <button
                  type="button"
                  onClick={() => toggleFolder(group.key)}
                  className="w-full flex items-center gap-2 px-2 py-1 text-left hover:bg-ink-6 rounded-lg"
                >
                  <span className={`text-ink-45 transition-transform ${collapsed ? "" : "rotate-90"}`}>▶</span>
                  <span className="text-lg shrink-0">{isNoFolder ? "📋" : "📁"}</span>
                  <span className={`font-semibold ${isNoFolder ? "text-ink-45 italic" : "text-ink"}`}>
                    {group.label}
                  </span>
                  <span className="text-xs bg-ink-6 text-ink-70 px-2 py-0.5 rounded-full">
                    {group.templates.length}
                  </span>
                </button>
                {!collapsed && (
                  <div className="space-y-3 pl-2">
                    {group.templates.map((t) => (
                      <div key={t.id} className={`card overflow-hidden ${!t.is_active ? "opacity-60" : ""}`}>
                        {/* Blauwe kamer-bar */}
                        {t.location_id && locations[t.location_id] && t.subtask_mode !== "rooms" && (
                          <div className="flex items-center gap-3 bg-brand text-white px-4 py-2 -mx-4 -mt-4 mb-3" style={{ marginLeft: "-1rem", marginRight: "-1rem", marginTop: "-1rem", width: "calc(100% + 2rem)" }}>
                            <span className="text-lg">🚪</span>
                            <span className="font-bold tracking-wide">{locations[t.location_id]}</span>
                          </div>
                        )}
                        {t.subtask_mode === "rooms" && t.subtask_items && t.subtask_items.length > 0 && (
                          <div className="flex items-center gap-3 bg-brand text-white px-4 py-2 -mx-4 -mt-4 mb-3" style={{ marginLeft: "-1rem", marginRight: "-1rem", marginTop: "-1rem", width: "calc(100% + 2rem)" }}>
                            <span className="text-lg">🚪</span>
                            <span className="font-bold tracking-wide">{t.subtask_items.length} kamers</span>
                          </div>
                        )}
                        <div className="flex items-center gap-3">
                          <span className="text-2xl shrink-0">🔁</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Link to={`/recurring/${t.id}`} className="font-medium hover:text-brand">{t.title}</Link>
                              {!t.is_active && <span className="badge bg-ink-6 text-ink-45">Inactief</span>}
                              {t.nfc_tag_id && <span className="text-xs font-mono bg-purple-100 text-purple-700 px-1 py-0.5 rounded">NFC</span>}
                              {t.subtask_mode === "subtasks" && <span className="badge bg-ink-6 text-brand">☑️ Subtaken</span>}
                              {t.subtask_mode === "rooms" && <span className="badge bg-ink-6 text-brand">🚪 Kamers</span>}
                            </div>
                            <div className="flex gap-1.5 mt-1 flex-wrap items-center">
                              <CategoryBadge category={t.category} />
                              <PriorityBadge priority={t.priority} />
                              <span className="text-xs bg-ink-6 text-ink-70 px-1.5 py-0.5 rounded">🔁 {cronToHuman(t.cron_expression, t.interval_days)}</span>
                            </div>
                          </div>
                          {canManage(t.category) && (
                            <div className="flex gap-2 shrink-0">
                              <button onClick={() => toggleActive(t)} className="text-sm text-ink-45 hover:text-ink-70">
                                {t.is_active ? "Pauzeren" : "Activeren"}
                              </button>
                              <button onClick={() => startEdit(t)} className="text-sm text-brand hover:opacity-80">
                                Bewerken
                              </button>
                              <BevestigKnop
                                label="Verwijderen"
                                vraag="Sjabloon verwijderen?"
                                bevestigLabel="Ja, verwijder"
                                onBevestig={() => deleteTemplate(t.id)}
                                className="text-sm text-urgent hover:opacity-80"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
