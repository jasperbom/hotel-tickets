import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ticketApi, locationApi, userApi, type Ticket, type Status } from "../api/client";
import TicketCard from "../components/TicketCard";

const DEPARTMENTS = [
  { value: "", label: "Alle afdelingen" },
  { value: "technical", label: "TD" },
  { value: "housekeeping", label: "Huishouding" },
  { value: "reception", label: "Receptie" },
  { value: "service", label: "Bediening" },
  { value: "kitchen", label: "Keuken" },
  { value: "sales", label: "Sales" },
  { value: "garden", label: "Tuin" },
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

const NO_LOCATION_KEY = "__no_location__";

export default function TicketList() {
  const [searchParams] = useSearchParams();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [users, setUsers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  // Initialiseer filters vanuit URL params
  const urlStatus = searchParams.get("status");
  const urlCategory = searchParams.get("category");
  const urlPriority = searchParams.get("priority");
  const urlAssigned = searchParams.get("assigned");

  const [department, setDepartment] = useState(urlCategory || "");
  const [selectedStatuses, setSelectedStatuses] = useState<Status[]>(
    urlStatus ? urlStatus.split(",").filter((s): s is Status => ["open", "in_progress", "closed"].includes(s)) : ["open", "in_progress"]
  );
  const [priority, setPriority] = useState(urlPriority || "");
  const [assignedToMe, setAssignedToMe] = useState(urlAssigned === "me");
  const [search, setSearch] = useState("");
  const [groupByLocation, setGroupByLocation] = useState(() => localStorage.getItem("ht_tickets_group") === "1");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [counts, setCounts] = useState<Record<Status, number> | null>(null);
  // Extra filters standaard ingeklapt, tenzij er al één actief is
  const [filtersOpen, setFiltersOpen] = useState(
    () => Boolean(urlCategory || urlPriority || urlAssigned === "me" || localStorage.getItem("ht_tickets_group") === "1")
  );

  useEffect(() => {
    localStorage.setItem("ht_tickets_group", groupByLocation ? "1" : "0");
  }, [groupByLocation]);

  function toggleStatus(value: Status) {
    setSelectedStatuses((prev) =>
      prev.includes(value)
        ? prev.length > 1 ? prev.filter((s) => s !== value) : prev
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
    if (assignedToMe) params.assigned_to = "me";

    ticketApi.list(params)
      .then((r) => setTickets(r.data))
      .finally(() => setLoading(false));
  }, [department, selectedStatuses, priority, assignedToMe]);

  // Tellers per status binnen de overige filters (statusfilter zelf uitgezonderd)
  useEffect(() => {
    const params: Record<string, string> = {};
    if (department) params.category = department;
    if (priority) params.priority = priority;
    if (assignedToMe) params.assigned_to = "me";
    ticketApi.counts(params)
      .then((r) => setCounts(r.data))
      .catch(() => setCounts(null));
  }, [department, priority, assignedToMe]);

  // Tickets filteren op zoekterm (titel of beschrijving)
  const filteredTickets = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = tickets;
    if (q) {
      list = tickets.filter((t) =>
        t.title.toLowerCase().includes(q) ||
        (t.description?.toLowerCase().includes(q) ?? false)
      );
    }
    // Pinned tickets bovenaan, behalve wanneer alleen op gesloten gefilterd wordt
    // (dan moet sortering puur op sluitingsdatum blijven).
    const onlyClosed = selectedStatuses.length === 1 && selectedStatuses[0] === "closed";
    if (onlyClosed) return list;
    return [...list].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  }, [tickets, search, selectedStatuses]);

  // Aantal tickets per locatie (voor "+N hier"-badge)
  const locationCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const t of filteredTickets) {
      if (!t.location_id) continue;
      map[t.location_id] = (map[t.location_id] || 0) + 1;
    }
    return map;
  }, [filteredTickets]);

  // Groeperen per locatie (bewaar volgorde van eerste verschijning)
  const grouped = useMemo(() => {
    if (!groupByLocation) return null;
    const groups: { key: string; locationName: string; tickets: Ticket[] }[] = [];
    const idx: Record<string, number> = {};
    for (const t of filteredTickets) {
      const key = t.location_id ?? NO_LOCATION_KEY;
      if (idx[key] === undefined) {
        idx[key] = groups.length;
        groups.push({
          key,
          locationName: t.location_id ? (locations[t.location_id] ?? t.location_id) : "Geen locatie",
          tickets: [],
        });
      }
      groups[idx[key]].tickets.push(t);
    }
    return groups;
  }, [groupByLocation, filteredTickets, locations]);

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const activeFilterCount =
    (department ? 1 : 0) + (priority ? 1 : 0) + (assignedToMe ? 1 : 0) + (groupByLocation ? 1 : 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Tickets</h1>
        <Link to="/tickets/new" className="btn-primary">+ Nieuw</Link>
      </div>

      {/* Sticky filterbalk: zoeken + status altijd zichtbaar, rest achter "Filters" */}
      <div className="sticky top-14 z-30 -mx-4 px-4 py-3 bg-white/95 backdrop-blur border-b border-gray-200 space-y-2">
        <div className="flex gap-2">
          <div className="relative flex-1 min-w-0">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">🔍</span>
            <input
              type="search"
              placeholder="Zoek in titel of omschrijving…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full border border-gray-300 rounded-lg pl-9 pr-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
          </div>
          <button
            onClick={() => setFiltersOpen(!filtersOpen)}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
              filtersOpen || activeFilterCount > 0
                ? "border-blue-400 bg-blue-50 text-blue-700"
                : "border-gray-300 bg-white text-gray-600 hover:border-blue-400"
            }`}
            title="Extra filters tonen of verbergen"
          >
            <span>⚙</span>
            <span className="hidden sm:inline">Filters</span>
            {activeFilterCount > 0 && (
              <span className="text-xs font-bold bg-blue-600 text-white px-1.5 py-0.5 rounded-full leading-none">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Status toggle pills met tellers */}
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
                {counts && (
                  <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full leading-none ${
                    active ? "bg-white/25" : "bg-gray-100 text-gray-500"
                  }`}>
                    {counts[s.value] ?? 0}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Extra filters: afdeling + prioriteit + mijn tickets + groepeer */}
        {filtersOpen && (
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
            <button
              onClick={() => setAssignedToMe(!assignedToMe)}
              className={`px-3 py-1.5 rounded-full border text-sm font-medium transition-all ${
                assignedToMe
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-300 hover:border-blue-400"
              }`}
            >
              {assignedToMe && <span className="text-xs mr-1">✓</span>}
              Mijn tickets
            </button>
            <button
              onClick={() => setGroupByLocation(!groupByLocation)}
              className={`px-3 py-1.5 rounded-full border text-sm font-medium transition-all ${
                groupByLocation
                  ? "bg-purple-600 text-white border-purple-600"
                  : "bg-white text-gray-600 border-gray-300 hover:border-purple-400"
              }`}
              title="Tickets gegroepeerd per kamer/locatie tonen"
            >
              {groupByLocation && <span className="text-xs mr-1">✓</span>}
              📁 Groepeer per locatie
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : filteredTickets.length === 0 ? (
        <div className="card py-12 text-center text-gray-500">
          <p className="text-lg">Geen tickets gevonden</p>
          {search && <p className="text-sm mt-2">Geen resultaat voor "{search}"</p>}
          <Link to="/tickets/new" className="mt-3 inline-block text-blue-600 hover:underline text-sm">
            Maak het eerste ticket aan →
          </Link>
        </div>
      ) : grouped ? (
        <div className="space-y-3">
          {grouped.map((group) => {
            const collapsed = !!collapsedGroups[group.key];
            const isNoLocation = group.key === NO_LOCATION_KEY;
            return (
              <div key={group.key} className="space-y-2">
                <button
                  onClick={() => toggleGroup(group.key)}
                  className="w-full flex items-center gap-2 px-3 py-2 bg-purple-50 hover:bg-purple-100 rounded-xl border border-purple-200"
                >
                  <span className="text-base">{collapsed ? "▶" : "▼"}</span>
                  <span className="text-base">{isNoLocation ? "📋" : "📍"}</span>
                  <span className={`font-semibold ${isNoLocation ? "text-gray-500 italic" : "text-purple-900"}`}>
                    {group.locationName}
                  </span>
                  <span className="ml-auto text-xs font-semibold bg-purple-200 text-purple-800 px-2 py-0.5 rounded-full">
                    {group.tickets.length}
                  </span>
                </button>
                {!collapsed && (
                  <div className="space-y-3 pl-2">
                    {group.tickets.map((ticket) => (
                      <TicketCard
                        key={ticket.id}
                        ticket={ticket}
                        users={users}
                        locations={locations}
                        relatedCount={ticket.location_id ? Math.max(0, (locationCounts[ticket.location_id] || 1) - 1) : 0}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {filteredTickets.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              users={users}
              locations={locations}
              relatedCount={ticket.location_id ? Math.max(0, (locationCounts[ticket.location_id] || 1) - 1) : 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}
