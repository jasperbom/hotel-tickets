import { useEffect, useState } from "react";
import { bikeApi, bikeAdminApi, bikeMaintenanceApi, type Bike, type BikeType, type BikeMaintenanceConflict } from "../api/client";

type Tab = "fietsen" | "types" | "onderhoud" | "balans";

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  available: { label: "Beschikbaar", cls: "bg-green-100 text-green-800" },
  maintenance: { label: "Onderhoud", cls: "bg-orange-100 text-orange-800" },
  retired: { label: "Buiten gebruik", cls: "bg-gray-100 text-gray-600" },
};

// ── Onderhoud starten modal ────────────────────────────────────────────────────

function MaintenanceModal({
  bike,
  onClose,
  onDone,
}: {
  bike: Bike;
  onClose: () => void;
  onDone: () => void;
}) {
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({
    start_date: today,
    expected_end_date: "",
    reason: "",
    notes: "",
    conflict_action: "move" as "move" | "cancel",
  });
  const [conflicts, setConflicts] = useState<BikeMaintenanceConflict[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    bikeMaintenanceApi
      .checkConflicts(bike.id, form.start_date, form.expected_end_date || undefined)
      .then((r) => setConflicts(r.data))
      .finally(() => setLoading(false));
  }, [bike.id, form.start_date, form.expected_end_date]);

  async function submit() {
    setSubmitting(true);
    try {
      await bikeMaintenanceApi.start({
        bike_id: bike.id,
        start_date: form.start_date,
        expected_end_date: form.expected_end_date || undefined,
        reason: form.reason.trim() || undefined,
        notes: form.notes.trim() || undefined,
        conflict_action: form.conflict_action,
      });
      onDone();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Er ging iets mis");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
        <h2 className="text-lg font-bold">🔧 Onderhoud starten — Fiets #{bike.number}</h2>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Startdatum</label>
            <input
              type="date"
              value={form.start_date}
              onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Verwachte terugkomst</label>
            <input
              type="date"
              value={form.expected_end_date}
              onChange={(e) => setForm((f) => ({ ...f, expected_end_date: e.target.value }))}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
            />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Reden</label>
          <input
            type="text"
            value={form.reason}
            onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
            placeholder="Bijv. kapotte rem, lekke band..."
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notities</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            rows={2}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 resize-none"
          />
        </div>

        {loading && <p className="text-sm text-gray-400">Reserveringen controleren...</p>}
        {!loading && conflicts.length > 0 && (
          <div className="bg-orange-50 rounded-lg p-3">
            <p className="text-sm font-medium text-orange-800 mb-2">
              {conflicts.length} reservering(en) geraakt:
            </p>
            {conflicts.map((c) => (
              <p key={c.reservation_id} className="text-xs text-orange-700">
                #{c.reservation_id} {c.guest_name} ({c.start_date} → {c.end_date})
                {c.can_move ? ` — verplaatsen naar #${c.alternative_bike}` : " — ⚠️ geen alternatief"}
              </p>
            ))}
            <div className="mt-2 flex gap-3 text-sm">
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  checked={form.conflict_action === "move"}
                  onChange={() => setForm((f) => ({ ...f, conflict_action: "move" }))}
                />
                Verplaats naar andere fiets
              </label>
              <label className="flex items-center gap-1 cursor-pointer">
                <input
                  type="radio"
                  checked={form.conflict_action === "cancel"}
                  onChange={() => setForm((f) => ({ ...f, conflict_action: "cancel" }))}
                />
                Annuleer reserveringen
              </label>
            </div>
          </div>
        )}

        <p className="text-xs text-gray-500">
          💡 Er wordt automatisch een ticket aangemaakt voor de technische dienst.
        </p>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button
            onClick={onClose}
            className="flex-1 border rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Annuleren
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="flex-1 bg-orange-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
          >
            {submitting ? "Bezig..." : "Onderhoud starten"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Fietstype rij met inline bewerking ─────────────────────────────────────────

function BikeTypeRow({
  t,
  onSave,
  onDelete,
}: {
  t: BikeType;
  onSave: (id: number, name: string, price: number) => Promise<void>;
  onDelete: (id: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(t.name);
  const [price, setPrice] = useState(t.price_per_day);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      await onSave(t.id, name.trim(), price);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setName(t.name);
    setPrice(t.price_per_day);
    setEditing(false);
  }

  if (editing) {
    return (
      <tr className="border-b bg-blue-50">
        <td className="py-2 px-4">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            autoFocus
          />
        </td>
        <td className="py-2 px-4">
          <div className="flex items-center gap-1">
            <span className="text-sm text-gray-500">€</span>
            <input
              type="number"
              value={price}
              min={0}
              step={0.5}
              onChange={(e) => setPrice(parseFloat(e.target.value) || 0)}
              className="w-24 border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <span className="text-sm text-gray-500">/dag</span>
          </div>
        </td>
        <td className="py-2 px-4 text-gray-500 text-sm">{t.bike_count ?? 0} fietsen</td>
        <td className="py-2 px-4">
          <div className="flex gap-2">
            <button
              onClick={save}
              disabled={saving || !name.trim()}
              className="text-xs bg-blue-600 text-white px-3 py-1 rounded-lg hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "..." : "Opslaan"}
            </button>
            <button
              onClick={cancel}
              className="text-xs text-gray-500 px-3 py-1 rounded-lg border hover:bg-gray-50"
            >
              Annuleer
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b hover:bg-gray-50 group">
      <td className="py-3 px-4 font-medium">{t.name}</td>
      <td className="py-3 px-4">
        <span className="text-lg font-bold text-blue-700">€{t.price_per_day.toFixed(2)}</span>
        <span className="text-xs text-gray-400 ml-1">/dag</span>
      </td>
      <td className="py-3 px-4 text-gray-500 text-sm">{t.bike_count ?? 0} fietsen</td>
      <td className="py-3 px-4">
        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => setEditing(true)}
            className="text-xs text-blue-600 hover:underline"
          >
            Bewerken
          </button>
          {(t.bike_count ?? 0) === 0 && (
            <button
              onClick={() => onDelete(t.id)}
              className="text-xs text-red-500 hover:underline"
            >
              Verwijderen
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Balans tab ─────────────────────────────────────────────────────────────────

function BalansTab({
  bikes,
  onRebalance,
}: {
  bikes: Bike[];
  onRebalance: () => void;
}) {
  const [preview, setPreview] = useState<{ changed: number; total_future: number } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [rebalancing, setRebalancing] = useState(false);
  const [result, setResult] = useState<{ changed: number; total_future: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeBikes = bikes.filter((b) => b.status !== "retired");
  const maxDays = Math.max(...activeBikes.map((b) => b.total_rental_days), 1);

  // Groepeer op type
  const groups = new Map<string, { typeName: string; bikes: Bike[] }>();
  for (const b of activeBikes) {
    const key = b.type_name || "Overig";
    if (!groups.has(key)) groups.set(key, { typeName: key, bikes: [] });
    groups.get(key)!.bikes.push(b);
  }

  async function loadPreview() {
    setPreviewing(true);
    setPreview(null);
    setError(null);
    try {
      const res = await bikeAdminApi.rebalance(true);
      setPreview({ changed: res.data.changed, total_future: res.data.total_future });
    } catch {
      setError("Preview mislukt");
    } finally {
      setPreviewing(false);
    }
  }

  async function doRebalance() {
    if (!window.confirm("Toekomstige reserveringen herbalanceren? Dit herverdeelt de fietsen op basis van het aantal verhuurddagen.")) return;
    setRebalancing(true);
    setResult(null);
    setError(null);
    try {
      const res = await bikeAdminApi.rebalance(false);
      setResult({ changed: res.data.changed, total_future: res.data.total_future });
      setPreview(null);
      onRebalance();
    } catch {
      setError("Herbalanceren mislukt");
    } finally {
      setRebalancing(false);
    }
  }

  const avgDays = activeBikes.length > 0
    ? Math.round(activeBikes.reduce((s, b) => s + b.total_rental_days, 0) / activeBikes.length)
    : 0;

  return (
    <div className="space-y-4">
      {/* Samenvatting */}
      <div className="bg-white rounded-2xl shadow p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="font-bold text-lg">Gebruiksbalans fietsen</h2>
            <p className="text-sm text-gray-500">Gemiddeld: <span className="font-semibold text-gray-700">{avgDays} verhuurdagen</span> per fiets</p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={loadPreview}
              disabled={previewing}
              className="border border-purple-300 text-purple-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-50 disabled:opacity-50 transition-colors"
            >
              {previewing ? "Bezig..." : "🔍 Preview herbalancering"}
            </button>
            <button
              onClick={doRebalance}
              disabled={rebalancing}
              className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors"
            >
              {rebalancing ? "Bezig..." : "⚖️ Herbalanceer"}
            </button>
          </div>
        </div>

        {preview && (
          <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-xl text-sm text-purple-800">
            🔍 <strong>Preview:</strong> {preview.total_future === 0
              ? "Geen toekomstige reserveringen om te herbalanceren."
              : preview.changed === 0
              ? `${preview.total_future} toekomstige reserveringen — al optimaal verdeeld, geen wijzigingen nodig.`
              : `${preview.changed} van ${preview.total_future} toekomstige reserveringen worden opnieuw verdeeld.`}
          </div>
        )}

        {result && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-xl text-sm text-green-800">
            ✓ Herbalancering klaar: {result.changed} van {result.total_future} toekomstige reserveringen opnieuw verdeeld.
          </div>
        )}

        {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

        {/* Balans per type */}
        {[...groups.values()].map((group) => (
          <div key={group.typeName} className="mb-6">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">{group.typeName}</p>
            <div className="space-y-2">
              {group.bikes.sort((a, b) => b.total_rental_days - a.total_rental_days).map((b) => {
                const pct = maxDays > 0 ? (b.total_rental_days / maxDays) * 100 : 0;
                const isAboveAvg = b.total_rental_days > avgDays;
                const barColor = b.status === "maintenance"
                  ? "bg-orange-400"
                  : isAboveAvg ? "bg-blue-500" : "bg-green-500";
                return (
                  <div key={b.id} className="flex items-center gap-3">
                    <div className="w-20 shrink-0 text-sm">
                      <span className="font-medium">#{b.number}</span>
                      {b.is_reserve && <span className="ml-1 text-xs text-gray-400">(R)</span>}
                      {b.status === "maintenance" && <span className="ml-1 text-xs text-orange-500">🔧</span>}
                    </div>
                    <div className="flex-1 bg-gray-100 rounded-full h-4 relative overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${barColor}`}
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                      {/* Gemiddelde indicator */}
                      <div
                        className="absolute top-0 bottom-0 w-0.5 bg-gray-400 opacity-60"
                        style={{ left: `${(avgDays / maxDays) * 100}%` }}
                      />
                    </div>
                    <div className="w-16 text-right text-sm font-medium text-gray-700">
                      {b.total_rental_days}d
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        <div className="flex items-center gap-4 text-xs text-gray-500 pt-2 border-t">
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-blue-500" /> Boven gemiddelde</div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-green-500" /> Onder gemiddelde</div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-full bg-orange-400" /> In onderhoud</div>
          <div className="flex items-center gap-1.5"><div className="w-0.5 h-4 bg-gray-400" /> Gemiddelde</div>
        </div>
      </div>
    </div>
  );
}

// ── Hoofd component ────────────────────────────────────────────────────────────

export default function BikeBeheer() {
  const [tab, setTab] = useState<Tab>("fietsen");
  const [bikes, setBikes] = useState<Bike[]>([]);
  const [types, setTypes] = useState<BikeType[]>([]);
  const [loading, setLoading] = useState(true);
  const [maintenanceBike, setMaintenanceBike] = useState<Bike | null>(null);

  const [newBike, setNewBike] = useState({ number: "", name: "", type_id: 0, is_reserve: false });
  const [newType, setNewType] = useState({ name: "", price_per_day: 0 });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    Promise.all([bikeApi.list(), bikeApi.listTypes()])
      .then(([b, t]) => {
        setBikes(b.data);
        setTypes(t.data);
        if (t.data.length > 0 && !newBike.type_id) {
          setNewBike((f) => ({ ...f, type_id: t.data[0].id }));
        }
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function addBike(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await bikeApi.create({ ...newBike });
      setNewBike({ number: "", name: "", type_id: types[0]?.id || 0, is_reserve: false });
      load();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Aanmaken mislukt");
    } finally {
      setSaving(false);
    }
  }

  async function addType(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await bikeApi.createType(newType);
      setNewType({ name: "", price_per_day: 0 });
      load();
    } catch {
      setError("Aanmaken mislukt");
    } finally {
      setSaving(false);
    }
  }

  async function saveType(id: number, name: string, price: number) {
    await bikeApi.updateType(id, { name, price_per_day: price });
    load();
  }

  async function deleteType(id: number) {
    if (!window.confirm("Fietstype verwijderen?")) return;
    try {
      await bikeApi.deleteType(id);
      load();
    } catch {
      setError("Verwijderen mislukt");
    }
  }

  async function resolveMaintenanceBike(bike: Bike) {
    if (!window.confirm(`Onderhoud van fiets #${bike.number} afronden?`)) return;
    try {
      await bikeMaintenanceApi.resolve(bike.id);
      load();
    } catch {
      setError("Afronden mislukt");
    }
  }

  if (loading) return <p className="p-4 text-gray-400">Laden...</p>;

  const inMaintenance = bikes.filter((b) => b.status === "maintenance");

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Fietsbeheer</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl w-fit">
        {(["fietsen", "types", "balans", "onderhoud"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === t ? "bg-white shadow text-gray-900" : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t === "fietsen" ? "Fietsen"
              : t === "types" ? "Fietstypes"
              : t === "balans" ? "⚖️ Balans"
              : `Onderhoud${inMaintenance.length > 0 ? ` (${inMaintenance.length})` : ""}`}
          </button>
        ))}
      </div>

      {/* Tab: Fietsen */}
      {tab === "fietsen" && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl shadow overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <tr>
                  <th className="py-3 px-4">#</th>
                  <th className="py-3 px-4">Naam</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Reserve</th>
                  <th className="py-3 px-4">Dagen</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {bikes.map((b) => {
                  const s = STATUS_LABELS[b.status];
                  return (
                    <tr key={b.id} className="border-b hover:bg-gray-50">
                      <td className="py-3 px-4 font-medium">{b.number}</td>
                      <td className="py-3 px-4">{b.name}</td>
                      <td className="py-3 px-4 text-gray-500">{b.type_name}</td>
                      <td className="py-3 px-4">{b.is_reserve ? "✓" : ""}</td>
                      <td className="py-3 px-4 text-gray-500">{b.total_rental_days}d</td>
                      <td className="py-3 px-4">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.cls}`}>{s.label}</span>
                      </td>
                      <td className="py-3 px-4">
                        {b.status === "available" && (
                          <button
                            onClick={() => setMaintenanceBike(b)}
                            className="text-xs text-orange-600 hover:underline"
                          >
                            🔧 Onderhoud
                          </button>
                        )}
                        {b.status === "maintenance" && (
                          <button
                            onClick={() => resolveMaintenanceBike(b)}
                            className="text-xs text-green-600 hover:underline"
                          >
                            ✓ Afronden
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Nieuwe fiets */}
          <div className="bg-white rounded-2xl shadow p-5">
            <h2 className="font-bold mb-3">Fiets toevoegen</h2>
            <form onSubmit={addBike} className="grid grid-cols-2 gap-3">
              <input
                type="text"
                placeholder="Nummer (bijv. 21)"
                value={newBike.number}
                onChange={(e) => setNewBike((f) => ({ ...f, number: e.target.value }))}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              <input
                type="text"
                placeholder="Naam (bijv. Gazelle Innergy)"
                value={newBike.name}
                onChange={(e) => setNewBike((f) => ({ ...f, name: e.target.value }))}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              <select
                value={newBike.type_id}
                onChange={(e) => setNewBike((f) => ({ ...f, type_id: parseInt(e.target.value) }))}
                className="border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              >
                {types.map((t) => <option key={t.id} value={t.id}>{t.name} — €{t.price_per_day.toFixed(2)}/dag</option>)}
              </select>
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={newBike.is_reserve}
                  onChange={(e) => setNewBike((f) => ({ ...f, is_reserve: e.target.checked }))}
                />
                Reserve fiets
              </label>
              {error && <p className="col-span-2 text-red-600 text-sm">{error}</p>}
              <button
                type="submit"
                disabled={saving}
                className="col-span-2 bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Toevoegen..." : "Fiets toevoegen"}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Tab: Fietstypes */}
      {tab === "types" && (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl shadow overflow-hidden">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <tr>
                  <th className="py-3 px-4">Naam</th>
                  <th className="py-3 px-4">Prijs per dag</th>
                  <th className="py-3 px-4">Aantal fietsen</th>
                  <th className="py-3 px-4"></th>
                </tr>
              </thead>
              <tbody>
                {types.map((t) => (
                  <BikeTypeRow
                    key={t.id}
                    t={t}
                    onSave={saveType}
                    onDelete={deleteType}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="bg-white rounded-2xl shadow p-5">
            <h2 className="font-bold mb-3">Fietstype toevoegen</h2>
            <form onSubmit={addType} className="flex gap-3">
              <input
                type="text"
                placeholder="Naam (bijv. E-bike)"
                value={newType.name}
                onChange={(e) => setNewType((f) => ({ ...f, name: e.target.value }))}
                className="flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
              <div className="flex items-center gap-1 border rounded-lg px-3 py-2">
                <span className="text-sm text-gray-500">€</span>
                <input
                  type="number"
                  placeholder="0"
                  min={0}
                  step={0.5}
                  value={newType.price_per_day}
                  onChange={(e) => setNewType((f) => ({ ...f, price_per_day: parseFloat(e.target.value) || 0 }))}
                  className="w-20 text-sm focus:outline-none"
                />
                <span className="text-sm text-gray-500">/dag</span>
              </div>
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <button
                type="submit"
                disabled={saving}
                className="bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                Toevoegen
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Tab: Balans */}
      {tab === "balans" && (
        <BalansTab bikes={bikes} onRebalance={load} />
      )}

      {/* Tab: Onderhoud */}
      {tab === "onderhoud" && (
        <div className="bg-white rounded-2xl shadow p-5">
          <h2 className="font-bold mb-4">Fietsen in onderhoud</h2>
          {inMaintenance.length === 0 ? (
            <p className="text-gray-400 italic text-sm">Geen fietsen in onderhoud</p>
          ) : (
            <div className="space-y-3">
              {inMaintenance.map((b) => (
                <div key={b.id} className="flex items-center justify-between p-3 bg-orange-50 rounded-lg">
                  <div>
                    <p className="font-medium text-sm">Fiets #{b.number} — {b.name}</p>
                    <p className="text-xs text-gray-500">{b.type_name}</p>
                  </div>
                  <button
                    onClick={() => resolveMaintenanceBike(b)}
                    className="bg-green-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-green-700"
                  >
                    ✓ Onderhoud afronden
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal */}
      {maintenanceBike && (
        <MaintenanceModal
          bike={maintenanceBike}
          onClose={() => setMaintenanceBike(null)}
          onDone={() => { setMaintenanceBike(null); load(); }}
        />
      )}
    </div>
  );
}
