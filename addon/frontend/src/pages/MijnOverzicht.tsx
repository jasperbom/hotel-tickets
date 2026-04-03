import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { nl } from "date-fns/locale";
import api, { ticketApi, type Ticket, type Category, type Role } from "../api/client";
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
  my_tickets: Ticket[];
  available_tickets: Ticket[];
}

const ROLE_LABELS: Record<Role, string> = {
  admin: "Beheerder",
  supervisor: "Supervisor",
  technician: "Technicus",
  housekeeping: "Huishouding",
  reception: "Receptie",
};

const DEPT_LABELS: Record<Category, string> = {
  technical: "Technische dienst",
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

  useEffect(() => {
    api.get<Overview>("/users/me/overview")
      .then((r) => setOverview(r.data))
      .finally(() => setLoading(false));
  }, []);

  async function claimTicket(ticketId: string) {
    await ticketApi.claim(ticketId);
    // Herlaad overzicht
    const r = await api.get<Overview>("/users/me/overview");
    setOverview(r.data);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!overview) return null;

  const { user, stats, my_tickets, available_tickets } = overview;
  const isManager = user.role === "admin" || user.role === "supervisor";

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

      {/* Statistieken */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          value={stats.my_open}
          label="Mijn openstaand"
          color="blue"
          empty="Niets te doen"
        />
        <StatCard
          value={stats.team_open}
          label={isManager ? "Totaal open" : "Team open"}
          color="gray"
        />
        <StatCard
          value={stats.urgent}
          label="Urgent"
          color={stats.urgent > 0 ? "red" : "gray"}
          pulse={stats.urgent > 0}
        />
      </div>

      {/* Mijn tickets */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900">Mijn openstaande tickets</h2>
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
              <MyTicketRow key={t.id} ticket={t} />
            ))}
          </div>
        )}
      </section>

      {/* Beschikbaar om op te pakken */}
      {available_tickets.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-gray-900">Beschikbaar om op te pakken</h2>
            <Link to="/tickets?status=open" className="text-sm text-blue-600 hover:underline">
              Alle open →
            </Link>
          </div>
          <div className="space-y-2">
            {available_tickets.map((t) => (
              <AvailableTicketRow key={t.id} ticket={t} onClaim={() => claimTicket(t.id)} />
            ))}
          </div>
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
  value, label, color, empty, pulse = false,
}: {
  value: number;
  label: string;
  color: "blue" | "red" | "gray";
  empty?: string;
  pulse?: boolean;
}) {
  const colors = {
    blue: "bg-blue-50 text-blue-700",
    red: "bg-red-50 text-red-700",
    gray: "bg-gray-100 text-gray-600",
  };
  return (
    <div className={`rounded-xl p-3 text-center ${colors[color]}`}>
      <div className="relative inline-block">
        <p className={`text-3xl font-bold ${pulse ? "animate-pulse" : ""}`}>{value}</p>
      </div>
      <p className="text-xs font-medium mt-1 opacity-80 leading-tight">
        {value === 0 && empty ? empty : label}
      </p>
    </div>
  );
}

const PRIORITY_BORDER: Record<string, string> = {
  urgent: "border-l-red-500",
  high: "border-l-orange-400",
  medium: "border-l-blue-400",
  low: "border-l-gray-300",
};

function MyTicketRow({ ticket }: { ticket: Ticket }) {
  return (
    <Link
      to={`/tickets/${ticket.id}`}
      className={`card flex items-center gap-3 border-l-4 ${PRIORITY_BORDER[ticket.priority]} hover:shadow-md transition-shadow`}
    >
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm text-gray-900 truncate">{ticket.title}</p>
        <div className="flex gap-1.5 mt-1">
          <StatusBadge status={ticket.status} />
          <CategoryBadge category={ticket.category} />
        </div>
      </div>
      <div className="text-right shrink-0">
        <PriorityBadge priority={ticket.priority} />
        <p className="text-xs text-gray-400 mt-1">
          {format(new Date(ticket.created_at), "d MMM", { locale: nl })}
        </p>
      </div>
    </Link>
  );
}

function AvailableTicketRow({ ticket, onClaim }: { ticket: Ticket; onClaim: () => void }) {
  return (
    <div className={`card flex items-center gap-3 border-l-4 ${PRIORITY_BORDER[ticket.priority]}`}>
      <div className="flex-1 min-w-0">
        <Link to={`/tickets/${ticket.id}`}>
          <p className="font-medium text-sm text-gray-900 truncate hover:text-blue-600">{ticket.title}</p>
        </Link>
        <div className="flex gap-1.5 mt-1">
          <CategoryBadge category={ticket.category} />
          <PriorityBadge priority={ticket.priority} />
          <span className="badge bg-gray-100 text-gray-500">Niet toegewezen</span>
        </div>
      </div>
      <button
        onClick={(e) => { e.preventDefault(); onClaim(); }}
        className="shrink-0 text-sm text-blue-600 font-medium border border-blue-200 rounded-lg px-3 py-1.5 hover:bg-blue-50 transition-colors"
      >
        Pakken
      </button>
    </div>
  );
}
