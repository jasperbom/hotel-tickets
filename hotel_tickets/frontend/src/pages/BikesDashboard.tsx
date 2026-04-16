import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { bikeApi, bikeReservationApi, type Bike, type BikeReservation } from "../api/client";

function statusLabel(s: string) {
  if (s === "available") return { label: "Beschikbaar", cls: "bg-green-100 text-green-800" };
  if (s === "maintenance") return { label: "Onderhoud", cls: "bg-orange-100 text-orange-800" };
  return { label: "Buiten gebruik", cls: "bg-gray-100 text-gray-600" };
}

function today() {
  return new Date().toISOString().split("T")[0];
}

function isActive(r: BikeReservation) {
  const t = today();
  return r.status === "active" && r.start_date <= t && r.end_date >= t;
}

function isUpcoming(r: BikeReservation) {
  const t = today();
  return r.status === "active" && r.start_date > t;
}

export default function BikesDashboard() {
  const navigate = useNavigate();
  const [bikes, setBikes] = useState<Bike[]>([]);
  const [reservations, setReservations] = useState<BikeReservation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([bikeApi.list(), bikeReservationApi.list()])
      .then(([b, r]) => {
        setBikes(b.data);
        setReservations(r.data);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="p-4 text-gray-400">Laden...</p>;

  const activeRes = reservations.filter(isActive);
  const upcomingRes = reservations.filter(isUpcoming).slice(0, 8);
  const available = bikes.filter((b) => b.status === "available");
  const inMaintenance = bikes.filter((b) => b.status === "maintenance");
  const retired = bikes.filter((b) => b.status === "retired");

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Fietsen dashboard</h1>
        <button
          onClick={() => navigate("/bikes/reserveringen/nieuw")}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          + Nieuwe reservering
        </button>
      </div>

      {/* Statuscijfers */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-white rounded-2xl shadow p-4 text-center">
          <p className="text-3xl font-bold text-green-600">{available.length}</p>
          <p className="text-sm text-gray-500 mt-1">Beschikbaar</p>
        </div>
        <div className="bg-white rounded-2xl shadow p-4 text-center">
          <p className="text-3xl font-bold text-blue-600">{activeRes.length}</p>
          <p className="text-sm text-gray-500 mt-1">Verhuurd vandaag</p>
        </div>
        <div className="bg-white rounded-2xl shadow p-4 text-center">
          <p className="text-3xl font-bold text-orange-600">{inMaintenance.length}</p>
          <p className="text-sm text-gray-500 mt-1">In onderhoud</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Vandaag actieve reserveringen */}
        <div className="bg-white rounded-2xl shadow p-5">
          <h2 className="text-lg font-bold mb-4">Vandaag verhuurd</h2>
          {activeRes.length === 0 ? (
            <p className="text-gray-400 italic text-sm">Geen actieve verhuur vandaag</p>
          ) : (
            <div className="space-y-3">
              {activeRes.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between p-3 bg-blue-50 rounded-lg cursor-pointer hover:bg-blue-100 transition-colors"
                  onClick={() => navigate(`/bikes/reserveringen/${r.id}`)}
                >
                  <div>
                    <p className="font-medium text-sm">{r.guest_name}</p>
                    <p className="text-xs text-gray-500">
                      {r.guest_room ? `Kamer ${r.guest_room} · ` : ""}
                      {r.num_bikes}× {r.bike_type_name} · t/m {r.end_date}
                    </p>
                  </div>
                  <span className="text-xs text-gray-400">#{r.id}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Aankomende reserveringen */}
        <div className="bg-white rounded-2xl shadow p-5">
          <h2 className="text-lg font-bold mb-4">Aankomend</h2>
          {upcomingRes.length === 0 ? (
            <p className="text-gray-400 italic text-sm">Geen geplande reserveringen</p>
          ) : (
            <div className="space-y-3">
              {upcomingRes.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors"
                  onClick={() => navigate(`/bikes/reserveringen/${r.id}`)}
                >
                  <div>
                    <p className="font-medium text-sm">{r.guest_name}</p>
                    <p className="text-xs text-gray-500">
                      {r.start_date} → {r.end_date} · {r.num_bikes}× {r.bike_type_name}
                    </p>
                  </div>
                  <span className="text-xs text-gray-400">#{r.id}</span>
                </div>
              ))}
            </div>
          )}
          <button
            onClick={() => navigate("/bikes/reserveringen")}
            className="mt-4 text-sm text-blue-600 hover:underline"
          >
            Alle reserveringen →
          </button>
        </div>

        {/* Fietsstatus overzicht */}
        <div className="bg-white rounded-2xl shadow p-5 lg:col-span-2">
          <h2 className="text-lg font-bold mb-4">Fietsen status</h2>
          <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {bikes.map((b) => {
              const s = statusLabel(b.status);
              return (
                <div key={b.id} className="border rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold text-sm">#{b.number}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.cls}`}>
                      {s.label}
                    </span>
                  </div>
                  <p className="text-xs text-gray-600">{b.name}</p>
                  <p className="text-xs text-gray-400">{b.type_name} · {b.total_rental_days}d verhuurd</p>
                </div>
              );
            })}
          </div>
          {inMaintenance.length > 0 && (
            <div className="mt-4 pt-3 border-t border-gray-100">
              <p className="text-xs text-orange-700 font-medium">
                🔧 {inMaintenance.map((b) => `Fiets ${b.number}`).join(", ")} in onderhoud
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
