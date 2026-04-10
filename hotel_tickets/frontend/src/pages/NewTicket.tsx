import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ticketApi, type Category, type Priority } from "../api/client";
import AreaSelector from "../components/AreaSelector";
import MultiAreaSelector from "../components/MultiAreaSelector";

export default function NewTicket() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "technical" as Category,
    priority: "medium" as Priority,
    location_id: null as string | null,
  });
  const [multiRoom, setMultiRoom] = useState(false);
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
  const [subtaskLabels, setSubtaskLabels] = useState<string[]>([]);
  const [newSubtask, setNewSubtask] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function addSubtask() {
    if (!newSubtask.trim()) return;
    setSubtaskLabels((prev) => [...prev, newSubtask.trim()]);
    setNewSubtask("");
  }

  function removeSubtask(idx: number) {
    setSubtaskLabels((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    setError("");
    try {
      const rooms = multiRoom && selectedRooms.length > 0 ? selectedRooms : [form.location_id];
      for (const roomId of rooms) {
        await ticketApi.create({
          ...form,
          location_id: roomId,
          subtask_labels: subtaskLabels.length > 0 ? subtaskLabels : undefined,
        });
      }
      navigate("/tickets");
    } catch {
      setError("Fout bij aanmaken ticket. Probeer opnieuw.");
      setSaving(false);
    }
  }

  const roomCount = multiRoom ? selectedRooms.length : 0;
  const submitLabel = saving
    ? "Aanmaken..."
    : roomCount > 1
    ? `${roomCount} tickets aanmaken`
    : "Ticket aanmaken";

  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-700">←</button>
        <h1 className="text-xl font-bold text-gray-900">Nieuw ticket</h1>
      </div>

      <form onSubmit={submit} className="card space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Titel *</label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Korte omschrijving van het probleem"
            required
            className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Beschrijving</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Meer details..."
            rows={3}
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

        {/* Locatie */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Locatie (kamer/zone)</label>
          <div className="flex gap-2 mb-2">
            <button
              type="button"
              onClick={() => setMultiRoom(false)}
              className={`flex-1 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                !multiRoom ? "border-blue-600 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-600 hover:border-gray-300"
              }`}
            >
              Enkele locatie
            </button>
            <button
              type="button"
              onClick={() => setMultiRoom(true)}
              className={`flex-1 py-1.5 rounded-lg border text-sm font-medium transition-all ${
                multiRoom ? "border-blue-600 bg-blue-50 text-blue-700" : "border-gray-200 text-gray-600 hover:border-gray-300"
              }`}
            >
              Meerdere kamers
            </button>
          </div>
          {multiRoom
            ? <MultiAreaSelector value={selectedRooms} onChange={setSelectedRooms} />
            : <AreaSelector value={form.location_id} onChange={(id) => setForm({ ...form, location_id: id })} />
          }
        </div>

        {/* Subtaken */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Subtaken <span className="text-gray-400 font-normal">(optioneel)</span>
          </label>
          {subtaskLabels.length > 0 && (
            <div className="space-y-1.5 mb-2">
              {subtaskLabels.map((label, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="flex-1 text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-1.5">{label}</span>
                  <button type="button" onClick={() => removeSubtask(idx)} className="text-red-500 hover:text-red-700 text-sm px-1">✕</button>
                </div>
              ))}
            </div>
          )}
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

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex gap-2 pt-2">
          <button type="submit" disabled={saving} className="btn-primary flex-1">
            {submitLabel}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="btn-secondary">
            Annuleren
          </button>
        </div>
      </form>
    </div>
  );
}
