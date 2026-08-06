import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { bikeApi, bikeReservationApi, formatDateNL, type Bike, type BikeReservation } from "../api/client";

// ── Gedeelde helpers ──────────────────────────────────────────────────────────

type FilterStatus = "planned" | "rented" | "completed" | "cancelled";

interface DisplayStatus {
  label: string;
  cls: string;
}

function localDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function todayDateStr() {
  return localDateStr(new Date());
}

function getDisplayStatus(r: BikeReservation, today: string): DisplayStatus {
  if (r.status === "completed") return { label: "Voltooid", cls: "bg-ink-6 text-ink-70" };
  if (r.status === "cancelled") return { label: "Geannuleerd", cls: "bg-red-100 text-red-800" };
  if (r.start_date > today) return { label: "Gepland", cls: "bg-ink-6 text-brand" };
  return { label: "Verhuurd", cls: "bg-green-100 text-green-800" };
}

// ── Tijdlijn (Gantt) ──────────────────────────────────────────────────────────

const DAY_W = 38;
const LABEL_W = 130;
const MIN_WINDOW_DAYS = 14;
const DEFAULT_WINDOW_DAYS = 28;
const ROW_H = 46;

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function toStr(d: Date) {
  return localDateStr(d);
}
function parseDate(s: string) {
  return new Date(s + "T00:00:00");
}

interface Group {
  typeName: string;
  typeId: number | null;
  bikes: Bike[];
}

