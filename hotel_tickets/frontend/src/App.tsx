import { useState, useEffect, useRef } from "react";
import { Routes, Route, NavLink, useNavigate, useLocation } from "react-router-dom";
import MijnOverzicht from "./pages/MijnOverzicht";
import Dashboard from "./pages/Dashboard";
import TicketList from "./pages/TicketList";
import TicketDetail from "./pages/TicketDetail";
import NewTicket from "./pages/NewTicket";
import RecurringTasks from "./pages/RecurringTasks";
import RecurringTaskDetail from "./pages/RecurringTaskDetail";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import PoolOverzicht from "./pages/PoolOverzicht";
import PoolLogboek from "./pages/PoolLogboek";
import PoolNieuweMeting from "./pages/PoolNieuweMeting";
import PoolLogDetail from "./pages/PoolLogDetail";
import PoolInstellingen from "./pages/PoolInstellingen";
import BikesDashboard from "./pages/BikesDashboard";
import BikeReserveringen from "./pages/BikeReserveringen";
import BikeNieuweReservering from "./pages/BikeNieuweReservering";
import BikeReserveringDetail from "./pages/BikeReserveringDetail";
import BikeBeheer from "./pages/BikeBeheer";
import BikeInstellingen from "./pages/BikeInstellingen";
import Instellingen from "./pages/Instellingen";
import { userApi, bikesModuleApi, type UserRole, type BikesModuleRoles } from "./api/client";

// --- Module configuratie ---

interface NavItem {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
  restricted: false | "adminOrSupervisor" | "settings";
}

interface ModuleConfig {
  id: string;
  label: string;
  icon: string;
  defaultPath: string;
  navTitle: string;
  navItems: NavItem[];
}

