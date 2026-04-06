import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ticketApi, locationApi, userApi, type Ticket, type Category, type Status, type Priority } from "../api/client";
import TicketCard from "../components/TicketCard";

const DEPARTMENTS = [
  { value: "", label: "Alle afdelingen" },
  { value: "technical", label: "Technisch" },
  { value: "housekeeping", label: "Huishouding" },
  { value: "reception", label: "Receptie" },
];

const STATUS_OPTIONS: { value: Status; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In behandeling" },
  { value: "closed", label: "Gesloten" },
];

const PRIORITIES = [
  { value: "", label: "Alle prioriteiten" },
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "Hoog" },
  { value: "medium", label: "Normaal" },
  { value: "low", label: "Laag" },
];

export default function TicketList() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [users, setUsers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const [department, setDepartment] = useState("");
  const [selectedStatuses, setSelectedStatuses] = useState<Status[]>(["open", "in_progress"]);
  const [priority, setPriority] = useState("");

  function toggleStatus(value: Status) {
    setSelectedStatuses((prev) =>
      prev.includes(value)
        ? prev.length > 1 ? prev.filter((s) => s !== value) : prev // keep at least one
        : [...prev, value]
    );
  }

  useEffect(() => {
    Promise.all([locationApi.list(), userApi.list()]).then(([locs, usrs]) => {
      setLocations(Object.fromEntries(locs.data.map((l) => [l.id, l.name])));
      setUsers(Object.fromEntries(usrs.data.map((u) => [u.ha_user_id, u.display_name])));
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (department) params.category = department;
    if (selectedStatuses.length < 3) params.status = selectedStatuses.join(",");
    if (priority) params.priority = priority;

    ticketApi.list(params)
      .then((r) => setTickets(r.data))
      .finally(() => setLoading(false));
  }, [department, selectedStatuses, priority]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Tickets</h1>
        <Link to="/tickets/new" className="btn-primary">+ Nieuw</Link>
      </div>

      {/* Filters */}
      <div className="space-y-2">
        {/* Status toggle pills */}
        <div className="flex gap-2 flex-wrap">
          {STATUS_OPTIONS.map((s) => {
            const active = selectedStatuses.includes(s.value);
            const colors: Record<Status, string> = {
              open: active ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-300 hover:border-blue-400",
              in_progress: active ? "bg-amber-500 text-white border-amber-500" : "bg-white text-gray-600 border-gray-300 hover:border-amber-400",
              closed: active ? "bg-gray-500 text-white border-gray-500" : "bg-white text-gray-600 border-gray-300 hover:border-gray-400",
            };
            return (
              <button
                key={s.value}
                onClick={() => toggleStatus(s.value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm font-medium transition-all ${colors[s.value]}`}
              >
                {active && <span className="text-xs">✓</span>}
                {s.label}
              </button>
            );
          })}
        </div>

        {/* Afdeling + prioriteit dropdowns */}
        <div className="flex flex-wrap gap-2">
          <select
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            {DEPARTMENTS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : (
        <div className="space-y-3">
          {tickets.length === 0 ? (
            <div className="card py-12 text-center text-gray-500">
              <p className="text-lg">Geen tickets gevonden</p>
              <Link to="/tickets/new" className="mt-3 inline-block text-blue-600 hover:underline text-sm">
                Maak het eerste ticket aan →
              </Link>
            </div>
          ) : (
            tickets.map((ticket) => (
              <TicketCard key={ticket.id} ticket={ticket} users={users} locations={locations} />
            ))
          )}
        </div>
      )}
    </div>
  );
}
