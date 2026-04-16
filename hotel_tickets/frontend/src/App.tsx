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
import { userApi, bikesModuleApi, brandingApi, type UserRole, type BikesModuleRoles } from "./api/client";

// --- Kleurpalet hulpfuncties ---

function hexToHsl(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  switch (max) {
    case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
    case g: h = ((b - r) / d + 2) / 6; break;
    case b: h = ((r - g) / d + 4) / 6; break;
  }
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))));
  return "#" + [f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, "0")).join("");
}

function applyButtonPalette(hex: string) {
  const [h, s] = hexToHsl(hex);
  const sat = Math.min(s * 1.1, 95);
  const root = document.documentElement;
  root.style.setProperty("--blue-50",  hslToHex(h, Math.min(s * 0.25, 40), 97));
  root.style.setProperty("--blue-100", hslToHex(h, Math.min(s * 0.4,  60), 93));
  root.style.setProperty("--blue-200", hslToHex(h, Math.min(s * 0.6,  75), 87));
  root.style.setProperty("--blue-300", hslToHex(h, sat, 78));
  root.style.setProperty("--blue-400", hslToHex(h, sat, 68));
  root.style.setProperty("--blue-500", hslToHex(h, sat, 58));
  root.style.setProperty("--blue-600", hex);
  root.style.setProperty("--blue-700", hslToHex(h, sat, 42));
  root.style.setProperty("--blue-800", hslToHex(h, sat, 35));
  root.style.setProperty("--blue-900", hslToHex(h, sat, 28));
}

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
  const [brandColor, setBrandColor] = useState<string | null>(null);
  const [brandLogo, setBrandLogo] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    Promise.all([userApi.me(), userApi.list(), bikesModuleApi.getSetting(), brandingApi.get()])
      .then(([meRes, listRes, bikesRes, brandingRes]) => {
        setCurrentUser(meRes.data);
        setHasAdmin(listRes.data.some((u) => u.role === "admin"));
        setBikesModuleRoles(bikesRes.data.bikes_module_roles);
        const b = brandingRes.data;
        if (b.brand_color) setBrandColor(b.brand_color);
        if (b.brand_logo) setBrandLogo(b.brand_logo);
        if (b.btn_color) applyButtonPalette(b.btn_color);
        const root = document.documentElement;
        if (b.bg_image) {
          root.style.setProperty("--app-bg-image", `url("${b.bg_image}")`);
        } else if (b.bg_color) {
          root.style.setProperty("--app-bg", b.bg_color);
        }
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
    <div className="flex min-h-screen">
      {/* Desktop zijbalk — verborgen op mobile */}
      <aside
        className="hidden md:flex w-16 flex-col items-center shrink-0 sticky top-0 h-screen"
        style={{ backgroundColor: brandColor ?? "#111827" }}
      >
        {/* Logo bovenin zijbalk */}
        <div className="flex items-center justify-center w-full h-14 shrink-0">
          {brandLogo ? (
            <img src={brandLogo} alt="Logo" className="w-8 h-8 object-contain rounded" />
          ) : (
            <span className="text-2xl font-bold text-white/80 select-none">S</span>
          )}
        </div>
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
        {(activeModule || isOnInstellingen) && (
          <nav className="text-white shadow-lg sticky top-0 z-50" style={{ backgroundColor: brandColor ?? "#1e3a5f" }}>
            <div className="px-4">
              <div className="flex items-center gap-1 h-14 min-w-0">
                {/* Modulewisselaar knop (mobiel: toont dropdown, desktop: verborgen want zijbalk) */}
                <div className="md:hidden relative shrink-0" ref={menuRef}>
                  <button
                    onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                    title="Modules"
                    className={`flex items-center justify-center w-9 h-9 -ml-1 rounded-lg transition-colors ${
                      mobileMenuOpen ? "bg-white/20" : "hover:bg-white/10"
                    }`}
                  >
                    {brandLogo ? (
                      <img src={brandLogo} alt="Menu" className="w-6 h-6 object-contain rounded" />
                    ) : (
                      <span className="text-xl font-bold text-white select-none">S</span>
                    )}
                  </button>

                  {/* Module-dropdown */}
                  {mobileMenuOpen && (
                    <div className="absolute top-full left-0 mt-2 w-52 bg-gray-900 rounded-xl shadow-2xl z-50 py-1.5 border border-white/10">
                      {visibleModules.map((mod) => (
                        <button
                          key={mod.id}
                          onClick={() => handleModuleClick(mod)}
                          className={`flex items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors ${
                            activeModuleId === mod.id
                              ? "bg-white/20 text-white"
                              : "text-white/70 hover:text-white hover:bg-white/10"
                          }`}
                        >
                          <span className="text-lg">{mod.icon}</span>
                          <span>{mod.label}</span>
                          {activeModuleId === mod.id && <span className="ml-auto text-white/40 text-xs">✓</span>}
                        </button>
                      ))}
                      {canSeeInstellingen && (
                        <>
                          <div className="mx-3 my-1 border-t border-white/10" />
                          <button
                            onClick={() => navigate("/instellingen")}
                            className={`flex items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors ${
                              isOnInstellingen
                                ? "bg-white/20 text-white"
                                : "text-white/70 hover:text-white hover:bg-white/10"
                            }`}
                          >
                            <span className="text-lg">⚙️</span>
                            <span>Instellingen</span>
                            {isOnInstellingen && <span className="ml-auto text-white/40 text-xs">✓</span>}
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                <span className="font-bold text-base md:text-lg mr-1 md:mr-3 text-white shrink-0">
                  {activeModule?.navTitle ?? "Instellingen"}
                </span>

                {/* Navigatie links — altijd zichtbaar, horizontaal scrollbaar op mobiel */}
                <div className="flex items-center gap-0.5 md:gap-1 overflow-x-auto scrollbar-none min-w-0">
                  {visibleNavItems.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        `flex items-center gap-1 md:gap-1.5 px-2 md:px-3 py-1.5 rounded-lg text-xs md:text-sm transition-colors shrink-0 ${
                          isActive
                            ? "bg-white/20 text-white"
                            : "text-white/70 hover:text-white hover:bg-white/10"
                        }`
                      }
                    >
                      <span className="hidden sm:inline">{item.icon}</span>
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
