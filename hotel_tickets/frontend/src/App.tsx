import { useState, useEffect } from "react";
import { Routes, Route, NavLink } from "react-router-dom";
import MijnOverzicht from "./pages/MijnOverzicht";
import Dashboard from "./pages/Dashboard";
import TicketList from "./pages/TicketList";
import TicketDetail from "./pages/TicketDetail";
import NewTicket from "./pages/NewTicket";
import RecurringTasks from "./pages/RecurringTasks";
import RecurringTaskDetail from "./pages/RecurringTaskDetail";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import { userApi, type UserRole } from "./api/client";

const NAV_ITEMS = [
  { to: "/", label: "Mijn overzicht", icon: "👤", end: true, restricted: false },
  { to: "/tickets", label: "Tickets", icon: "🎫", restricted: false },
  { to: "/dashboard", label: "Dashboard", icon: "⊞", restricted: false },
  { to: "/recurring", label: "Herhalend", icon: "🔄", restricted: false },
  { to: "/reports", label: "Rapportage", icon: "📊", restricted: "adminOrSupervisor" },
  { to: "/settings", label: "Instellingen", icon: "⚙️", restricted: "settings" },
] as const;

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserRole | null>(null);
  const [hasAdmin, setHasAdmin] = useState(true);

  useEffect(() => {
    Promise.all([userApi.me(), userApi.list()])
      .then(([meRes, listRes]) => {
        setCurrentUser(meRes.data);
        setHasAdmin(listRes.data.some((u) => u.role === "admin"));
      })
      .catch(() => {});
  }, []);

  const isAdminOrSupervisor =
    currentUser?.role === "admin" || currentUser?.role === "supervisor";

  const visibleItems = NAV_ITEMS.filter((item) => {
    if (item.restricted === "adminOrSupervisor") return isAdminOrSupervisor;
    if (item.restricted === "settings") return isAdminOrSupervisor || !hasAdmin;
    return true;
  });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top navigatie */}
      <nav className="bg-hotel-900 text-white shadow-lg">
        <div className="max-w-5xl mx-auto px-4">
          <div className="flex items-center gap-1 h-14 overflow-x-auto">
            <span className="font-bold text-lg mr-3 text-white shrink-0">🎫 Hotel Tickets</span>
            {visibleItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={"end" in item ? item.end : undefined}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm transition-colors shrink-0 ${
                    isActive
                      ? "bg-white/20 text-white"
                      : "text-white/70 hover:text-white hover:bg-white/10"
                  }`
                }
              >
                <span>{item.icon}</span>
                <span>{item.label}</span>
              </NavLink>
            ))}
          </div>
        </div>
      </nav>

      {/* Inhoud */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        <Routes>
          <Route path="/" element={<MijnOverzicht />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/tickets" element={<TicketList />} />
          <Route path="/tickets/new" element={<NewTicket />} />
          <Route path="/tickets/:id" element={<TicketDetail />} />
          <Route path="/recurring/:id" element={<RecurringTaskDetail />} />
          <Route path="/recurring" element={<RecurringTasks />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
