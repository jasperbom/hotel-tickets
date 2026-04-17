import { useEffect, useState, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { nl } from "date-fns/locale";
import api, { ticketApi, locationApi, parseUTC, type Ticket, type Category, type Role, type UpcomingRecurring } from "../api/client";
import { PriorityBadge, CategoryBadge, StatusBadge } from "../components/StatusBadge";

interface Overview {
  user: {
    ha_user_id: string;
    display_name: string;
    role: Role;
    department: Category | null;
  };
  stats: {
    my_open: number;
    team_open: number;
    urgent: number;
  };
  urgent_tickets: Ticket[];
  my_tickets: Ticket[];
  available_tickets: Ticket[];
  today_recurring: UpcomingRecurring[];
  upcoming_recurring: UpcomingRecurring[];
}

const ROLE_LABELS: Record<Role, string> = {
  admin: "Beheerder",
  supervisor: "Supervisor",
  technician: "Technicus",
  housekeeping: "Huishouding",
  reception: "Receptie",
};

const DEPT_LABELS: Record<Category, string> = {
  technical: "TD",
  housekeeping: "Huishouding",
  reception: "Receptie",
};

const PRIORITY_ORDER: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Goedemorgen";
  if (h < 18) return "Goedemiddag";
  return "Goedenavond";
}

