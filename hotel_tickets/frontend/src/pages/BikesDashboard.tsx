import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { bikeApi, bikeReservationApi, type Bike, type BikeReservation } from "../api/client";

const todayStr = () => new Date().toISOString().split("T")[0];

function isActiveToday(r: BikeReservation) {
  const t = todayStr();
  return r.status === "active" && r.start_date <= t && r.end_date >= t;
}
function isUpcoming(r: BikeReservation) {
  return r.status === "active" && r.start_date > todayStr();
}

function BikeCard({ bike, isRented }: { bike: Bike; isRented: boolean }) {
  let badgeClass: string;
  let badgeLabel: string;

  if (bike.status === "maintenance") {
    badgeClass = "bg-orange-100 text-orange-800";
    badgeLabel = "Onderhoud";
  } else if (bike.status === "retired") {
    badgeClass = "bg-gray-100 text-gray-500";
    badgeLabel = "Buiten gebruik";
  } else if (isRented) {
    badgeClass = "bg-green-100 text-green-800";
    badgeLabel = "Verhuurd";
  } else {
    badgeClass = "bg-blue-50 text-blue-700";
    badgeLabel = "Beschikbaar";
  }

  return (
    <div className={`border rounded-xl p-3 ${isRented ? "border-green-200 bg-green-50" : ""}`}>
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold text-sm">#{bike.number}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeClass}`}>
          {badgeLabel}
        </span>
      </div>
      <p className="text-xs text-gray-600 truncate">{bike.name}</p>
      <p className="text-xs text-gray-400">{bike.type_name} · {bike.total_rental_days}d</p>
    </div>
  );
}

export default function BikesDashboard() {
  const navigate = useNavigate();
  const [bikes, setBikes] = useState<Bike[]>([]);
  const [reservations, setReservations] = useState<BikeReservation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([bikeApi.list(), bikeReservationApi.list()])
      .then(([b, r]) => { setBikes(b.data); setReservations(r.data); })
      .finally(() => setLoading(false));
  }, []);

  // Welke bike-IDs zijn vandaag verhuurd
  const rentedTodayIds = useMemo(() => {
    const t = todayStr();
    const ids = new Set<number>();
    for (const r of reservations) {
      if (r.status === "active" && r.start_date <= t && r.end_date >= t) {
        for (const b of r.bikes) ids.add(b.id);
      }
    }
    return ids;
  }, [reservations]);

  const activeRes  = reservations.filter(isActiveToday);
  const upcomingRes = reservations.filter(isUpcoming).slice(0, 8);

  const available     = bikes.filter(b => b.status === "available" && !rentedTodayIds.has(b.id));
  const rentedToday   = bikes.filter(b => b.status === "available" && rentedTodayIds.has(b.id));
  const inMaintenance = bikes.filter(b => b.status === "maintenance");

  // Groepeer fietsen op type voor het overzicht
  const bikeGroups = useMemo(() => {
    const groups = new Map<string, { typeName: string; bikes: Bike[] }>();
    for (const b of bikes) {
      const key = b.type_name || "Overig";
      if (!groups.has(key)) groups.set(key, { typeName: key, bikes: [] });
      groups.get(key)!.bikes.push(b);
    }
    return [...groups.values()];
  }, [bikes]);

  if (loading) return <p className="p-4 text-gray-400">Laden...</p>;

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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-2xl shadow p-4 text-center">
          <p className="text-3xl font-bold text-blue-600">{available.length}</p>
          <p className="text-sm text-gray-500 mt-1">Beschikbaar</p>
        </div>
        <div className="bg-white rounded-2xl shadow p-4 text-center">
          <p className="text-3xl font-bold text-green-600">{rentedToday.length}</p>
          <p className="text-sm text-gray-500 mt-1">Verhuurd vandaag</p>
        </div>
        <div className="bg-white rounded-2xl shadow p-4 text-center">
          <p className="text-3xl font-bold text-orange-600">{inMaintenance.length}</p>
          <p className="text-sm text-gray-500 mt-1">In onderhoud</p>
        </div>
        <div className="bg-white rounded-2xl shadow p-4 text-center">
          <p className="text-3xl font-bold text-purple-600">{upcomingRes.length}</p>
          <p className="text-sm text-gray-500 mt-1">Aankomend</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Vandaag actieve reserveringen */}
        <div className="bg-white rounded-2xl shadow p-5">
          <h2 className="text-lg font-bold mb-4">Vandaag verhuurd</h2>
          {activeRes.length === 0 ? (
            <p className="text-gray-400 italic text-sm">Geen actieve verhuur vandaag</p>
          ) : (
            <div className="space-y-2">
              {activeRes.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between p-3 bg-green-50 rounded-lg cursor-pointer hover:bg-green-100 transition-colors"
                  onClick={() => navigate(`/bikes/reserveringen/${r.id}`)}
                >
                  <div>
                    <p className="font-medium text-sm">{r.guest_name}</p>
                    <p className="text-xs text-gray-500">
                      {r.guest_room ? `Kamer ${r.guest_room} · ` : ""}
                      {r.bikes.map(b => `#${b.number}`).join(", ")} · t/m {r.end_date}
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
            <div className="space-y-2">
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
          <button onClick={() => navigate("/bikes/reserveringen")} className="mt-4 text-sm text-blue-600 hover:underline">
            Alle reserveringen →
          </button>
        </div>

        {/* Fietsstatus per type */}
        <div className="bg-white rounded-2xl shadow p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold">Fietsen status</h2>
            <button onClick={() => navigate("/bikes/tijdlijn")} className="text-sm text-blue-600 hover:underline">
              Tijdlijn bekijken →
            </button>
          </div>
          <div className="space-y-5">
            {bikeGroups.map((group) => (
              <div key={group.typeName}>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{group.typeName}</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                  {group.bikes.map((b) => (
                    <BikeCard key={b.id} bike={b} isRented={rentedTodayIds.has(b.id)} />
                  ))}
                </div>
              </div>
            ))}
          </div>
          {inMaintenance.length > 0 && (
            <div className="mt-4 pt-3 border-t border-gray-100">
              <p className="text-xs text-orange-700 font-medium">
                🔧 {inMaintenance.map(b => `Fiets ${b.number}`).join(", ")} in onderhoud
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
