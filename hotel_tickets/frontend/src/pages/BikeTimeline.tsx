import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { bikeApi, bikeReservationApi, formatDateNL, type Bike, type BikeReservation } from "../api/client";

const DAY_W = 38;      // pixels per dag
const LABEL_W = 130;   // pixels voor het fietslabel
const WINDOW_DAYS = 28;
const ROW_H = 46;      // pixels per rij

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function toStr(d: Date) {
  return d.toISOString().split("T")[0];
}
function parseDate(s: string) {
  return new Date(s + "T00:00:00");
}

interface Group {
  typeName: string;
  typeId: number | null;
  bikes: Bike[];
}

export default function BikeTimeline() {
  const navigate = useNavigate();
  const [bikes, setBikes] = useState<Bike[]>([]);
  const [reservations, setReservations] = useState<BikeReservation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCompleted, setShowCompleted] = useState(false);

  const [windowStart, setWindowStart] = useState<Date>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 3);
    d.setHours(0, 0, 0, 0);
    return d;
  });

  useEffect(() => {
    Promise.all([bikeApi.list(), bikeReservationApi.list()])
      .then(([b, r]) => { setBikes(b.data); setReservations(r.data); })
      .finally(() => setLoading(false));
  }, []);

  const windowEnd = addDays(windowStart, WINDOW_DAYS - 1);
  const today = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }, []);
  const todayStr = toStr(today);

  // Dagen in het venster
  const days = useMemo(
    () => Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(windowStart, i)),
    [windowStart]
  );

  // Maandkoppen
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

  // Groepeer fietsen op type, gesorteerd op fietsnummer
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

  // Reserveringen per bike-id (gefilterd op status)
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

  // Bereken positie van een reserveringsblok in het venster
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
    if (r.status === "completed") return "bg-gray-300 text-gray-600 border-gray-400";
    if (r.start_date <= todayStr && r.end_date >= todayStr) return "bg-green-500 text-white border-green-600";
    if (r.start_date > todayStr) return "bg-blue-500 text-white border-blue-600";
    return "bg-gray-400 text-white border-gray-500";
  }

  const todayOffset = Math.round((today.getTime() - windowStart.getTime()) / 86400000);
  const todayInWindow = todayOffset >= 0 && todayOffset < WINDOW_DAYS;
  const totalW = WINDOW_DAYS * DAY_W;

  if (loading) return <p className="p-4 text-gray-400">Laden...</p>;

  return (
    <div className="max-w-full">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <h1 className="text-2xl font-bold">Tijdlijn</h1>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={e => setShowCompleted(e.target.checked)}
              className="accent-blue-600"
            />
            Afgerond tonen
          </label>
          <div className="flex gap-1">
            <button
              onClick={() => setWindowStart(p => addDays(p, -7))}
              className="px-3 py-1.5 rounded-lg border text-sm hover:bg-gray-100 transition-colors"
            >‹ -7d</button>
            <button
              onClick={() => {
                const d = new Date();
                d.setDate(d.getDate() - 3);
                d.setHours(0, 0, 0, 0);
                setWindowStart(d);
              }}
              className="px-3 py-1.5 rounded-lg border text-sm font-medium hover:bg-gray-100 transition-colors"
            >Vandaag</button>
            <button
              onClick={() => setWindowStart(p => addDays(p, 7))}
              className="px-3 py-1.5 rounded-lg border text-sm hover:bg-gray-100 transition-colors"
            >+7d ›</button>
          </div>
        </div>
      </div>

      {/* Gantt */}
      <div className="bg-white rounded-2xl shadow overflow-hidden">
        <div className="overflow-x-auto">
          <div style={{ minWidth: LABEL_W + totalW }}>

            {/* Maandkoppenrij */}
            <div className="flex sticky top-0 z-10">
              <div
                className="shrink-0 bg-gray-800 border-r border-white/10"
                style={{ width: LABEL_W }}
              />
              <div className="flex bg-gray-800 text-white text-xs font-semibold">
                {monthGroups.map((mg, i) => (
                  <div
                    key={i}
                    style={{ width: mg.span * DAY_W }}
                    className="py-2 px-2 border-r border-white/10 capitalize truncate"
                  >
                    {mg.label}
                  </div>
                ))}
              </div>
            </div>

            {/* Dagenrij */}
            <div className="flex sticky top-[28px] z-10">
              <div
                className="shrink-0 bg-gray-700 border-r border-white/10"
                style={{ width: LABEL_W }}
              />
              <div className="flex bg-gray-700 text-white text-[11px]">
                {days.map((d, i) => {
                  const isToday   = toStr(d) === todayStr;
                  const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                  return (
                    <div
                      key={i}
                      style={{ width: DAY_W }}
                      className={`flex flex-col items-center justify-center py-1 border-r border-white/10 ${
                        isToday ? "bg-blue-600 font-bold" : isWeekend ? "bg-gray-600" : ""
                      }`}
                    >
                      <span>{d.getDate()}</span>
                      <span className="opacity-60 text-[9px]">
                        {d.toLocaleDateString("nl-NL", { weekday: "short" }).slice(0, 2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Fietsrijen per type */}
            {bikeGroups.map((group) => (
              <div key={group.typeName}>
                {/* Typekop */}
                <div className="flex border-b border-gray-200 bg-gray-50">
                  <div
                    style={{ width: LABEL_W }}
                    className="shrink-0 px-3 py-1.5 text-[10px] font-semibold text-gray-500 uppercase tracking-wide border-r border-gray-200 flex items-center"
                  >
                    <span className="truncate">{group.typeName}</span>
                  </div>
                  <div style={{ width: totalW }} />
                </div>

                {/* Rijen per fiets */}
                {group.bikes.map((bike) => {
                  const bikeRes = resByBike[bike.id] || [];
                  const isRentedToday = bikeRes.some(
                    r => r.status === "active" && r.start_date <= todayStr && r.end_date >= todayStr
                  );
                  return (
                    <div
                      key={bike.id}
                      className="flex border-b border-gray-100 hover:bg-gray-50 group"
                      style={{ height: ROW_H }}
                    >
                      {/* Label */}
                      <div
                        style={{ width: LABEL_W }}
                        className="shrink-0 border-r border-gray-200 flex items-center gap-2 px-3"
                      >
                        <span className={`w-2 h-2 rounded-full shrink-0 ${
                          bike.status === "maintenance" ? "bg-orange-400" :
                          isRentedToday ? "bg-green-500" : "bg-gray-300"
                        }`} />
                        <div className="min-w-0">
                          <p className="text-xs font-semibold truncate">#{bike.number}</p>
                          <p className="text-[10px] text-gray-400 truncate">{bike.total_rental_days}d</p>
                        </div>
                      </div>

                      {/* Timeline */}
                      <div className="relative" style={{ width: totalW }}>
                        {/* Weekend achtergrond */}
                        {days.map((d, i) =>
                          (d.getDay() === 0 || d.getDay() === 6) ? (
                            <div
                              key={i}
                              className="absolute top-0 bottom-0 bg-gray-50 pointer-events-none"
                              style={{ left: i * DAY_W, width: DAY_W }}
                            />
                          ) : null
                        )}

                        {/* Vandaag highlight */}
                        {todayInWindow && (
                          <div
                            className="absolute top-0 bottom-0 bg-blue-100 opacity-50 pointer-events-none"
                            style={{ left: todayOffset * DAY_W, width: DAY_W }}
                          />
                        )}

                        {/* Reserveringsblokken */}
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
              <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
                Geen fietsen gevonden
              </div>
            )}
          </div>
        </div>

        {/* Legenda */}
        <div className="flex flex-wrap items-center gap-4 px-4 py-3 bg-gray-50 border-t text-xs text-gray-500">
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-green-500" /> Actief vandaag</div>
          <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-blue-500" /> Toekomstig</div>
          {showCompleted && <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded bg-gray-300" /> Afgerond</div>}
          <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-green-500" /> Verhuurd nu</div>
          <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-gray-300" /> Vrij</div>
          <span className="ml-auto text-gray-400">Klik op een blok om de reservering te openen</span>
        </div>
      </div>
    </div>
  );
}
