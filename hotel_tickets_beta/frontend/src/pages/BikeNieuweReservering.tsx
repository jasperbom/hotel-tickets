import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { bikeApi, bikeReservationApi, formatDateNL, type BikeType, type BikeAvailability } from "../api/client";

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}

export default function BikeNieuweReservering() {
  const navigate = useNavigate();
  const [bikeTypes, setBikeTypes] = useState<BikeType[]>([]);
  const [form, setForm] = useState({
    guest_name: "",
    guest_room: "",
    start_date: new Date().toISOString().split("T")[0],
    num_days: 1,
    num_bikes: 1,
    bike_type_id: 0,
    notes: "",
  });
  const [availability, setAvailability] = useState<BikeAvailability | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    bikeApi.listTypes().then((r) => {
      setBikeTypes(r.data);
      if (r.data.length > 0) {
        setForm((f) => ({ ...f, bike_type_id: r.data[0].id }));
      }
    });
  }, []);

  // Check beschikbaarheid zodra datumvelden veranderen
  useEffect(() => {
    if (!form.bike_type_id || form.num_days < 1 || form.num_bikes < 1) {
      setAvailability(null);
      return;
    }
    const t = setTimeout(() => {
      setChecking(true);
      bikeApi
        .checkAvailability({
          start_date: form.start_date,
          num_days: form.num_days,
          type_id: form.bike_type_id,
          count: form.num_bikes,
        })
        .then((r) => setAvailability(r.data))
        .finally(() => setChecking(false));
    }, 400);
    return () => clearTimeout(t);
  }, [form.start_date, form.num_days, form.num_bikes, form.bike_type_id]);

  function set(key: string, value: string | number) {
    setForm((f) => ({ ...f, [key]: value }));
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.guest_name.trim()) { setError("Vul de gastnaam in"); return; }
    if (!availability?.available) { setError("Niet genoeg fietsen beschikbaar voor deze periode"); return; }

    setSubmitting(true);
    try {
      const res = await bikeReservationApi.create({
        guest_name: form.guest_name.trim(),
        guest_room: form.guest_room.trim() || undefined,
        start_date: form.start_date,
        num_days: form.num_days,
        num_bikes: form.num_bikes,
        bike_type_id: form.bike_type_id,
        notes: form.notes.trim() || undefined,
      });
      navigate(`/bikes/reserveringen/${res.data.id}`);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Er ging iets mis. Probeer opnieuw.");
    } finally {
      setSubmitting(false);
    }
  }

  const endDate = form.num_days >= 1 ? addDays(form.start_date, form.num_days - 1) : form.start_date;
  const selectedType = bikeTypes.find((t) => t.id === form.bike_type_id);
  const estimatedPrice = selectedType
    ? (selectedType.price_per_day * form.num_days * form.num_bikes).toFixed(2)
    : null;

  return (
    <div className="max-w-xl">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="text-gray-400 hover:text-gray-600 text-xl">←</button>
        <h1 className="text-2xl font-bold">Nieuwe reservering</h1>
      </div>

      <form onSubmit={submit} className="bg-white rounded-2xl shadow p-6 space-y-5">
        {/* Gast */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Gastnaam *</label>
          <input
            type="text"
            value={form.guest_name}
            onChange={(e) => set("guest_name", e.target.value)}
            placeholder="Bijv. Familie Jansen"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Kamernummer</label>
          <input
            type="text"
            value={form.guest_room}
            onChange={(e) => set("guest_room", e.target.value)}
            placeholder="Bijv. 204"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
          />
        </div>

        {/* Datum & duur */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Startdatum *</label>
            <input
              type="date"
              value={form.start_date}
              onChange={(e) => set("start_date", e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Aantal dagen *</label>
            <input
              type="number"
              min={1}
              value={form.num_days}
              onChange={(e) => set("num_days", parseInt(e.target.value) || 1)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
        </div>
        {form.num_days >= 1 && (
          <p className="text-xs text-gray-500 -mt-3">
            Retourdatum: <strong>{formatDateNL(endDate)}</strong>
          </p>
        )}

        {/* Fietstype & aantal */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Fietstype *</label>
            <select
              value={form.bike_type_id}
              onChange={(e) => set("bike_type_id", parseInt(e.target.value))}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            >
              {bikeTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} (€{t.price_per_day}/dag)
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Aantal fietsen *</label>
            <input
              type="number"
              min={1}
              value={form.num_bikes}
              onChange={(e) => set("num_bikes", parseInt(e.target.value) || 1)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
        </div>

        {/* Beschikbaarheid indicator */}
        {checking && (
          <p className="text-sm text-gray-400">Beschikbaarheid controleren...</p>
        )}
        {!checking && availability && (
          <div className={`rounded-lg p-3 text-sm ${availability.available ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
            {availability.available
              ? `✓ ${availability.available_count} fiets(en) beschikbaar — toegewezen: ${availability.bikes.map((b) => `#${b.number}`).join(", ")}`
              : `✗ Niet genoeg beschikbaar: ${availability.available_count} van ${form.num_bikes} gevraagd`}
          </div>
        )}

        {/* Prijs indicatie */}
        {estimatedPrice && (
          <div className="bg-gray-50 rounded-lg p-3 text-sm">
            <span className="text-gray-600">Geschatte totaalprijs: </span>
            <span className="font-bold">€{estimatedPrice}</span>
          </div>
        )}

        {/* Notities */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notities</label>
          <textarea
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            rows={2}
            placeholder="Optionele opmerkingen..."
            className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 resize-none"
          />
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex-1 border rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            Annuleren
          </button>
          <button
            type="submit"
            disabled={submitting || !availability?.available}
            className="flex-1 bg-blue-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Opslaan..." : "Reservering aanmaken"}
          </button>
        </div>
      </form>
    </div>
  );
}
