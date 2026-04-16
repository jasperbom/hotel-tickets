import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { bikeReservationApi, type BikeReservation, type BikeReservationStatus } from "../api/client";

type FilterStatus = BikeReservationStatus | "all";

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  active: { label: "Actief", cls: "bg-blue-100 text-blue-800" },
  completed: { label: "Voltooid", cls: "bg-green-100 text-green-800" },
  cancelled: { label: "Geannuleerd", cls: "bg-red-100 text-red-800" },
};

function today() {
  return new Date().toISOString().split("T")[0];
}

function ReservationRow({ r, onClick }: { r: BikeReservation; onClick: () => void }) {
  const s = STATUS_LABELS[r.status] || { label: r.status, cls: "bg-gray-100 text-gray-600" };
  const t = today();
  const isNow = r.status === "active" && r.start_date <= t && r.end_date >= t;

  return (
    <tr
      className={`border-b hover:bg-gray-50 cursor-pointer transition-colors ${isNow ? "bg-blue-50" : ""}`}
      onClick={onClick}
    >
      <td className="py-3 px-4 text-sm font-medium text-gray-500">#{r.id}</td>
      <td className="py-3 px-4">
        <p className="font-medium text-sm">{r.guest_name}</p>
        {r.guest_room && <p className="text-xs text-gray-400">Kamer {r.guest_room}</p>}
      </td>
      <td className="py-3 px-4 text-sm">
        <p>{r.start_date}</p>
        <p className="text-xs text-gray-400">t/m {r.end_date} ({r.num_days}d)</p>
      </td>
      <td className="py-3 px-4 text-sm">
        {r.num_bikes}× {r.bike_type_name}
      </td>
      <td className="py-3 px-4 text-sm text-right">
        €{r.total_price?.toFixed(2) ?? "-"}
      </td>
      <td className="py-3 px-4">
        <span className={`text-xs px-2 py-1 rounded-full font-medium ${s.cls}`}>{s.label}</span>
      </td>
    </tr>
  );
}

export default function BikeReserveringen() {
  const navigate = useNavigate();
  const [reservations, setReservations] = useState<BikeReservation[]>([]);
  const [filter, setFilter] = useState<FilterStatus>("active");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  function load(f: FilterStatus) {
    setLoading(true);
    bikeReservationApi
      .list(f === "all" ? undefined : f)
      .then((r) => setReservations(r.data))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(filter); }, [filter]);

  const filtered = search
    ? reservations.filter(
        (r) =>
          r.guest_name.toLowerCase().includes(search.toLowerCase()) ||
          (r.guest_room && r.guest_room.includes(search)) ||
          String(r.id).includes(search)
      )
    : reservations;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Reserveringen</h1>
        <button
          onClick={() => navigate("/bikes/reserveringen/nieuw")}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          + Nieuwe reservering
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        {(["active", "completed", "cancelled", "all"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filter === s
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {s === "active" ? "Actief" : s === "completed" ? "Voltooid" : s === "cancelled" ? "Geannuleerd" : "Alles"}
          </button>
        ))}
        <input
          type="text"
          placeholder="Zoek op naam, kamer of #..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-auto border rounded-lg px-3 py-1.5 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
      </div>

      {/* Tabel */}
      <div className="bg-white rounded-2xl shadow overflow-hidden">
        {loading ? (
          <p className="p-6 text-gray-400">Laden...</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-gray-400 italic">Geen reserveringen gevonden</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <tr>
                  <th className="py-3 px-4">#</th>
                  <th className="py-3 px-4">Gast</th>
                  <th className="py-3 px-4">Periode</th>
                  <th className="py-3 px-4">Fietsen</th>
                  <th className="py-3 px-4 text-right">Totaal</th>
                  <th className="py-3 px-4">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <ReservationRow
                    key={r.id}
                    r={r}
                    onClick={() => navigate(`/bikes/reserveringen/${r.id}`)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
