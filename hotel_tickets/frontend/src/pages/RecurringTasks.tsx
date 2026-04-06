import { useEffect, useState } from "react";
import { recurringApi, type RecurringTemplate, type Category, type Priority } from "../api/client";
import RecurrenceEditor, { cronToHuman } from "../components/RecurrenceEditor";
import AreaSelector from "../components/AreaSelector";
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
};

export default function RecurringTasks() {
  const [templates, setTemplates] = useState<RecurringTemplate[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  useEffect(() => {
    recurringApi.list().then((r) => setTemplates(r.data)).finally(() => setLoading(false));
  }, []);

  function resetForm() {
    setForm({ ...EMPTY_FORM });
    setEditId(null);
    setShowForm(false);
  }

  async function saveTemplate() {
    if (!form.title.trim()) return;
    const payload = { ...form, nfc_tag_id: form.nfc_tag_id || null };
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
                <option value="technical">Technisch</option>
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

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Locatie</label>
            <AreaSelector value={form.location_id} onChange={(id) => setForm({ ...form, location_id: id })} />
          </div>

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
            <p className="text-xs text-gray-500 mt-1">
              Koppel een HA NFC-tag aan deze taak. Scannen via de HA-app rondt de taak automatisch af.
            </p>
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
            <div key={t.id} className={`card flex items-center gap-3 ${!t.is_active ? "opacity-60" : ""}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="font-medium">{t.title}</p>
                  {!t.is_active && <span className="badge bg-gray-100 text-gray-500">Inactief</span>}
                  {t.nfc_tag_id && <span className="badge bg-purple-100 text-purple-700">📱 NFC</span>}
                </div>
                <div className="flex gap-1.5 mt-1">
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
          ))}
        </div>
      )}
    </div>
  );
}
