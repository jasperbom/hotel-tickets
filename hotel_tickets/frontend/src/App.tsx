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
  { to: "/", label: "Mijn overzicht", shortLabel: "Overzicht", icon: "👤", end: true },
  { to: "/tickets", label: "Tickets", shortLabel: "Tickets", icon: "🎫" },
  { to: "/dashboard", label: "Dashboard", shortLabel: "Dashboard", icon: "⊞" },
  { to: "/recurring", label: "Herhalend", shortLabel: "Herhalend", icon: "🔄" },
  { to: "/reports", label: "Rapportage", shortLabel: "Rapport", icon: "📊" },
  { to: "/settings", label: "Instellingen", shortLabel: "Instellingen", icon: "⚙️" },
];

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top navigatie — desktop */}
      <nav className="hidden md:block bg-hotel-900 text-white shadow-lg">
        <div className="max-w-5xl mx-auto px-4">
          <div className="flex items-center gap-1 h-14">
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
            <a
              href="/"
              className="ml-auto shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors"
            >
              ← Naar dashboard
            </a>
          </div>
        </div>
      </nav>

      {/* HA-terugknop — mobiel */}
      <div className="md:hidden bg-hotel-900 text-white px-4 py-2 flex items-center">
        <a href="/" className="text-sm text-white/70 hover:text-white flex items-center gap-1 transition-colors">
          ← Naar dashboard
        </a>
      </div>

      {/* Inhoud */}
      <main className="max-w-5xl mx-auto px-4 py-6 pb-24 md:pb-6">
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
      {/* Bottom navigatie — mobiel/tablet */}
      <nav className="fixed bottom-0 left-0 right-0 bg-hotel-900 text-white shadow-[0_-2px_8px_rgba(0,0,0,0.2)] md:hidden z-50">
        <div className="flex">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center gap-0.5 py-2 text-[10px] transition-colors ${
                  isActive
                    ? "text-white bg-white/20"
                    : "text-white/60 hover:text-white hover:bg-white/10"
                }`
              }
            >
              <span className="text-xl leading-none">{item.icon}</span>
              <span>{item.shortLabel}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
