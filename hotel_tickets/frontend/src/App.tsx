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
      {/* Inhoud */}
      <main className="max-w-5xl mx-auto px-4 py-6 pb-24">
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

      {/* Bottom navigatie — alle schermformaten */}
      <nav className="fixed bottom-0 left-0 right-0 bg-hotel-900 text-white shadow-[0_-2px_8px_rgba(0,0,0,0.2)] z-50">
        <div className="flex max-w-5xl mx-auto">
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
