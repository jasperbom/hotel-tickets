import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { reportApi, ticketApi, parseUTC, type ReportSummary, type Ticket } from "../api/client";
import { StatusBadge, CategoryBadge } from "../components/StatusBadge";
import { format } from "date-fns";
import { nl } from "date-fns/locale";

const CATEGORY_COLORS = { technical: "#8b5cf6", housekeeping: "#14b8a6", reception: "#6366f1" };
const CATEGORY_LABELS = { technical: "TD", housekeeping: "Huishouding", reception: "Receptie" };
const STATUS_COLORS = { open: "#eab308", in_progress: "#3b82f6", closed: "#22c55e" };
const STATUS_LABELS = { open: "Open", in_progress: "In behandeling", closed: "Gesloten" };

export default function Dashboard() {
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [recentTickets, setRecentTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      reportApi.summary(),
      ticketApi.list({ limit: "5" }),
    ])
      .then(([s, t]) => {
        setSummary(s.data);
        setRecentTickets(t.data);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  const categoryData = summary
    ? Object.entries(summary.category_counts).map(([key, val]) => ({
        name: CATEGORY_LABELS[key as keyof typeof CATEGORY_LABELS],
        value: val,
        color: CATEGORY_COLORS[key as keyof typeof CATEGORY_COLORS],
      }))
    : [];

  const statusData = summary
    ? Object.entries(summary.status_counts).map(([key, val]) => ({
        name: STATUS_LABELS[key as keyof typeof STATUS_LABELS],
        value: val,
        color: STATUS_COLORS[key as keyof typeof STATUS_COLORS],
      }))
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <Link to="/tickets/new" className="btn-primary">
          + Nieuw ticket
        </Link>
      </div>

      {/* Statistieken */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Totaal tickets" value={summary.total_tickets} color="blue" />
          <StatCard label="Open" value={summary.status_counts.open} color="yellow" />
          <StatCard label="In behandeling" value={summary.status_counts.in_progress} color="blue" />
          <StatCard
            label="Gem. afdoeningstijd"
            value={summary.avg_resolution_hours != null ? `${summary.avg_resolution_hours}u` : "—"}
            color="green"
          />
        </div>
      )}

      {/* Grafieken */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card">
          <h2 className="font-semibold mb-4">Per categorie</h2>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={categoryData} dataKey="value" cx="50%" cy="50%" outerRadius={70} label={({ name, value }) => `${name}: ${value}`}>
                {categoryData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="card">
          <h2 className="font-semibold mb-4">Per status</h2>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={statusData}>
              <XAxis dataKey="name" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {statusData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recente tickets */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">Recente tickets</h2>
          <Link to="/tickets" className="text-sm text-blue-600 hover:underline">
            Alle tickets →
          </Link>
        </div>
        <div className="divide-y divide-gray-100">
          {recentTickets.map((ticket) => (
            <Link key={ticket.id} to={`/tickets/${ticket.id}`} className="flex items-center gap-3 py-3 hover:bg-gray-50 -mx-4 px-4 transition-colors">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{ticket.title}</p>
                <div className="flex gap-1.5 mt-1">
                  <StatusBadge status={ticket.status} />
                  <CategoryBadge category={ticket.category} />
                </div>
              </div>
              <span className="text-xs text-gray-400 shrink-0">
                {format(parseUTC(ticket.created_at), "d MMM", { locale: nl })}
              </span>
            </Link>
          ))}
          {recentTickets.length === 0 && (
            <p className="py-8 text-center text-gray-500 text-sm">Geen tickets gevonden</p>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  const colors = {
    blue: "bg-blue-50 text-blue-700",
    yellow: "bg-yellow-50 text-yellow-700",
    green: "bg-green-50 text-green-700",
    purple: "bg-purple-50 text-purple-700",
  };
  return (
    <div className={`rounded-xl p-4 ${colors[color as keyof typeof colors] || colors.blue}`}>
      <p className="text-sm font-medium opacity-80">{label}</p>
      <p className="text-3xl font-bold mt-1">{value}</p>
    </div>
  );
}