function Timeline({
  bikes,
  reservations,
}: {
  bikes: Bike[];
  reservations: BikeReservation[];
}) {
  const navigate = useNavigate();
  const [showCompleted, setShowCompleted] = useState(false);
  const [windowStart, setWindowStart] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 3);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  const cardRef = useRef<HTMLDivElement>(null);
  const [windowDays, setWindowDays] = useState(DEFAULT_WINDOW_DAYS);

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const update = () => {
      const inner = el.clientWidth - LABEL_W;
      if (inner <= 0) return;
      setWindowDays(Math.max(MIN_WINDOW_DAYS, Math.floor(inner / DAY_W)));
    };
    update();
    const obs = new ResizeObserver(update);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const windowEnd = addDays(windowStart, windowDays - 1);
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const todayStr = toStr(today);

  const days = useMemo(
    () => Array.from({ length: windowDays }, (_, i) => addDays(windowStart, i)),
    [windowStart, windowDays]
  );

  const monthGroups = useMemo(() => {
    const groups: { label: string; span: number }[] = [];
    let cur = "";
    let span = 0;
    for (const d of days) {
      const lbl = d.toLocaleDateString("nl-NL", { month: "long", year: "numeric" });
      if (lbl === cur) { span++; }
      else { if (cur) groups.push({ label: cur, span }); cur = lbl; span = 1; }
    }
    if (cur) groups.push({ label: cur, span });
    return groups;
  }, [days]);

  const bikeGroups: Group[] = useMemo(() => {
    const map = new Map<string, Group>();
    for (const b of bikes) {
      const key = b.type_id?.toString() ?? "0";
      if (!map.has(key)) map.set(key, { typeName: b.type_name || "Overig", typeId: b.type_id, bikes: [] });
      map.get(key)!.bikes.push(b);
    }
    for (const g of map.values()) {
      g.bikes.sort((a, b) => parseInt(a.number) - parseInt(b.number) || a.number.localeCompare(b.number));
    }
    return [...map.values()].sort((a, b) => (a.typeName).localeCompare(b.typeName));
  }, [bikes]);

  const resByBike = useMemo(() => {
    const map: Record<number, BikeReservation[]> = {};
    for (const r of reservations) {
      if (r.status === "cancelled") continue;
      if (!showCompleted && r.status === "completed") continue;
      for (const b of r.bikes) {
        if (!map[b.id]) map[b.id] = [];
        map[b.id].push(r);
      }
    }
    return map;
  }, [reservations, showCompleted]);

  function blockGeometry(r: BikeReservation): { left: number; width: number } | null {
    const s = parseDate(r.start_date);
    const e = parseDate(r.end_date);
    if (e < windowStart || s > windowEnd) return null;
    const cStart = s < windowStart ? windowStart : s;
    const cEnd   = e > windowEnd   ? windowEnd   : e;
    const offset = Math.round((cStart.getTime() - windowStart.getTime()) / 86400000);
    const span   = Math.round((cEnd.getTime()   - cStart.getTime())      / 86400000) + 1;
    return { left: offset * DAY_W, width: span * DAY_W };
  }

  function blockColor(r: BikeReservation): string {
    if (r.status === "completed") return "bg-ink-25 text-ink-70 border-ink-25";
    if (r.start_date <= todayStr && r.end_date >= todayStr) {
      if (r.key_given_at && !r.key_returned_at) return "bg-red-500 text-white border-red-600";
      return "bg-green-500 text-white border-green-600";
    }
    if (r.start_date > todayStr) return "bg-ink-60 text-white border-brand";
    return "bg-gray-400 text-white border-gray-500";
  }

  const todayOffset = Math.round((today.getTime() - windowStart.getTime()) / 86400000);
  const todayInWindow = todayOffset >= 0 && todayOffset < windowDays;
  const totalW = windowDays * DAY_W;

  return (
    <div>
      {/* Tijdlijn controls */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <label className="flex items-center gap-1.5 text-sm text-ink-70 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showCompleted}
            onChange={e => setShowCompleted(e.target.checked)}
            className="accent-blue-600"
          />
          Afgerond tonen
        </label>
        <div className="flex gap-1 ml-auto">
          <button
            onClick={() => setWindowStart(p => addDays(p, -7))}
            className="px-3 py-1.5 rounded-lg border text-sm hover:bg-ink-6 transition-colors"
          >‹ -7d</button>
          <button
            onClick={() => {
              const d = new Date();
              d.setDate(d.getDate() - 3);
              d.setHours(0, 0, 0, 0);
              setWindowStart(d);
            }}
            className="px-3 py-1.5 rounded-lg border text-sm font-medium hover:bg-ink-6 transition-colors"
          >Vandaag</button>
          <button
            onClick={() => setWindowStart(p => addDays(p, 7))}
            className="px-3 py-1.5 rounded-lg border text-sm hover:bg-ink-6 transition-colors"
          >+7d ›</button>
        </div>
      </div>

      <div ref={cardRef} className="bg-paper-raised rounded-2xl shadow overflow-hidden">
        <div className="overflow-x-auto">
          <div style={{ minWidth: LABEL_W + totalW }}>
            {/* Maandkoppenrij */}
            <div className="flex sticky top-0 z-10">
              <div className="shrink-0 bg-ink border-r border-white/10" style={{ width: LABEL_W }} />
              <div className="flex bg-ink text-white text-xs font-semibold">
                {monthGroups.map((mg, i) => (
                  <div key={i} style={{ width: mg.span * DAY_W }} className="py-2 px-2 border-r border-white/10 capitalize truncate">
                    {mg.label}
                  </div>
                ))}
              </div>
            </div>

            {/* Dagenrij */}
            <div className="flex sticky top-[28px] z-10">
              <div className="shrink-0 bg-gray-700 border-r border-white/10" style={{ width: LABEL_W }} />
              <div className="flex bg-gray-700 text-white text-[11px]">
                {days.map((d, i) => {
                  const isToday   = toStr(d) === todayStr;
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                  return (
                    <div
                      key={i}
                      style={{ width: DAY_W }}
                      className={`flex flex-col items-center justify-center py-1 border-r border-white/10 ${
                        isToday ? "bg-brand font-bold" : isWeekend ? "bg-gray-600" : ""
                      }`}
                    >
                      <span>{d.getDate()}</span>
                      <span className="opacity-60 text-[9px]">{d.toLocaleDateString("nl-NL", { weekday: "short" }).slice(0, 2)}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Fietsrijen per type */}
            {bikeGroups.map((group) => (
              <div key={group.typeName}>
                <div className="flex border-b border-ink-12 bg-ink-6">
                  <div style={{ width: LABEL_W }} className="shrink-0 px-3 py-1.5 text-[10px] font-semibold text-ink-45 uppercase tracking-wide border-r border-ink-12 flex items-center">
                    <span className="truncate">{group.typeName}</span>
                  </div>
                  <div style={{ width: totalW }} />
                </div>

                {group.bikes.map((bike) => {
                  const bikeRes = resByBike[bike.id] || [];
                  const isRentedToday = bikeRes.some(r => r.status === "active" && r.start_date <= todayStr && r.end_date >= todayStr);
                  return (
                    <div key={bike.id} className="flex border-b border-ink-6 hover:bg-ink-6 group" style={{ height: ROW_H }}>
                      <div style={{ width: LABEL_W }} className="shrink-0 border-r border-ink-12 flex items-center gap-2 px-3">
                        <span className={`w-2 h-2 rounded-full shrink-0 ${
                          bike.status === "maintenance" ? "bg-orange-400" :
                          isRentedToday ? "bg-green-500" : "bg-ink-25"
                        }`} />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold truncate">#{bike.number}</p>
                          <p className="text-[10px] text-ink-45 truncate">{bike.total_rental_days}d</p>
                        </div>
                      </div>

                      <div className="relative" style={{ width: totalW }}>
                        {days.map((d, i) =>
                          (d.getDay() === 0 || d.getDay() === 6) ? (
                            <div key={i} className="absolute top-0 bottom-0 bg-ink-6 pointer-events-none" style={{ left: i * DAY_W, width: DAY_W }} />
                          ) : null
                        )}
                        {todayInWindow && (
                          <div className="absolute top-0 bottom-0 bg-ink-6 opacity-50 pointer-events-none" style={{ left: todayOffset * DAY_W, width: DAY_W }} />
                        )}
                        {bikeRes.map((r) => {
                          const geo = blockGeometry(r);
                          if (!geo) return null;
                          return (
                            <div
                              key={r.id}
                              className={`absolute top-1.5 bottom-1.5 rounded border flex items-center px-1.5 overflow-hidden cursor-pointer text-[11px] font-medium transition-opacity hover:opacity-90 ${blockColor(r)}`}
                              style={{ left: geo.left + 1, width: geo.width - 2 }}
                              title={`${r.guest_name}${r.guest_room ? ` | Kamer ${r.guest_room}` : ""}\n${formatDateNL(r.start_date)} → ${formatDateNL(r.end_date)} (${r.num_days}d)`}
                              onClick={() => navigate(`/bikes/reserveringen/${r.id}`)}
                            >
                              <span className="truncate">{r.guest_name}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            {bikes.length === 0 && (
              <div className="flex items-center justify-center h-32 text-ink-45 text-sm">
                Geen fietsen gevonden
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 px-4 py-3 bg-ink-6 border-t text-xs text-ink-45">
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-green-500" /> Verhuurd vandaag</div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-red-500" /> Sleutel uit</div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-ink-60" /> Gepland</div>
          {showCompleted && <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-ink-25" /> Voltooid</div>}
          <span className="ml-auto text-ink-45">Klik op een blok om de reservering te openen</span>
        </div>
      </div>
    </div>
  );
}

// ── Reserveringslijst ─────────────────────────────────────────────────────────

function ReservationRow({ r, onClick }: { r: BikeReservation; onClick: () => void }) {
  const t = todayDateStr();
  const s = getDisplayStatus(r, t);
  const isNow = r.status === "active" && r.start_date <= t && r.end_date >= t;

  return (
    <tr
      className={`border-b hover:bg-ink-6 cursor-pointer transition-colors ${isNow ? "bg-ink-6" : ""}`}
      onClick={onClick}
    >
      <td className="py-3 px-4 text-sm font-medium text-ink-45">#{r.id}</td>
      <td className="py-3 px-4">
        <p className="font-medium text-sm">{r.guest_name}</p>
        {r.guest_room && <p className="text-xs text-ink-45">Kamer {r.guest_room}</p>}
      </td>
      <td className="py-3 px-4 text-sm">
        <p>{formatDateNL(r.start_date)}</p>
        <p className="text-xs text-ink-45">t/m {formatDateNL(r.end_date)} ({r.num_days}d)</p>
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

const FILTER_LABELS: Record<FilterStatus, string> = {
  planned: "Gepland",
  rented: "Verhuurd",
  completed: "Voltooid",
  cancelled: "Geannuleerd",
};

const ALL_FILTERS: FilterStatus[] = ["planned", "rented", "completed", "cancelled"];

function reservationMatchesFilter(r: BikeReservation, today: string): FilterStatus {
  if (r.status === "completed") return "completed";
  if (r.status === "cancelled") return "cancelled";
  if (r.start_date > today) return "planned";
  return "rented";
}

function ReservationList({ reservations, onNavigate }: { reservations: BikeReservation[]; onNavigate: (id: number) => void }) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState<Set<FilterStatus>>(() => new Set(["planned", "rented"]));
  const [search, setSearch] = useState("");

  function toggle(s: FilterStatus) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  }

  const filtered = useMemo(() => {
    const today = todayDateStr();
    let arr = reservations.filter((r) => selected.has(reservationMatchesFilter(r, today)));
    if (search) {
      const q = search.toLowerCase();
      arr = arr.filter(
        (r) =>
          r.guest_name.toLowerCase().includes(q) ||
          (r.guest_room && r.guest_room.includes(search)) ||
          String(r.id).includes(search)
      );
    }
    return [...arr].sort((a, b) => a.start_date.localeCompare(b.start_date));
  }, [reservations, selected, search]);

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-4">
        {ALL_FILTERS.map((s) => {
          const active = selected.has(s);
          return (
            <button
              key={s}
              onClick={() => toggle(s)}
              aria-pressed={active}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                active ? "bg-brand text-white" : "bg-ink-6 text-ink-70 hover:bg-ink-12"
              }`}
            >
              {active ? "✓ " : ""}{FILTER_LABELS[s]}
            </button>
          );
        })}
        <input
          type="text"
          placeholder="Zoek op naam, kamer of #..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="ml-auto border rounded-lg px-3 py-1.5 text-sm w-52 focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>

      <div className="bg-paper-raised rounded-2xl shadow overflow-hidden">
        {filtered.length === 0 ? (
          <p className="p-6 text-ink-45 italic">Geen reserveringen gevonden</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-ink-6 text-xs text-ink-45 uppercase tracking-wide">
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
                    onClick={() => { navigate(`/bikes/reserveringen/${r.id}`); onNavigate(r.id); }}
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

// ── Hoofd component ────────────────────────────────────────────────────────────

type View = "tijdlijn" | "lijst";

export default function BikeReserveringen() {
  const navigate = useNavigate();
  const [view, setView] = useState<View>("tijdlijn");
  const [bikes, setBikes] = useState<Bike[]>([]);
  const [reservations, setReservations] = useState<BikeReservation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([bikeApi.list(), bikeReservationApi.list()])
      .then(([b, r]) => { setBikes(b.data); setReservations(r.data); })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="p-4 text-ink-45">Laden...</p>;

  return (
    <div className="max-w-full">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold">Reserveringen</h1>
          {/* View toggle */}
          <div className="flex gap-1 bg-ink-6 p-1 rounded-xl shrink-0">
            <button
              onClick={() => setView("tijdlijn")}
              className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                view === "tijdlijn" ? "bg-paper-raised shadow text-ink" : "text-ink-45 hover:text-ink-70"
              }`}
            >
              📆 Tijdlijn
            </button>
            <button
              onClick={() => setView("lijst")}
              className={`px-3 py-1 rounded-lg text-sm font-medium transition-colors ${
                view === "lijst" ? "bg-paper-raised shadow text-ink" : "text-ink-45 hover:text-ink-70"
              }`}
            >
              📋 Lijst
            </button>
          </div>
        </div>
        <button
          onClick={() => navigate("/bikes/reserveringen/nieuw")}
          className="bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-colors"
        >
          + Nieuwe reservering
        </button>
      </div>

      {view === "tijdlijn" && (
        <Timeline bikes={bikes} reservations={reservations} />
      )}

      {view === "lijst" && (
        <ReservationList
          reservations={reservations}
          onNavigate={() => {}}
        />
      )}
    </div>
  );
}
