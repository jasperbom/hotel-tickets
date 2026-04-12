import { useState, useEffect } from "react";
import { Routes, Route, NavLink, useNavigate } from "react-router-dom";
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

const MODULES = [
  { id: "taken", label: "Taken", icon: "✅" },
] as const;

type ModuleId = typeof MODULES[number]["id"] | null;

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserRole | null>(null);
  const [hasAdmin, setHasAdmin] = useState(true);
  const [activeModule, setActiveModule] = useState<ModuleId>(null);
  const navigate = useNavigate();

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

  function handleModuleClick(id: ModuleId) {
    setActiveModule(id);
    navigate("/");
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Linker zijbalk */}
      <aside className="w-16 bg-gray-900 flex flex-col items-center pt-4 gap-2 shrink-0">
        {MODULES.map((mod) => (
          <button
            key={mod.id}
            onClick={() => handleModuleClick(mod.id)}
            title={mod.label}
            className={`flex flex-col items-center gap-1 w-12 py-3 rounded-xl text-xs font-medium transition-colors ${
              activeModule === mod.id
                ? "bg-white/20 text-white"
                : "text-white/60 hover:text-white hover:bg-white/10"
            }`}
          >
            <span className="text-xl">{mod.icon}</span>
            <span className="leading-tight text-center">{mod.label}</span>
          </button>
        ))}
      </aside>

      {/* Rechter kolom: topnav + inhoud */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Top navigatie — alleen zichtbaar als een module actief is */}
        {activeModule && (
          <nav className="bg-hotel-900 text-white shadow-lg">
            <div className="px-4">
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
        )}

        {/* Inhoud */}
        {activeModule ? (
          <main className="flex-1 px-4 py-6 max-w-5xl w-full mx-auto">
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
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400 text-lg">
            <div className="text-center">
              <div className="text-5xl mb-4">👈</div>
              <p>Kies een module in de zijbalk</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
