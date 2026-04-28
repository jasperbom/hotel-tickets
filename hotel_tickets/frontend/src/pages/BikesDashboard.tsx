import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { bikeApi, bikeMaintenanceApi, bikeReservationApi, formatDateNL, type Bike, type BikeMaintenanceConflict, type BikeReservation } from "../api/client";

const todayStr = () => new Date().toISOString().split("T")[0];

function isActiveToday(r: BikeReservation) {
  const t = todayStr();
  return r.status === "active" && r.start_date <= t && r.end_date >= t;
}
function isUpcoming(r: BikeReservation) {
  return r.status === "active" && r.start_date > todayStr();
}

// ── Fiets popup ────────────────────────────────────────────────────────────────

function BikePopup({
  bike,
  todayReservation,
  onClose,
  onDone,
}: {
  bike: Bike;
  todayReservation: BikeReservation | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [view, setView] = useState<"main" | "maintenance">("main");
  const [updating, setUpdating] = useState(false);

  // Maintenance form state
  const today = new Date().toISOString().split("T")[0];
  const [maintForm, setMaintForm] = useState({
    start_date: today,
    expected_end_date: "",
    reason: "",
    notes: "",
    conflict_action: "move" as "move" | "cancel",
  });
  const [conflicts, setConflicts] = useState<BikeMaintenanceConflict[]>([]);
  const [loadingConflicts, setLoadingConflicts] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const keyGiven = !!todayReservation?.key_given_at;
  const keyReturned = !!todayReservation?.key_returned_at;

  async function toggleKeyGiven() {
    if (!todayReservation) return;
    setUpdating(true);
    try {
      await bikeReservationApi.update(todayReservation.id, { key_given: !keyGiven });
      onDone();
    } finally {
      setUpdating(false);
    }
  }

  async function toggleKeyReturned() {
    if (!todayReservation) return;
    setUpdating(true);
    try {
      await bikeReservationApi.update(todayReservation.id, { key_returned: !keyReturned });
      onDone();
    } finally {
      setUpdating(false);
    }
  }

  async function loadConflicts(startDate: string, endDate?: string) {
    setLoadingConflicts(true);
    try {
      const r = await bikeMaintenanceApi.checkConflicts(bike.id, startDate, endDate || undefined);
      setConflicts(r.data);
    } finally {
      setLoadingConflicts(false);
    }
  }

  function openMaintenance() {
    setView("maintenance");
    loadConflicts(maintForm.start_date, maintForm.expected_end_date || undefined);
  }

  async function submitMaintenance() {
    setSubmitting(true);
    setError(null);
    try {
      await bikeMaintenanceApi.start({
        bike_id: bike.id,
        start_date: maintForm.start_date,
        expected_end_date: maintForm.expected_end_date || undefined,
        reason: maintForm.reason.trim() || undefined,
        notes: maintForm.notes.trim() || undefined,
        conflict_action: maintForm.conflict_action,
      });
      onDone();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(msg || "Er ging iets mis");
    } finally {
      setSubmitting(false);
    }
  }

  async function resolveMaintenance() {
    setUpdating(true);
    try {
      await bikeMaintenanceApi.resolve(bike.id);
      onDone();
    } finally {
      setUpdating(false);
    }
  }

  const statusLabel = bike.status === "maintenance" ? "In onderhoud" :
    todayReservation ? "Verhuurd vandaag" : "Beschikbaar";
  const statusColor = bike.status === "maintenance" ? "text-orange-600" :
    todayReservation ? "text-green-600" : "text-blue-600";

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {view === "main" && (
          <>
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold">Fiets #{bike.number}</h2>
                <p className="text-sm text-gray-500">{bike.name}</p>
                <p className={`text-sm font-medium mt-0.5 ${statusColor}`}>{statusLabel}</p>
              </div>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>

            <div className="border-t pt-3 text-sm text-gray-500 space-y-1">
              <div className="flex justify-between">
                <span>Type</span>
                <span className="font-medium text-gray-700">{bike.type_name || "—"}</span>
              </div>
              <div className="flex justify-between">
                <span>Verhuurdagen totaal</span>
                <span className="font-medium text-gray-700">{bike.total_rental_days}d</span>
              </div>
              {bike.is_reserve && (
                <div className="flex justify-between">
                  <span>Reserve fiets</span>
                  <span className="font-medium text-gray-700">Ja</span>
                </div>
              )}
            </div>

            {/* Sleutelbeheer voor vandaag verhuurde fiets */}
            {todayReservation && (
              <div className={`${keyGiven && !keyReturned ? "bg-red-50 border-red-300" : "bg-green-50 border-green-200"} border rounded-xl p-3 space-y-3`}>
                <div>
                  <p className={`text-sm font-semibold ${keyGiven && !keyReturned ? "text-red-800" : "text-green-800"}`}>{todayReservation.guest_name}</p>
                  {todayReservation.guest_room && (
                    <p className={`text-xs ${keyGiven && !keyReturned ? "text-red-600" : "text-green-600"}`}>Kamer {todayReservation.guest_room}</p>
                  )}
                  <p className={`text-xs ${keyGiven && !keyReturned ? "text-red-600" : "text-green-600"}`}>t/m {formatDateNL(todayReservation.end_date)}</p>
                </div>

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Sleutelbeheer</p>
                  <button
                    onClick={toggleKeyGiven}
                    disabled={updating}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      keyGiven
                        ? "bg-green-600 text-white hover:bg-green-700"
                        : "bg-white border border-gray-300 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <span>{keyGiven ? "✓" : "○"}</span>
                    <span>Sleutel uitgegeven</span>
                    {keyGiven && todayReservation.key_given_at && (
                      <span className="ml-auto text-xs opacity-75">
                        {new Date(todayReservation.key_given_at).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={toggleKeyReturned}
                    disabled={updating}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      keyReturned
                        ? "bg-blue-600 text-white hover:bg-blue-700"
                        : "bg-white border border-gray-300 text-gray-600 hover:bg-gray-50"
                    }`}
                  >
                    <span>{keyReturned ? "✓" : "○"}</span>
                    <span>Sleutel teruggekregen</span>
                    {keyReturned && todayReservation.key_returned_at && (
                      <span className="ml-auto text-xs opacity-75">
                        {new Date(todayReservation.key_returned_at).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Onderhoud knop */}
            {bike.status === "available" && (
              <button
                onClick={openMaintenance}
                className="w-full border border-orange-300 text-orange-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-orange-50 transition-colors"
              >
                🔧 Fiets in onderhoud zetten
              </button>
            )}
            {bike.status === "maintenance" && (
              <button
                onClick={resolveMaintenance}
                disabled={updating}
                className="w-full bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {updating ? "Bezig..." : "✓ Onderhoud afronden"}
              </button>
            )}
          </>
        )}

        {view === "maintenance" && (
          <>
            <div className="flex items-center gap-3">
              <button onClick={() => setView("main")} className="text-gray-400 hover:text-gray-600 text-sm">← Terug</button>
              <h2 className="text-lg font-bold">🔧 Onderhoud starten</h2>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Startdatum</label>
                <input
                  type="date"
                  value={maintForm.start_date}
                  onChange={(e) => {
                    setMaintForm((f) => ({ ...f, start_date: e.target.value }));
                    loadConflicts(e.target.value, maintForm.expected_end_date || undefined);
                  }}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Terugkomst</label>
                <input
                  type="date"
                  value={maintForm.expected_end_date}
                  onChange={(e) => {
                    setMaintForm((f) => ({ ...f, expected_end_date: e.target.value }));
                    loadConflicts(maintForm.start_date, e.target.value || undefined);
                  }}
                  className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
                />
              </div>
            </div>

            <input
              type="text"
              value={maintForm.reason}
              onChange={(e) => setMaintForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder="Reden (bijv. lekke band)"
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300"
            />

            {loadingConflicts && <p className="text-xs text-gray-400">Reserveringen controleren...</p>}
            {!loadingConflicts && conflicts.length > 0 && (
              <div className="bg-orange-50 rounded-lg p-3 space-y-2">
                <p className="text-xs font-medium text-orange-800">{conflicts.length} reservering(en) geraakt:</p>
                {conflicts.map((c) => (
                  <p key={c.reservation_id} className="text-xs text-orange-700">
                    {c.guest_name} ({formatDateNL(c.start_date)} → {formatDateNL(c.end_date)})
                    {c.can_move ? ` → fiets #${c.alternative_bike}` : " — ⚠️ geen alternatief"}
                  </p>
                ))}
                <div className="flex gap-3 text-xs pt-1">
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="radio" checked={maintForm.conflict_action === "move"} onChange={() => setMaintForm((f) => ({ ...f, conflict_action: "move" }))} />
                    Verplaats
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input type="radio" checked={maintForm.conflict_action === "cancel"} onChange={() => setMaintForm((f) => ({ ...f, conflict_action: "cancel" }))} />
                    Annuleer
                  </label>
                </div>
              </div>
            )}

            {error && <p className="text-red-600 text-sm">{error}</p>}

            <div className="flex gap-3">
              <button onClick={() => setView("main")} className="flex-1 border rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
                Annuleren
              </button>
              <button
                onClick={submitMaintenance}
                disabled={submitting}
                className="flex-1 bg-orange-600 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-orange-700 disabled:opacity-50"
              >
                {submitting ? "Bezig..." : "Onderhoud starten"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Fiets kaart ────────────────────────────────────────────────────────────────

function BikeCard({
  bike,
  todayReservation,
  onClick,
}: {
  bike: Bike;
  todayReservation: BikeReservation | null;
  onClick: () => void;
}) {
  let badgeClass: string;
  let badgeLabel: string;

  if (bike.status === "maintenance") {
    badgeClass = "bg-orange-100 text-orange-800";
    badgeLabel = "Onderhoud";
  } else if (bike.status === "retired") {
    badgeClass = "bg-gray-100 text-gray-500";
    badgeLabel = "Buiten gebruik";
  } else if (todayReservation) {
    badgeClass = "bg-green-100 text-green-800";
    badgeLabel = "Verhuurd";
  } else {
    badgeClass = "bg-blue-50 text-blue-700";
    badgeLabel = "Beschikbaar";
  }

  const keyGiven = !!todayReservation?.key_given_at;
  const keyReturned = !!todayReservation?.key_returned_at;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left border rounded-xl p-3 transition-all hover:shadow-md active:scale-95 ${
        bike.status === "maintenance"
          ? "border-orange-200 bg-orange-50"
          : keyGiven && !keyReturned
          ? "border-red-200 bg-red-50"
          : todayReservation
          ? "border-green-200 bg-green-50"
          : "border-gray-200 bg-white hover:border-gray-300"
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="font-semibold text-sm">#{bike.number}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badgeClass}`}>
          {badgeLabel}
        </span>
      </div>

      {/* Naam huurder als verhuurd, anders fietsnaam */}
      {todayReservation ? (
        <p className={`text-xs font-medium truncate ${keyGiven && !keyReturned ? "text-red-800" : "text-green-800"}`}>{todayReservation.guest_name}</p>
      ) : (
        <p className="text-xs text-gray-600 truncate">{bike.name}</p>
      )}

      {/* Sleutel status indicatoren */}
      {todayReservation && (
        <div className="flex gap-1 mt-1">
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${keyGiven ? "bg-green-200 text-green-800" : "bg-gray-100 text-gray-500"}`}>
            {keyGiven ? "🔑 Uit" : "🔑 —"}
          </span>
          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${keyReturned ? "bg-blue-200 text-blue-800" : "bg-gray-100 text-gray-500"}`}>
            {keyReturned ? "↩ Terug" : "↩ —"}
          </span>
        </div>
      )}
    </button>
  );
}

// ── Hoofd component ────────────────────────────────────────────────────────────

export default function BikesDashboard() {
  const navigate = useNavigate();
  const [bikes, setBikes] = useState<Bike[]>([]);
  const [reservations, setReservations] = useState<BikeReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedBike, setSelectedBike] = useState<Bike | null>(null);

  function load() {
    Promise.all([bikeApi.list(), bikeReservationApi.list()])
      .then(([b, r]) => { setBikes(b.data); setReservations(r.data); })
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  // Welke bike-IDs zijn vandaag verhuurd + reservering per bike
  const { rentedTodayIds, reservationByBikeId } = useMemo(() => {
    const t = todayStr();
    const ids = new Set<number>();
    const byBike = new Map<number, BikeReservation>();
    for (const r of reservations) {
      if (r.status === "active" && r.start_date <= t && r.end_date >= t) {
        for (const b of r.bikes) {
          ids.add(b.id);
          byBike.set(b.id, r);
        }
      }
    }
    return { rentedTodayIds: ids, reservationByBikeId: byBike };
  }, [reservations]);

  const activeRes  = reservations.filter(isActiveToday);
  const upcomingRes = reservations
    .filter(isUpcoming)
    .sort((a, b) => a.start_date.localeCompare(b.start_date))
    .slice(0, 8);

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

  const selectedReservation = selectedBike ? (reservationByBikeId.get(selectedBike.id) ?? null) : null;

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

      {/* Fietsstatus per type — nu bovenaan */}
      <div className="bg-white rounded-2xl shadow p-5 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold">Fietsen status</h2>
          <button onClick={() => navigate("/bikes/reserveringen")} className="text-sm text-blue-600 hover:underline">
            Reserveringen →
          </button>
        </div>
        <div className="space-y-5">
          {bikeGroups.map((group) => (
            <div key={group.typeName}>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">{group.typeName}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 2xl:grid-cols-10 gap-2">
                {group.bikes.map((b) => (
                  <BikeCard
                    key={b.id}
                    bike={b}
                    todayReservation={reservationByBikeId.get(b.id) ?? null}
                    onClick={() => setSelectedBike(b)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-400 mt-4">Klik op een fiets voor details en sleutelbeheer</p>
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
                      {r.bikes.map(b => `#${b.number}`).join(", ")} · t/m {formatDateNL(r.end_date)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {r.key_given_at && <span className="text-xs text-green-600 font-medium">🔑</span>}
                    {r.key_returned_at && <span className="text-xs text-blue-600 font-medium">↩</span>}
                    <span className="text-xs text-gray-400">#{r.id}</span>
                  </div>
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
                      {formatDateNL(r.start_date)} → {formatDateNL(r.end_date)} · {r.num_bikes}× {r.bike_type_name}
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
      </div>

      {/* Bike popup */}
      {selectedBike && (
        <BikePopup
          bike={selectedBike}
          todayReservation={selectedReservation}
          onClose={() => setSelectedBike(null)}
          onDone={() => { setSelectedBike(null); load(); }}
        />
      )}
    </div>
  );
}
