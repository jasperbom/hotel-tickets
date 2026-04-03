import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ticketApi, locationApi, userApi, type Ticket, type Category, type Status, type Priority, type Location, type UserRole } from "../api/client";
import TicketCard from "../components/TicketCard";

const CATEGORIES = [
  { value: "", label: "Alle categorieën" },
  { value: "technical", label: "Technisch" },
  { value: "housekeeping", label: "Huishouding" },
  { value: "reception", label: "Receptie" },
];

const STATUSES = [
  { value: "", label: "Alle statussen" },
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

  const [category, setCategory] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [priority, setPriority] = useState("");

  useEffect(() => {
    Promise.all([locationApi.list(), userApi.list()]).then(([locs, usrs]) => {
      setLocations(Object.fromEntries(locs.data.map((l) => [l.id, l.name])));
      setUsers(Object.fromEntries(usrs.data.map((u) => [u.ha_user_id, u.display_name])));
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    const params: Record<string, string> = {};
    if (category) params.category = category;
    if (statusFilter) params.status = statusFilter;
    if (priority) params.priority = priority;

    ticketApi.list(params)
      .then((r) => setTickets(r.data))
      .finally(() => setLoading(false));
  }, [category, statusFilter, priority]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Tickets</h1>
        <Link to="/tickets/new" className="btn-primary">+ Nieuw</Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white"
        >
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white"
        >
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm bg-white"
        >
          {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
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
