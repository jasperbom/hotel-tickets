import { Routes, Route, NavLink } from "react-router-dom";
import MijnOverzicht from "./pages/MijnOverzicht";
import Dashboard from "./pages/Dashboard";
import TicketList from "./pages/TicketList";
import TicketDetail from "./pages/TicketDetail";
import NewTicket from "./pages/NewTicket";
import RecurringTasks from "./pages/RecurringTasks";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";

const NAV_ITEMS = [
  { to: "/", label: "Mijn overzicht", icon: "👤", end: true },
  { to: "/tickets", label: "Tickets", icon: "🎫" },
  { to: "/dashboard", label: "Dashboard", icon: "⊞" },
  { to: "/recurring", label: "Herhalend", icon: "🔄" },
  { to: "/reports", label: "Rapportage", icon: "📊" },
  { to: "/settings", label: "Instellingen", icon: "⚙️" },
];

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top navigatie */}
      <nav className="bg-hotel-900 text-white shadow-lg">
        <div className="max-w-5xl mx-auto px-4">
          <div className="flex items-center gap-1 h-14 overflow-x-auto">
            <span className="font-bold text-lg mr-3 text-white shrink-0">🎫 Hotel Tickets</span>
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
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
          <Route path="/recurring" element={<RecurringTasks />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}
