import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { bikeReservationApi, formatDateNL, type BikeReservation } from "../api/client";

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  active: { label: "Actief", cls: "bg-blue-100 text-blue-800" },
  completed: { label: "Voltooid", cls: "bg-green-100 text-green-800" },
  cancelled: { label: "Geannuleerd", cls: "bg-red-100 text-red-800" },
};

export default function BikeReserveringDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [res, setRes] = useState<BikeReservation | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ guest_name: "", guest_room: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    bikeReservationApi
      .get(parseInt(id))
      .then((r) => {
        setRes(r.data);
        setForm({
          guest_name: r.data.guest_name,
          guest_room: r.data.guest_room || "",
          notes: r.data.notes || "",
        });
      })
      .finally(() => setLoading(false));
  }, [id]);

  async function save() {
    if (!res) return;
    setSaving(true);
    try {
      const updated = await bikeReservationApi.update(res.id, {
        guest_name: form.guest_name.trim(),
        guest_room: form.guest_room.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      setRes(updated.data);
      setEditing(false);
    } catch {
      setError("Opslaan mislukt");
    } finally {
      setSaving(false);
    }
  }

  async function cancel() {
    if (!res || !window.confirm("Reservering annuleren?")) return;
    setCancelling(true);
    try {
      await bikeReservationApi.cancel(res.id);
      setRes((r) => r ? { ...r, status: "cancelled" } : r);
    } catch {
      setError("Annuleren mislukt");
    } finally {
      setCancelling(false);
    }
  }

  async function markCompleted() {
    if (!res) return;
    try {
      const updated = await bikeReservationApi.update(res.id, { status: "completed" } as unknown as Partial<BikeReservation>);
      setRes(updated.data);
    } catch {
      setError("Status wijzigen mislukt");
    }
  }

  if (loading) return <p className="p-4 text-gray-400">Laden...</p>;
  if (!res) return <p className="p-4 text-red-500">Reservering niet gevonden</p>;

  const s = STATUS_LABELS[res.status] || { label: res.status, cls: "bg-gray-100 text-gray-600" };

  return (
    <div className="max-w-lg">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-600 text-xl">←</button>
        <h1 className="text-2xl font-bold">Reservering #{res.id}</h1>
        <span className={`ml-auto text-sm px-3 py-1 rounded-full font-medium ${s.cls}`}>{s.label}</span>
      </div>

      <div className="bg-white rounded-2xl shadow p-6 space-y-4">
        {/* Gast info */}
        {editing ? (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Gastnaam</label>
              <input
                type="text"
                value={form.guest_name}
                onChange={(e) => setForm((f) => ({ ...f, guest_name: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Kamernummer</label>
              <input
                type="text"
                value={form.guest_room}
                onChange={(e) => setForm((f) => ({ ...f, guest_room: e.target.value }))}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notities</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
                className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
              />
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500 block text-xs mb-0.5">Gast</span>
              <span className="font-medium">{res.guest_name}</span>
            </div>
            {res.guest_room && (
              <div>
                <span className="text-gray-500 block text-xs mb-0.5">Kamer</span>
                <span className="font-medium">{res.guest_room}</span>
              </div>
            )}
            <div>
              <span className="text-gray-500 block text-xs mb-0.5">Startdatum</span>
              <span className="font-medium">{formatDateNL(res.start_date)}</span>
            </div>
            <div>
              <span className="text-gray-500 block text-xs mb-0.5">Retourdatum</span>
              <span className="font-medium">{formatDateNL(res.end_date)} ({res.num_days}d)</span>
            </div>
            <div>
              <span className="text-gray-500 block text-xs mb-0.5">Fietstype</span>
              <span className="font-medium">{res.num_bikes}× {res.bike_type_name}</span>
            </div>
            <div>
              <span className="text-gray-500 block text-xs mb-0.5">Totaalprijs</span>
              <span className="font-medium">€{res.total_price?.toFixed(2) ?? "-"}</span>
            </div>
          </div>
        )}

        {/* Toegewezen fietsen */}
        {res.bikes.length > 0 && (
          <div className="border-t pt-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-2">Toegewezen fietsen</p>
            <div className="flex flex-wrap gap-2">
              {res.bikes.map((b) => (
                <span key={b.id} className="bg-gray-100 text-gray-700 text-sm px-3 py-1 rounded-full">
                  #{b.number} {b.name}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Notities (niet-bewerkbaar) */}
        {!editing && res.notes && (
          <div className="border-t pt-4">
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wide mb-1">Notities</p>
            <p className="text-sm text-gray-700">{res.notes}</p>
          </div>
        )}

        {error && <p className="text-red-600 text-sm">{error}</p>}

        {/* Acties */}
        {res.status === "active" && (
          <div className="border-t pt-4 flex flex-wrap gap-2">
            {editing ? (
              <>
                <button
                  onClick={save}
                  disabled={saving}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? "Opslaan..." : "Opslaan"}
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="border px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  Annuleren
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => setEditing(true)}
                  className="border px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-50"
                >
                  ✏️ Bewerken
                </button>
                <button
                  onClick={markCompleted}
                  className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700"
                >
                  ✓ Markeer als voltooid
                </button>
                <button
                  onClick={cancel}
                  disabled={cancelling}
                  className="bg-red-100 text-red-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-red-200 disabled:opacity-50"
                >
                  {cancelling ? "Annuleren..." : "✕ Annuleer reservering"}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