export default function MijnOverzicht() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [keycards, setKeycards] = useState<Record<string, boolean | null>>({});
  const [showAllToday, setShowAllToday] = useState(false);
  const [deptFilter, setDeptFilter] = useState<Category | "">(() => {
    const saved = localStorage.getItem("ht_dept_filter");
    if (saved === "technical" || saved === "housekeeping" || saved === "reception") return saved;
    return "";
  });
  const [showUpcoming, setShowUpcoming] = useState(false);
  const todaySectionRef = useRef<HTMLElement>(null);
  const navigate = useNavigate();

  async function loadKeycards(tickets: Ticket[], recurring: UpcomingRecurring[], locs: Record<string, string>) {
    const ticketLocs = tickets.map(t => t.location_id).filter(Boolean) as string[];
    const recurringLocs = recurring.map(t => t.location_id).filter(Boolean) as string[];
    const roomsItems = recurring
      .filter(t => t.subtask_mode === "rooms")
      .flatMap(t => t.subtask_items ?? []);
    const areaIds = [...new Set([...ticketLocs, ...recurringLocs, ...roomsItems])];
    const results = await Promise.allSettled(
      areaIds.map(id => locationApi.keycard(id).then(r => ({ id, occupied: r.data.found ? r.data.occupied : null })))
    );
    const map: Record<string, boolean | null> = {};
    results.forEach(r => { if (r.status === "fulfilled") map[r.value.id] = r.value.occupied; });
    setKeycards(map);
    setLocations(locs);
  }

  async function loadData(dept?: Category | "") {
    const params = dept ? `?department=${dept}` : "";
    const [ov, locs] = await Promise.all([
      api.get<Overview>(`/users/me/overview${params}`),
      locationApi.list(),
    ]);
    setOverview(ov.data);
    const locMap = Object.fromEntries(locs.data.map(l => [l.id, l.name]));
    const allTickets = [...(ov.data.urgent_tickets ?? []), ...ov.data.my_tickets, ...ov.data.available_tickets];
    const allRecurring = [...(ov.data.today_recurring ?? []), ...(ov.data.upcoming_recurring ?? [])];
    loadKeycards(allTickets, allRecurring, locMap);
  }

  useEffect(() => {
    loadData(deptFilter).finally(() => setLoading(false));
  }, []);

  function changeDeptFilter(value: Category | "") {
    setDeptFilter(value);
    localStorage.setItem("ht_dept_filter", value);
    setLoading(true);
    loadData(value).finally(() => setLoading(false));
  }

  async function claimTicket(ticketId: string) {
    await ticketApi.claim(ticketId);
    await loadData(deptFilter);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!overview) return null;

  const { user, stats, urgent_tickets = [], my_tickets, available_tickets, today_recurring = [], upcoming_recurring = [] } = overview;
  const isManager = user.role === "admin" || user.role === "supervisor";
  const visibleToday = showAllToday ? today_recurring : today_recurring.slice(0, 3);

  return (
    <div className="space-y-6">

      {/* Begroeting */}
      <div className="bg-gradient-to-r from-blue-700 to-blue-500 rounded-2xl px-6 py-5 text-white shadow">
        <p className="text-blue-100 text-sm font-medium">{greeting()},</p>
        <h1 className="text-2xl font-bold mt-0.5">{user.display_name}</h1>
        <p className="text-blue-200 text-sm mt-1">
          {ROLE_LABELS[user.role]}
          {user.department ? ` · ${DEPT_LABELS[user.department]}` : ""}
        </p>
      </div>

      {/* Afdelingsfilter voor admin/supervisor */}
      {isManager && (
        <div className="flex gap-2 flex-wrap">
          {([["", "Alle afdelingen"], ["technical", "TD"], ["housekeeping", "Huishouding"], ["reception", "Receptie"]] as const).map(([val, label]) => (
            <button
              key={val}
              onClick={() => changeDeptFilter(val as Category | "")}
              className={`px-3 py-1.5 rounded-full border text-sm font-medium transition-all ${
                deptFilter === val
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Statistieken */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard
          value={stats.my_open}
          label="Mijn openstaand"
          color="blue"
          empty="Niets te doen"
          onClick={() => navigate("/tickets?status=open,in_progress&assigned=me")}
        />
        <StatCard
          value={stats.team_open}
          label={isManager ? "Totaal open" : "Team open"}
          color="gray"
          onClick={() => navigate("/tickets?status=open,in_progress")}
        />
        <StatCard
          value={stats.urgent}
          label="Urgent"
          color={stats.urgent > 0 ? "red" : "gray"}
          pulse={stats.urgent > 0}
          onClick={() => navigate("/tickets?priority=urgent&status=open,in_progress")}
        />
        <StatCard
          value={today_recurring.length}
          label="Herhalend vandaag"
          color="purple"
          empty="Geen taken"
          onClick={() => todaySectionRef.current?.scrollIntoView({ behavior: "smooth" })}
        />
      </div>

      {/* Urgente tickets */}
      {urgent_tickets.length > 0 && (
        <section>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-red-600 text-lg">🚨</span>
            <h2 className="font-semibold text-red-700">Urgente tickets</h2>
            <span className="text-xs font-bold bg-red-600 text-white px-1.5 py-0.5 rounded-full">{urgent_tickets.length}</span>
          </div>
          <div className="space-y-2">
            {urgent_tickets.map((t) => (
              <UrgentTicketRow key={t.id} ticket={t} locationName={t.location_id ? locations[t.location_id] : undefined} occupied={t.location_id ? keycards[t.location_id] : undefined} />
            ))}
          </div>
        </section>
      )}

      {/* Herhalende taken vandaag */}
      {today_recurring.length > 0 && (
        <section ref={todaySectionRef}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-purple-600 text-lg">🔁</span>
            <h2 className="font-semibold text-gray-900">Herhalende taken vandaag</h2>
            <span className="text-xs font-bold bg-purple-600 text-white px-1.5 py-0.5 rounded-full">{today_recurring.length}</span>
          </div>
          <div className="space-y-2">
            {visibleToday.map((t) => (
              <RecurringTaskRow key={t.id} task={t} locationName={t.location_id ? locations[t.location_id] : undefined} occupied={t.location_id ? keycards[t.location_id] : undefined} keycards={keycards} locations={locations} />
            ))}
          </div>
          {!showAllToday && today_recurring.length > 3 && (
            <button
              onClick={() => setShowAllToday(true)}
              className="mt-2 text-sm text-blue-600 hover:underline w-full text-center py-1"
            >
              +{today_recurring.length - 3} meer tonen
            </button>
          )}
        </section>
      )}

      {/* Mijn tickets */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="text-blue-600 text-lg">🎫</span>
            <h2 className="font-semibold text-gray-900">Mijn openstaande tickets</h2>
          </div>
          <Link to="/tickets?assigned=me" className="text-sm text-blue-600 hover:underline">
            Alle →
          </Link>
        </div>

        {my_tickets.length === 0 ? (
          <div className="card py-8 text-center text-gray-400">
            <p className="text-2xl mb-1">✓</p>
            <p className="text-sm">Geen openstaande tickets. Goed werk!</p>
          </div>
        ) : (
          <div className="space-y-2">
            {my_tickets.map((t) => (
              <MyTicketRow key={t.id} ticket={t} locationName={t.location_id ? locations[t.location_id] : undefined} occupied={t.location_id ? keycards[t.location_id] : undefined} />
            ))}
          </div>
        )}
      </section>

      {/* Beschikbaar om op te pakken */}
      {available_tickets.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-blue-600 text-lg">🎫</span>
              <h2 className="font-semibold text-gray-900">Beschikbaar om op te pakken</h2>
            </div>
            <Link to="/tickets?status=open" className="text-sm text-blue-600 hover:underline">
              Alle open →
            </Link>
          </div>
          <div className="space-y-2">
            {available_tickets.map((t) => (
              <AvailableTicketRow key={t.id} ticket={t} locationName={t.location_id ? locations[t.location_id] : undefined} occupied={t.location_id ? keycards[t.location_id] : undefined} onClaim={() => claimTicket(t.id)} />
            ))}
          </div>
        </section>
      )}

      {/* Aankomende herhalende taken */}
      {upcoming_recurring.length > 0 && (
        <section>
          <button
            onClick={() => setShowUpcoming(!showUpcoming)}
            className="flex items-center justify-between w-full mb-3"
          >
            <div className="flex items-center gap-2">
              <span className="text-purple-600 text-lg">🔁</span>
              <h2 className="font-semibold text-gray-900">Aankomende taken</h2>
              <span className="text-xs font-bold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">{upcoming_recurring.length}</span>
              <span className="text-gray-400 text-sm">{showUpcoming ? "▲" : "▼"}</span>
            </div>
            <Link to="/recurring" className="text-sm text-blue-600 hover:underline" onClick={(e) => e.stopPropagation()}>Beheren →</Link>
          </button>
          {showUpcoming && (
            <div className="space-y-2">
              {upcoming_recurring.map((t) => (
                <UpcomingRecurringRow key={t.id} task={t} locationName={t.location_id ? locations[t.location_id] : undefined} occupied={t.location_id ? keycards[t.location_id] : undefined} keycards={keycards} locations={locations} />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Snelle actie */}
      <div className="flex gap-3">
        <Link to="/tickets/new" className="btn-primary flex-1 text-center">
          + Nieuw ticket aanmaken
        </Link>
        {isManager && (
          <Link to="/dashboard" className="btn-secondary flex-1 text-center">
            Beheeroverzicht
          </Link>
        )}
      </div>
    </div>
  );
}

function StatCard({
  value, label, color, empty, pulse = false, onClick,
}: {
  value: number;
  label: string;
  color: "blue" | "red" | "gray" | "purple";
  empty?: string;
  pulse?: boolean;
  onClick?: () => void;
}) {
  const colors = {
    blue: "bg-blue-50 text-blue-700",
    red: "bg-red-50 text-red-700",
    gray: "bg-gray-100 text-gray-600",
    purple: "bg-purple-50 text-purple-700",
  };
  return (
    <button
      onClick={onClick}
      className={`rounded-xl p-3 text-center ${colors[color]} cursor-pointer hover:shadow-md transition-shadow w-full`}
    >
      <div className="relative inline-block">
        <p className={`text-3xl font-bold ${pulse ? "animate-pulse" : ""}`}>{value}</p>
      </div>
      <p className="text-xs font-medium mt-1 opacity-80 leading-tight">
        {value === 0 && empty ? empty : label}
      </p>
    </button>
  );
}

const PRIORITY_BORDER: Record<string, string> = {
  urgent: "border-l-red-500",
  high: "border-l-orange-400",
  medium: "border-l-blue-400",
  low: "border-l-gray-300",
};

function RoomBadge({ name, occupied }: { name: string; occupied: boolean | null | undefined }) {
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <span className="font-semibold text-sm text-blue-700">🚪 {name}</span>
      {occupied === true && (
        <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">Bezet</span>
      )}
      {occupied === false && (
        <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700">Vrij</span>
      )}
    </div>
  );
}

function MyTicketRow({ ticket, locationName, occupied }: { ticket: Ticket; locationName?: string; occupied?: boolean | null }) {
  return (
    <Link
      to={`/tickets/${ticket.id}`}
      className={`card flex flex-col gap-1.5 border-l-4 ${PRIORITY_BORDER[ticket.priority]} hover:shadow-md transition-shadow p-3`}
    >
      {locationName && <RoomBadge name={locationName} occupied={occupied} />}
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium text-sm text-gray-900 truncate">{ticket.title}</p>
        <PriorityBadge priority={ticket.priority} />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5 items-center flex-wrap">
          <StatusBadge status={ticket.status} />
          <CategoryBadge category={ticket.category} />
          {ticket.subtasks && ticket.subtasks.length > 0 && (
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
              ticket.subtasks.every((s) => s.done)
                ? "bg-green-100 text-green-700"
                : "bg-blue-50 text-blue-600"
            }`}>
              ☑ {ticket.subtasks.filter((s) => s.done).length}/{ticket.subtasks.length}
            </span>
          )}
          {ticket.photos && ticket.photos.length > 0 && (
            <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-purple-50 text-purple-600">
              📷 {ticket.photos.length}
            </span>
          )}
          {!!ticket.comment_count && ticket.comment_count > 0 && (
            <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
              💬 {ticket.comment_count}
            </span>
          )}
        </div>
        <p className="text-xs text-gray-400">
          {format(parseUTC(ticket.created_at), "dd:MM", { locale: nl })}
        </p>
      </div>
    </Link>
  );
}

function formatNextRun(dateStr: string): string {
  const date = parseUTC(dateStr);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "Vandaag";
  if (diffDays === 1) return "Morgen";
  if (diffDays < 7) return `Over ${diffDays} dagen`;
  return format(date, "dd:MM:yyyy", { locale: nl });
}

function RecurringTaskRow({ task, locationName, occupied, keycards, locations }: {
  task: UpcomingRecurring;
  locationName?: string;
  occupied?: boolean | null;
  keycards?: Record<string, boolean | null>;
  locations?: Record<string, string>;
}) {
  const isRoomsMode = task.subtask_mode === "rooms" && task.subtask_items && task.subtask_items.length > 0;
  const nextRunDate = parseUTC(task.next_run);
  const isOverdue = nextRunDate < new Date();

  return (
    <Link
      to={`/recurring/${task.id}`}
      className={`card flex flex-col gap-1.5 border-l-4 p-3 hover:shadow-md transition-shadow ${
        isOverdue ? "border-l-red-500 bg-red-50" : "border-l-purple-400"
      }`}
    >
      {/* Kamer(s) bovenaan */}
      {locationName && !isRoomsMode && <RoomBadge name={locationName} occupied={occupied} />}
      {isRoomsMode && task.subtask_items!.map((roomId) => (
        <RoomBadge key={roomId} name={locations?.[roomId] ?? roomId} occupied={keycards?.[roomId]} />
      ))}

      {/* Titel + status badge */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base shrink-0">🔁</span>
          <p className={`font-medium text-sm truncate ${isOverdue ? "text-red-900" : "text-gray-900"}`}>{task.title}</p>
        </div>
        {isOverdue ? (
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs font-semibold bg-red-100 text-red-700 px-2 py-1 rounded-lg">Verlopen</span>
            <span className="text-xs text-red-500">{format(nextRunDate, "HH:mm")}</span>
          </div>
        ) : (
          <span className="text-xs font-semibold bg-green-100 text-green-700 px-2 py-1 rounded-lg shrink-0">Vandaag</span>
        )}
      </div>

      {/* Badges */}
      <div className="flex gap-1.5 items-center flex-wrap">
        <span className="badge bg-purple-100 text-purple-700">Herhalend</span>
        <CategoryBadge category={task.category} />
        <PriorityBadge priority={task.priority} />
        {task.nfc_tag_id && <span className="text-xs font-mono bg-purple-100 text-purple-700 px-1 py-0.5 rounded">NFC</span>}
        {task.subtask_total !== undefined && (
          <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
            task.subtask_done === task.subtask_total
              ? "bg-green-100 text-green-700"
              : "bg-blue-50 text-blue-600"
          }`}>
            ☑ {task.subtask_done}/{task.subtask_total}
          </span>
        )}
      </div>
    </Link>
  );
}

function UpcomingRecurringRow({ task, locationName, occupied, keycards, locations }: {
  task: UpcomingRecurring;
  locationName?: string;
  occupied?: boolean | null;
  keycards?: Record<string, boolean | null>;
  locations?: Record<string, string>;
}) {
  const isRoomsMode = task.subtask_mode === "rooms" && task.subtask_items && task.subtask_items.length > 0;
  const visibleRooms = isRoomsMode ? task.subtask_items!.slice(0, 2) : [];
  const extraRooms = isRoomsMode ? task.subtask_items!.length - 2 : 0;

  return (
    <Link
      to={`/recurring/${task.id}`}
      className="card flex items-center gap-3 p-3 hover:shadow-md transition-shadow"
    >
      <span className="text-lg shrink-0">🔁</span>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-gray-900 truncate">{task.title}</p>
        <div className="flex gap-1.5 mt-1 flex-wrap items-center">
          <span className="badge bg-purple-100 text-purple-700">Herhalend</span>
          <CategoryBadge category={task.category} />
          {locationName && !isRoomsMode && (
            <span className="flex items-center gap-1 text-xs text-gray-500">
              🚪 {locationName}
              {occupied === true && <span className="font-semibold px-1 rounded bg-orange-100 text-orange-700">Bezet</span>}
              {occupied === false && <span className="font-semibold px-1 rounded bg-green-100 text-green-700">Vrij</span>}
            </span>
          )}
          {isRoomsMode && visibleRooms.map((roomId) => {
            const name = locations?.[roomId] ?? roomId;
            const occ = keycards?.[roomId];
            return (
              <span key={roomId} className="flex items-center gap-1 text-xs text-gray-500">
                🚪 {name}
                {occ === true && <span className="font-semibold px-1 rounded bg-orange-100 text-orange-700">Bezet</span>}
                {occ === false && <span className="font-semibold px-1 rounded bg-green-100 text-green-700">Vrij</span>}
              </span>
            );
          })}
          {isRoomsMode && extraRooms > 0 && (
            <span className="text-xs text-gray-400">+{extraRooms} meer</span>
          )}
        </div>
      </div>
      <span className="text-xs font-medium text-gray-500 shrink-0">{formatNextRun(task.next_run)}</span>
    </Link>
  );
}

function UrgentTicketRow({ ticket, locationName, occupied }: { ticket: Ticket; locationName?: string; occupied?: boolean | null }) {
  return (
    <Link
      to={`/tickets/${ticket.id}`}
      className="card flex flex-col gap-1.5 border-l-4 border-l-red-500 bg-red-50 p-3 hover:shadow-md transition-shadow"
    >
      {locationName && <RoomBadge name={locationName} occupied={occupied} />}
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold text-sm text-red-900 truncate">{ticket.title}</p>
        <StatusBadge status={ticket.status} />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5 items-center flex-wrap">
          <CategoryBadge category={ticket.category} />
          {ticket.subtasks && ticket.subtasks.length > 0 && (
            <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-red-100 text-red-700">
              ☑ {ticket.subtasks.filter((s) => s.done).length}/{ticket.subtasks.length}
            </span>
          )}
          {ticket.photos && ticket.photos.length > 0 && (
            <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-purple-50 text-purple-600">
              📷 {ticket.photos.length}
            </span>
          )}
          {!!ticket.comment_count && ticket.comment_count > 0 && (
            <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
              💬 {ticket.comment_count}
            </span>
          )}
        </div>
        <p className="text-xs text-red-400">
          {format(parseUTC(ticket.created_at), "dd:MM HH:mm", { locale: nl })}
        </p>
      </div>
    </Link>
  );
}

function AvailableTicketRow({ ticket, locationName, occupied, onClaim }: { ticket: Ticket; locationName?: string; occupied?: boolean | null; onClaim: () => void }) {
  return (
    <div className={`card flex flex-col gap-1.5 border-l-4 ${PRIORITY_BORDER[ticket.priority]} p-3`}>
      {locationName && <RoomBadge name={locationName} occupied={occupied} />}
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <Link to={`/tickets/${ticket.id}`}>
            <p className="font-medium text-sm text-gray-900 truncate hover:text-blue-600">{ticket.title}</p>
          </Link>
          <div className="flex gap-1.5 mt-1 items-center flex-wrap">
            <CategoryBadge category={ticket.category} />
            <PriorityBadge priority={ticket.priority} />
            {ticket.subtasks && ticket.subtasks.length > 0 && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">
                ☑ {ticket.subtasks.filter((s) => s.done).length}/{ticket.subtasks.length}
              </span>
            )}
            {ticket.photos && ticket.photos.length > 0 && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-purple-50 text-purple-600">
                📷 {ticket.photos.length}
              </span>
            )}
            {!!ticket.comment_count && ticket.comment_count > 0 && (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
                💬 {ticket.comment_count}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={(e) => { e.preventDefault(); onClaim(); }}
          className="shrink-0 text-sm text-blue-600 font-medium border border-blue-200 rounded-lg px-3 py-1.5 hover:bg-blue-50 transition-colors"
        >
          Pakken
        </button>
      </div>
    </div>
  );
}
