import { useEffect, useState } from "react";
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
  is_active: true,
  nfc_tag_id: "",
  notify_when_free: false,
  subtask_mode: "none" as SubtaskMode,
  subtask_items: [] as string[],
};

export default function RecurringTasks() {
  const [templates, setTemplates] = useState<RecurringTemplate[]>([]);
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [newSubtask, setNewSubtask] = useState("");

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
    const payload = {
      ...form,
      nfc_tag_id: form.nfc_tag_id || null,
      emoji: null,
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
      is_active: template.is_active,
      nfc_tag_id: template.nfc_tag_id || "",
      notify_when_free: template.notify_when_free,
      subtask_mode: template.subtask_mode || "none",
      subtask_items: template.subtask_items || [],
    });
    setEditId(template.id);
    setShowForm(true);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Terugkerende taken</h1>
        <button onClick={() => setShowForm(true)} className="btn-primary">+ Nieuw sjabloon</button>
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
                className={`relative w-10 h-6 rounded-full transition-colors ${form.notify_when_free ? "bg-amber-500" : "bg-gray-200"}`}
              >
                <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${form.notify_when_free ? "left-5" : "left-1"}`} />
              </button>
              <label className="text-sm text-gray-700">🔑 Meld mij wanneer de kamer vrij is</label>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Schema</label>
            <RecurrenceEditor
              value={form.cron_expression}
              onChange={(cron) => setForm({ ...form, cron_expression: cron })}
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
      ) : (
        <div className="space-y-3">
          {templates.length === 0 && (
            <div className="card py-12 text-center text-gray-500">
              Geen terugkerende taken. Maak een sjabloon aan.
            </div>
          )}
          {templates.map((t) => (
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
                    <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">🔁 {cronToHuman(t.cron_expression)}</span>
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
}