const MODULES: ModuleConfig[] = [
  {
    id: "taken",
    label: "Taken",
    icon: "✅",
    defaultPath: "/",
    navTitle: "Taken",
    navItems: [
      { to: "/", label: "Mijn overzicht", icon: "👤", end: true, restricted: false },
      { to: "/tickets", label: "Tickets", icon: "🎫", restricted: false },
      { to: "/dashboard", label: "Dashboard", icon: "⊞", restricted: false },
      { to: "/recurring", label: "Herhalend", icon: "🔄", restricted: false },
      { to: "/reports", label: "Rapportage", icon: "📊", restricted: "adminOrSupervisor" },
    ],
  },
  {
    id: "zwembaden",
    label: "Zwembaden",
    icon: "🏊",
    defaultPath: "/pools",
    navTitle: "Zwembaden",
    navItems: [
      { to: "/pools", label: "Overzicht", icon: "📋", end: true, restricted: false },
      { to: "/pools/logboek", label: "Logboek", icon: "📖", restricted: false },
      { to: "/pools/nieuw", label: "Nieuwe meting", icon: "➕", restricted: false },
    ],
  },
  {
    id: "fietsen",
    label: "Fietsen",
    icon: "🚲",
    defaultPath: "/bikes",
    navTitle: "Fietsen",
    navItems: [
      { to: "/bikes", label: "Dashboard", icon: "📋", end: true, restricted: false },
      { to: "/bikes/reserveringen", label: "Reserveringen", icon: "📅", restricted: false },
      { to: "/bikes/beheer", label: "Fietsbeheer", icon: "🔧", restricted: "adminOrSupervisor" },
    ],
  },
];

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserRole | null>(null);
  const [hasAdmin, setHasAdmin] = useState(true);
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [bikesModuleRoles, setBikesModuleRoles] = useState<BikesModuleRoles>("all");
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    Promise.all([userApi.me(), userApi.list(), bikesModuleApi.getSetting()])
      .then(([meRes, listRes, bikesRes]) => {
        setCurrentUser(meRes.data);
        setHasAdmin(listRes.data.some((u) => u.role === "admin"));
        setBikesModuleRoles(bikesRes.data.bikes_module_roles);
      })
      .catch(() => {});
  }, []);

  // Detecteer actieve module op basis van URL bij laden
  useEffect(() => {
    if (!activeModuleId) {
      if (location.pathname.startsWith("/pools")) {
        setActiveModuleId("zwembaden");
      } else if (location.pathname.startsWith("/bikes")) {
        setActiveModuleId("fietsen");
      } else if (location.pathname !== "") {
        setActiveModuleId("taken");
      }
    }
  }, []);

  // Sluit mobile menu bij navigatie
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  // Wis actieve module bij navigatie naar instellingen
  useEffect(() => {
    if (location.pathname === "/instellingen") {
      setActiveModuleId(null);
    }
  }, [location.pathname]);

  // Sluit mobile menu bij klik buiten het menu
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMobileMenuOpen(false);
      }
    }
    if (mobileMenuOpen) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [mobileMenuOpen]);

  const isAdminOrSupervisor =
    currentUser?.role === "admin" || currentUser?.role === "supervisor";

  // Filter de fietsenmodule op basis van de instelling
  const canSeeBikes =
    bikesModuleRoles === "all" ||
    (bikesModuleRoles === "reception" &&
      (currentUser?.role === "reception" || isAdminOrSupervisor)) ||
    (bikesModuleRoles === "admin_supervisor" && isAdminOrSupervisor);

  const visibleModules = MODULES.filter(
    (m) => m.id !== "fietsen" || canSeeBikes
  );

  const activeModule = visibleModules.find((m) => m.id === activeModuleId) || null;

  const visibleNavItems = (activeModule?.navItems || []).filter((item) => {
    if (item.restricted === "adminOrSupervisor") return isAdminOrSupervisor;
    if (item.restricted === "settings") return isAdminOrSupervisor || !hasAdmin;
    return true;
  });

  const isOnInstellingen = location.pathname === "/instellingen";
  const canSeeInstellingen = isAdminOrSupervisor || !hasAdmin;

  function handleModuleClick(mod: ModuleConfig) {
    setActiveModuleId(mod.id);
    navigate(mod.defaultPath);
  }

  return (
    <div className="flex min-h-screen bg-gray-50">
      {/* Desktop zijbalk — verborgen op mobile */}
      <aside className="hidden md:flex w-16 bg-gray-900 flex-col items-center shrink-0">
        {/* Kruispunt-vak: icoon van actieve pagina */}
        {activeModule && (
          <div className="flex items-center justify-center w-full h-14 text-2xl shrink-0">
            {activeModule.icon}
          </div>
        )}
        <div className="flex flex-col items-center gap-2 pt-2 w-full flex-1">
        {visibleModules.map((mod) => (
          <button
            key={mod.id}
            onClick={() => handleModuleClick(mod)}
            title={mod.label}
            className={`flex flex-col items-center gap-0.5 w-14 py-2.5 rounded-xl text-[10px] font-medium transition-colors ${
              activeModuleId === mod.id
                ? "bg-white/20 text-white"
                : "text-white/60 hover:text-white hover:bg-white/10"
            }`}
          >
            <span className="text-xl">{mod.icon}</span>
            <span className="leading-tight text-center truncate w-full px-0.5">{mod.label}</span>
          </button>
        ))}
        </div>
        {canSeeInstellingen && (
          <div className="mb-3">
            <button
              onClick={() => navigate("/instellingen")}
              title="Instellingen"
              className={`flex flex-col items-center gap-0.5 w-14 py-2.5 rounded-xl text-[10px] font-medium transition-colors ${
                isOnInstellingen
                  ? "bg-white/20 text-white"
                  : "text-white/60 hover:text-white hover:bg-white/10"
              }`}
            >
              <span className="text-xl">⚙️</span>
              <span className="leading-tight text-center truncate w-full px-0.5">Instellingen</span>
            </button>
          </div>
        )}
      </aside>

      {/* Rechter kolom: topnav + inhoud */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Top navigatie */}
        {activeModule && (
          <nav className="bg-hotel-900 text-white shadow-lg relative z-50">
            <div className="px-4">
              <div className="flex items-center gap-1 h-14">
                {/* Mobile hamburger menu */}
                <div className="md:hidden relative" ref={menuRef}>
                  <button
                    onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                    className="p-2 -ml-2 rounded-lg hover:bg-white/10 transition-colors"
                    aria-label="Menu"
                  >
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      {mobileMenuOpen ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                      )}
                    </svg>
                  </button>

                  {/* Dropdown menu */}
                  {mobileMenuOpen && (
                    <div className="absolute top-full left-0 mt-1 w-64 bg-gray-900 rounded-xl shadow-xl z-50 py-2 border border-white/10">
                      {/* Module knoppen */}
                      <div className="px-3 py-2 border-b border-white/10">
                        <span className="text-xs text-white/40 uppercase tracking-wide">Modules</span>
                        <div className="flex flex-wrap gap-2 mt-2">
                          {visibleModules.map((mod) => (
                            <button
                              key={mod.id}
                              onClick={() => handleModuleClick(mod)}
                              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                                activeModuleId === mod.id
                                  ? "bg-white/20 text-white"
                                  : "text-white/60 hover:text-white hover:bg-white/10"
                              }`}
                            >
                              <span>{mod.icon}</span>
                              <span>{mod.label}</span>
                            </button>
                          ))}
                          {canSeeInstellingen && (
                            <button
                              onClick={() => navigate("/instellingen")}
                              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                                isOnInstellingen
                                  ? "bg-white/20 text-white"
                                  : "text-white/60 hover:text-white hover:bg-white/10"
                              }`}
                            >
                              <span>⚙️</span>
                              <span>Instellingen</span>
                            </button>
                          )}
                        </div>
                      </div>
                      {/* Navigatie items actieve module */}
                      <div className="px-2 py-1">
                        {visibleNavItems.map((item) => (
                          <NavLink
                            key={item.to}
                            to={item.to}
                            end={item.end}
                            className={({ isActive }) =>
                              `flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors ${
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
                  )}
                </div>

                <span className="font-bold text-lg mr-3 text-white shrink-0">
                  {activeModule.navTitle}
                </span>
                {/* Desktop navigatie links */}
                <div className="hidden md:flex items-center gap-1 overflow-x-auto">
                  {visibleNavItems.map((item) => (
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
            </div>
          </nav>
        )}

        {/* Inhoud */}
        {activeModule || isOnInstellingen ? (
          <main className={`flex-1 px-4 py-6 w-full mx-auto ${location.pathname === "/pools/logboek" ? "" : "max-w-5xl"}`}>
            <Routes>
              {/* Taken module */}
              <Route path="/" element={<MijnOverzicht />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/tickets" element={<TicketList />} />
              <Route path="/tickets/new" element={<NewTicket />} />
              <Route path="/tickets/:id" element={<TicketDetail />} />
              <Route path="/recurring/:id" element={<RecurringTaskDetail />} />
              <Route path="/recurring" element={<RecurringTasks />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/settings" element={<Settings />} />
              {/* Zwembaden module */}
              <Route path="/pools" element={<PoolOverzicht />} />
              <Route path="/pools/logboek" element={<PoolLogboek />} />
              <Route path="/pools/nieuw" element={<PoolNieuweMeting />} />
              <Route path="/pools/log/:id" element={<PoolLogDetail />} />
              <Route path="/pools/instellingen" element={<PoolInstellingen />} />
              {/* Fietsen module */}
              <Route path="/bikes" element={<BikesDashboard />} />
              <Route path="/bikes/reserveringen" element={<BikeReserveringen />} />
              <Route path="/bikes/reserveringen/nieuw" element={<BikeNieuweReservering />} />
              <Route path="/bikes/reserveringen/:id" element={<BikeReserveringDetail />} />
              <Route path="/bikes/beheer" element={<BikeBeheer />} />
              <Route path="/bikes/instellingen" element={<BikeInstellingen />} />
              {/* Instellingen (globaal) */}
              <Route path="/instellingen" element={<Instellingen />} />
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
