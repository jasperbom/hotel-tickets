import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { recurringApi, locationApi, type RecurringTemplate, type Category, type Priority, type SubtaskMode } from "../api/client";
import RecurrenceEditor, { cronToHuman } from "../components/RecurrenceEditor";
import AreaSelector from "../components/AreaSelector";
import MultiAreaSelector from "../components/MultiAreaSelector";
import { CategoryBadge, PriorityBadge } from "../components/StatusBadge";

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

function folderKey(t: RecurringTemplate): string {
  const f = (t.folder || "").trim();
  return f === "" ? NO_FOLDER_KEY : f;
}

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

  useEffect(() => {
    Promise.all([recurringApi.list(), locationApi.list()])
      .then(([r, locs]) => {
        setTemplates(r.data);
        setLocations(Object.fromEntries(locs.data.map((l) => [l.id, l.name])));
      })
      .finally(() => setLoading(false));
  }, []);

  function resetForm() {
    setForm({ ...EMPTY_FORM });
    setEditId(null);
    setShowForm(false);
    setNewSubtask("");
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

  async function saveTemplate() {
    if (!form.title.trim()) return;
    const payload: Partial<RecurringTemplate> = {
      ...form,
      nfc_tag_id: form.nfc_tag_id || null,
      emoji: null,
      folder: form.folder.trim(),
      subtask_items: form.subtask_items.length > 0 ? form.subtask_items : null,
    };
    if (editId) {
      const r = await recurringApi.update(editId, payload);
      setTemplates((prev) => prev.map((t) => t.id === editId ? r.data : t));
    } else {
      const r = await recurringApi.create(payload);
      setTemplates((prev) => [...prev, r.data]);
    }
    resetForm();
  }

  async function toggleActive(template: RecurringTemplate) {
    const r = await recurringApi.update(template.id, { is_active: !template.is_active });
    setTemplates((prev) => prev.map((t) => t.id === template.id ? r.data : t));
  }

  async function deleteTemplate(id: string) {
    if (!confirm("Sjabloon verwijderen?")) return;
    await recurringApi.remove(id);
    setTemplates((prev) => prev.filter((t) => t.id !== id));
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

  function toggleFolder(key: string) {
    setCollapsedFolders((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Terugkerende taken</h1>
        <button onClick={() => setShowForm(true)} className="btn-primary">+ Nieuw sjabloon</button>
      </div>

      {/* Zoekbalk */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">🔍</span>
        <input
          type="search"
          placeholder="Zoek in taken (titel, omschrijving of map)…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>

      {/* Formulier */}
      {showForm && (
        <div className="card space-y-4">
          <h2 className="font-semibold">{editId ? "Sjabloon bewerken" : "Nieuw sjabloon"}</h2>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Naam *</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Beschrijving</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Map <span className="text-gray-400 font-normal">(optioneel)</span>
            </label>
            <input
              type="text"
              list="folder-suggestions"
              value={form.folder}
              onChange={(e) => setForm({ ...form, folder: e.target.value })}
              placeholder="bijv. Dagelijks, Onderhoud, Schoonmaak..."
              className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <datalist id="folder-suggestions">
              {knownFolders.map((f) => (
                <option key={f} value={f} />
              ))}
            </datalist>
            <p className="text-xs text-gray-500 mt-1">Gebruik mappen om sjablonen te groeperen. Laat leeg voor "Zonder map".</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Categorie</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as Category })}
                className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="technical">TD</option>
                <option value="housekeeping">Huishouding</option>
                <option value="reception">Receptie</option>
                <option value="service">Bediening</option>
                <option value="kitchen">Keuken</option>
                <option value="sales">Sales</option>
                <option value="garden">Tuin</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Prioriteit</label>
              <select
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value as Priority })}
                className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="low">Laag</option>
                <option value="medium">Normaal</option>
                <option value="high">Hoog</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          {/* Subtaken / Kamers switcher */}
          <div className="border border-gray-200 rounded-xl p-4 space-y-3">
            <p className="text-sm font-medium text-gray-700">Type uitvoering</p>
            <div className="grid grid-cols-3 gap-2">
              {([["none", "Enkelvoudig", "📋"], ["subtasks", "Subtaken", "☑️"], ["rooms", "Kamers", "🚪"]] as const).map(([mode, label, icon]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSubtaskMode(mode)}
                  className={`flex flex-col items-center gap-1 py-2 px-2 rounded-xl border-2 text-xs font-medium transition-all ${
                    form.subtask_mode === mode
                      ? "border-blue-600 bg-blue-50 text-blue-700"
                      : "border-gray-200 bg-white text-gray-600 hover:border-gray-300"
                  }`}
                >
                  <span className="text-lg">{icon}</span>
                  {label}
                </button>
              ))}
            </div>

            {form.subtask_mode === "subtasks" && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">Voeg stappen toe die afgevinkt moeten worden</p>
                {form.subtask_items.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="flex-1 text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">{item}</span>
                    <button type="button" onClick={() => removeSubtask(idx)} className="text-red-500 hover:text-red-700 text-sm px-1">✕</button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newSubtask}
                    onChange={(e) => setNewSubtask(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSubtask())}
                    placeholder="bijv. Vloer dweilen..."
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                  />
                  <button type="button" onClick={addSubtask} className="btn-secondary text-sm">+ Toevoegen</button>
                </div>
              </div>
            )}

            {form.subtask_mode === "rooms" && (
              <div className="space-y-2">
                <p className="text-xs text-gray-500">Selecteer de kamers waarvoor deze taak uitgevoerd moet worden</p>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">Locatie</label>
              <AreaSelector value={form.location_id} onChange={(id) => setForm({ ...form, location_id: id })} />
            </div>
          )}

          {/* Kamerpas notificatie */}
          {(form.subtask_mode !== "rooms" && form.location_id) && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setForm({ ...form, notify_when_free: !form.notify_when_free })}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${form.notify_when_free ? "bg-amber-500" : "bg-gray-200"}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.notify_when_free ? "translate-x-5" : "translate-x-0"}`} />
              </button>
              <label className="text-sm text-gray-700">🔑 Meld mij wanneer de kamer vrij is</label>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Schema</label>
            <RecurrenceEditor
              value={form.cron_expression}
              intervalDays={form.interval_days}
              onChange={(cron, intervalDays) => setForm({ ...form, cron_expression: cron, interval_days: intervalDays })}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">NFC-tag ID <span className="text-gray-400 font-normal">(optioneel)</span></label>
            <input
              type="text"
              value={form.nfc_tag_id}
              onChange={(e) => setForm({ ...form, nfc_tag_id: e.target.value })}
              placeholder="bijv. abc123-def456-..."
              className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
            />
          </div>

          <div className="flex gap-2">
            <button onClick={saveTemplate} className="btn-primary">Opslaan</button>
            <button onClick={resetForm} className="btn-secondary">Annuleren</button>
          </div>
        </div>
      )}

      {/* Lijst */}
      {loading ? (
        <div className="flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : templates.length === 0 ? (
        <div className="card py-12 text-center text-gray-500">
          Geen terugkerende taken. Maak een sjabloon aan.
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="card py-12 text-center text-gray-500">
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
                  className="w-full flex items-center gap-2 px-2 py-1 text-left hover:bg-gray-50 rounded-lg"
                >
                  <span className={`text-gray-500 transition-transform ${collapsed ? "" : "rotate-90"}`}>▶</span>
                  <span className="text-lg shrink-0">{isNoFolder ? "📋" : "📁"}</span>
                  <span className={`font-semibold ${isNoFolder ? "text-gray-500 italic" : "text-gray-800"}`}>
                    {group.label}
                  </span>
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                    {group.templates.length}
                  </span>
                </button>
                {!collapsed && (
                  <div className="space-y-3 pl-2">
                    {group.templates.map((t) => (
                      <div key={t.id} className={`card overflow-hidden ${!t.is_active ? "opacity-60" : ""}`}>
                        {/* Blauwe kamer-bar */}
                        {t.location_id && locations[t.location_id] && t.subtask_mode !== "rooms" && (
                          <div className="flex items-center gap-3 bg-blue-600 text-white px-4 py-2 -mx-4 -mt-4 mb-3" style={{ marginLeft: "-1rem", marginRight: "-1rem", marginTop: "-1rem", width: "calc(100% + 2rem)" }}>
                            <span className="text-lg">🚪</span>
                            <span className="font-bold tracking-wide">{locations[t.location_id]}</span>
                          </div>
                        )}
                        {t.subtask_mode === "rooms" && t.subtask_items && t.subtask_items.length > 0 && (
                          <div className="flex items-center gap-3 bg-blue-600 text-white px-4 py-2 -mx-4 -mt-4 mb-3" style={{ marginLeft: "-1rem", marginRight: "-1rem", marginTop: "-1rem", width: "calc(100% + 2rem)" }}>
                            <span className="text-lg">🚪</span>
                            <span className="font-bold tracking-wide">{t.subtask_items.length} kamers</span>
                          </div>
                        )}
                        <div className="flex items-center gap-3">
                          <span className="text-2xl shrink-0">🔁</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Link to={`/recurring/${t.id}`} className="font-medium hover:text-blue-600">{t.title}</Link>
                              {!t.is_active && <span className="badge bg-gray-100 text-gray-500">Inactief</span>}
                              {t.nfc_tag_id && <span className="text-xs font-mono bg-purple-100 text-purple-700 px-1 py-0.5 rounded">NFC</span>}
                              {t.subtask_mode === "subtasks" && <span className="badge bg-blue-50 text-blue-600">☑️ Subtaken</span>}
                              {t.subtask_mode === "rooms" && <span className="badge bg-blue-50 text-blue-600">🚪 Kamers</span>}
                            </div>
                            <div className="flex gap-1.5 mt-1 flex-wrap items-center">
                              <CategoryBadge category={t.category} />
                              <PriorityBadge priority={t.priority} />
                              <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">🔁 {cronToHuman(t.cron_expression, t.interval_days)}</span>
                            </div>
                          </div>
                          <div className="flex gap-2 shrink-0">
                            <button onClick={() => toggleActive(t)} className="text-sm text-gray-500 hover:text-gray-700">
                              {t.is_active ? "Pauzeren" : "Activeren"}
                            </button>
                            <button onClick={() => startEdit(t)} className="text-sm text-blue-600 hover:text-blue-700">
                              Bewerken
                            </button>
                            <button onClick={() => deleteTemplate(t.id)} className="text-sm text-red-600 hover:text-red-700">
                              Verwijderen
                            </button>
                          </div>
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
