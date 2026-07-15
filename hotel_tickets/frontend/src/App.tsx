import { useState, useEffect, useRef } from "react";
import { Routes, Route, Navigate, NavLink, useNavigate, useLocation, useNavigationType } from "react-router-dom";
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
import BikesDashboard from "./pages/BikesDashboard";
import BikeReserveringen from "./pages/BikeReserveringen";
import BikeNieuweReservering from "./pages/BikeNieuweReservering";
import BikeReserveringDetail from "./pages/BikeReserveringDetail";
import BikeBeheer from "./pages/BikeBeheer";
import BikeInstellingen from "./pages/BikeInstellingen";
import Instellingen from "./pages/Instellingen";
import KennisBot from "./pages/KennisBot";
import KennisbankBeheer from "./pages/KennisbankBeheer";
import Berichten from "./pages/Berichten";
import WachtwoordWijzigen from "./pages/WachtwoordWijzigen";
import Login from "./pages/Login";
import { InboxEnvelope } from "./components/InboxEnvelope";
import { userApi, bikesModuleApi, brandingApi, hasSessionToken, clearSessionToken, type UserRole, type BikesModuleRoles } from "./api/client";
import { saveLastRoute } from "./lastRoute";
import { applyButtonPalette, applyAppBackground, readCachedAppBranding, saveCachedAppBranding } from "./branding";

// Laatst bekende huisstijl — direct beschikbaar zodat logo en merkkleur al in
// de eerste render kloppen; de API-respons corrigeert eventuele wijzigingen.
const cachedBranding = readCachedAppBranding();

// --- Module configuratie ---

interface NavItem {
  to: string;
  label: string;
  icon: string;
  end?: boolean;
  restricted: false | "adminOrSupervisor" | "admin" | "settings";
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
      { to: "/bikes/beheer", label: "Fietsbeheer", icon: "🔧", restricted: false },
    ],
  },
  {
    id: "kennis",
    label: "Kennis",
    icon: "💡",
    defaultPath: "/kennis",
    navTitle: "Kennisbot",
    navItems: [
      { to: "/kennis", label: "Vragen", icon: "💬", end: true, restricted: false },
      { to: "/kennis/beheer", label: "Beheer", icon: "🛠️", restricted: "admin" },
    ],
  },
];

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserRole | null>(null);
  const [hasAdmin, setHasAdmin] = useState(true);
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [bikesModuleRoles, setBikesModuleRoles] = useState<BikesModuleRoles>("all");
  const [brandColor, setBrandColor] = useState<string | null>(cachedBranding?.brand_color ?? null);
  const [brandLogo, setBrandLogo] = useState<string | null>(cachedBranding?.brand_logo ?? null);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();

  // Scroll naar boven bij het openen van een nieuwe pagina. Zonder dit behoudt
  // de app de scrollpositie van de vorige pagina — wie onderin de ticketlijst
  // een ticket opende, landde onderaan het ticket (bij het commentaar) in
  // plaats van bovenaan. Bij terug-navigatie (POP) niet forceren, zodat de
  // browser de positie in bv. de lijst kan bewaren.
  useEffect(() => {
    if (navigationType !== "POP") {
      window.scrollTo(0, 0);
    }
  }, [location.pathname, navigationType]);

  useEffect(() => {
    Promise.all([userApi.me(), userApi.list(), bikesModuleApi.getSetting(), brandingApi.get()])
      .then(([meRes, listRes, bikesRes, brandingRes]) => {
        setCurrentUser(meRes.data);
        setHasAdmin(listRes.data.some((u) => u.role === "admin"));
        setBikesModuleRoles(bikesRes.data.bikes_module_roles);
        const b = brandingRes.data;
        // Ook bij null expliciet zetten/wissen, zodat een in de instellingen
        // verwijderde huisstijl niet uit de cache blijft hangen.
        setBrandColor(b.brand_color);
        setBrandLogo(b.brand_logo);
        applyButtonPalette(b.btn_color);
        applyAppBackground(b.bg_image, b.bg_color);
        saveCachedAppBranding(b);
      })
      .catch(() => {});
  }, []);

  // Onthoud de huidige route met tijdstempel — het herstel gebeurt vóór de
  // eerste render in main.tsx (zie lastRoute.ts). Ook vlak vóór unload
  // (pagehide firet bij een refresh) verversen, zodat lang stilstaan op één
  // pagina de TTL niet laat verlopen.
  useEffect(() => {
    const save = () => saveLastRoute(location.pathname);
    save();
    window.addEventListener("pagehide", save);
    return () => window.removeEventListener("pagehide", save);
  }, [location.pathname]);

  // Bepaal de actieve module uit het huidige pad.
  useEffect(() => {
    const p = location.pathname;
    if (p.startsWith("/pools")) {
      setActiveModuleId("zwembaden");
    } else if (p.startsWith("/bikes")) {
      setActiveModuleId("fietsen");
    } else if (p.startsWith("/kennis")) {
      setActiveModuleId("kennis");
    } else if (p.startsWith("/instellingen") || p.startsWith("/wachtwoord")) {
      setActiveModuleId(null); // Instellingen/wachtwoord hebben geen module-context
    } else {
      setActiveModuleId("taken");
    }
  }, [location.pathname]);

  // Zorg dat het gefocuste input-veld op mobiel zichtbaar blijft wanneer
  // het virtuele toetsenbord opent. visualViewport.resize firet niet
  // betrouwbaar binnen een iframe op iOS (HA ingress) — daarom leunen we op:
  //   1. html { scroll-padding-bottom: 50vh } zodat de browser het target
  //      automatisch boven de toetsenbord-zone zet
  //   2. een focusin-fallback die ná de toetsenbord-animatie (~500ms) een
  //      plain scrollIntoView() doet zonder opties (opties/smooth-gedrag heeft
  //      gedocumenteerde bugs in iOS WKWebView)
  //
  // Alleen actief op touch-apparaten — op desktop geeft verspringen bij focus
  // een onprettig gevoel en is er geen toetsenbord dat content overdekt.
  useEffect(() => {
    const isTouch = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
    if (!isTouch) return;

    const SCROLLABLE_INPUT_TYPES = new Set([
      "text", "email", "number", "search", "password", "tel", "url",
      "date", "datetime-local", "month", "week", "time",
    ]);

    function shouldScroll(el: Element): boolean {
      // Pagina's met een eigen vaste-hoogte layout (bijv. de chatbot) regelen het
      // toetsenbord zelf via de visualViewport. De generieke scrollIntoView()-aanpak
      // zou daar de hele webview omhoog duwen en het invoerveld laten verspringen.
      if (el.closest("[data-no-kb-scroll]")) return false;
      const tag = el.tagName.toLowerCase();
      // Geen <select>: die opent een picker, geen toetsenbord — scrollen
      // veroorzaakte daar alleen een storende sprong.
      if (tag === "textarea") return true;
      if (tag === "input") {
        const type = ((el as HTMLInputElement).type || "text").toLowerCase();
        return SCROLLABLE_INPUT_TYPES.has(type);
      }
      return (el as HTMLElement).isContentEditable;
    }

    let scrollTimer: number | null = null;

    function handleFocusIn(e: FocusEvent) {
      const target = e.target as Element | null;
      if (!target || !shouldScroll(target)) return;
      if (scrollTimer !== null) window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        scrollTimer = null;
        if (document.activeElement !== target) return;
        // Alleen scrollen als het veld daadwerkelijk (deels) buiten beeld of
        // achter het toetsenbord staat. Een veld dat al zichtbaar is met rust
        // laten — het geforceerde springen liet ingevulde formulieren uit
        // beeld schieten alsof alles "weg" was.
        const el = target as HTMLElement;
        const rect = el.getBoundingClientRect();
        const visibleHeight = Math.min(
          window.visualViewport?.height ?? Infinity,
          window.innerHeight,
        );
        if (rect.top < 0) {
          // Boven beeld: plain scrollIntoView (block: start) — de enige
          // variant die in iOS WKWebView-iframes stabiel werkt.
          el.scrollIntoView();
        } else if (rect.bottom > visibleHeight - 8) {
          // Achter het toetsenbord: minimaal omhoog scrollen (block: end);
          // de scroll-padding-bottom op <html> houdt het veld erboven.
          el.scrollIntoView(false);
        }
      }, 500);
    }

    function handleFocusOut() {
      if (scrollTimer !== null) {
        window.clearTimeout(scrollTimer);
        scrollTimer = null;
      }
    }

    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    return () => {
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
      if (scrollTimer !== null) window.clearTimeout(scrollTimer);
    };
  }, []);

  // Meet de werkelijke hoogte van het virtuele toetsenbord via de
  // visualViewport en zet die als CSS-variabele --kb-inset. scroll-padding-bottom
  // en de onderkant-padding (index.css) gebruiken deze waarde in plaats van een
  // vaste 50vh. Daardoor scrolt een gefocust veld nog maar nét tot boven het
  // toetsenbord, in plaats van een halve scherm omhoog te springen met een grote
  // lege ruimte eronder. Bij een gesloten toetsenbord is de inset 0 (geen gat).
  useEffect(() => {
    const isTouch = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
    const vv = window.visualViewport;
    if (!isTouch || !vv) return;
    const root = document.documentElement;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        // Verschil tussen layout-viewport en zichtbare viewport = toetsenbord.
        // Kleine verschillen (bijv. de adresbalk) tellen niet als toetsenbord.
        const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        root.style.setProperty("--kb-inset", kb < 120 ? "0px" : `${Math.round(kb)}px`);
      });
    };
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
      cancelAnimationFrame(raf);
      root.style.removeProperty("--kb-inset");
    };
  }, []);

  // Sluit mobile menu bij navigatie
  useEffect(() => {
    setMobileMenuOpen(false);
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
      (currentUser?.department === "reception" || isAdminOrSupervisor)) ||
    (bikesModuleRoles === "admin_supervisor" && isAdminOrSupervisor);

  const visibleModules = MODULES.filter(
    (m) => m.id !== "fietsen" || canSeeBikes
  );

  const activeModule = visibleModules.find((m) => m.id === activeModuleId) || null;

  const visibleNavItems = (activeModule?.navItems || []).filter((item) => {
    if (item.restricted === "adminOrSupervisor") return isAdminOrSupervisor;
    if (item.restricted === "admin") return currentUser?.role === "admin";
    if (item.restricted === "settings") return isAdminOrSupervisor || !hasAdmin;
    return true;
  });

  const isOnInstellingen = location.pathname === "/instellingen";
  const isOnWachtwoord = location.pathname === "/wachtwoord";
  const canSeeInstellingen = isAdminOrSupervisor || !hasAdmin;

  // Zwevende actieknoppen (nieuw ticket + kennisbot-vraag) onderin.
  // Niet op de pagina's waar ze dubbelop of in de weg zijn: het nieuw-ticket-
  // formulier zelf en de kennisbot (die heeft een eigen invoerbalk onderin).
  const showFabs =
    (activeModule || isOnInstellingen) &&
    !["/tickets/new", "/kennis"].includes(location.pathname);

  // Pagina's buiten module-context die wél in de app-shell renderen
  const isShellPage = isOnInstellingen || isOnWachtwoord;

  function handleModuleClick(mod: ModuleConfig) {
    setActiveModuleId(mod.id);
    navigate(mod.defaultPath);
  }

  function handleLogout() {
    clearSessionToken();
    window.location.hash = "#/login";
    window.location.reload();
  }

  // Standalone loginpagina — buiten de app-shell (geen navigatie eromheen)
  if (location.pathname === "/login") {
    return <Login />;
  }

  return (
    <div data-app-root className="flex min-h-[100dvh]">
      {/* Desktop zijbalk — verborgen op mobile */}
      <aside
        className="hidden md:flex w-16 flex-col items-center shrink-0 sticky top-0 h-[100dvh]"
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
        <div className="mb-3">
          <button
            onClick={() => navigate("/wachtwoord")}
            title="Wachtwoord wijzigen"
            className={`flex flex-col items-center gap-0.5 w-14 py-2.5 rounded-xl text-[10px] font-medium transition-colors ${
              isOnWachtwoord
                ? "bg-white/20 text-white"
                : "text-white/60 hover:text-white hover:bg-white/10"
            }`}
          >
            <span className="text-xl">🔑</span>
            <span className="leading-tight text-center truncate w-full px-0.5">Wachtwoord</span>
          </button>
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
        {hasSessionToken() && (
          <div className="mb-3">
            <button
              onClick={handleLogout}
              title="Uitloggen"
              className="flex flex-col items-center gap-0.5 w-14 py-2.5 rounded-xl text-[10px] font-medium text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            >
              <span className="text-xl">🚪</span>
              <span className="leading-tight text-center truncate w-full px-0.5">Uitloggen</span>
            </button>
          </div>
        )}
      </aside>

      {/* Rechter kolom: topnav + inhoud */}
      <div className="flex flex-col flex-1 min-w-0">
        {/* Top navigatie */}
        {(activeModule || isShellPage) && (
          // paddingTop: in web-app-modus op iOS (statusbalk over de pagina heen)
          // schuift de balkinhoud onder de statusbalk uit; de brandkleur vult
          // de safe-area zodat het er native uitziet.
          <nav
            className="text-white shadow-lg sticky top-0 z-50"
            style={{ backgroundColor: brandColor ?? "#1e3a5f", paddingTop: "env(safe-area-inset-top, 0px)" }}
          >
            <div className="px-4">
              <div className="flex items-center gap-1 h-14 min-w-0">
                {/* Modulewisselaar knop (mobiel: toont dropdown, desktop: verborgen want
                    zijbalk). Logo + modulenaam + chevron vormen samen één knop, zodat
                    zichtbaar is dát dit een menu opent — een kaal logo nodigt niet uit. */}
                <div className="md:hidden relative min-w-0 shrink-0" ref={menuRef}>
                  <button
                    onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                    title="Modules"
                    aria-haspopup="menu"
                    aria-expanded={mobileMenuOpen}
                    className={`flex items-center gap-1.5 h-9 -ml-1 pl-1 pr-1.5 rounded-lg transition-colors ${
                      mobileMenuOpen ? "bg-white/20" : "hover:bg-white/10 active:bg-white/10"
                    }`}
                  >
                    {brandLogo ? (
                      <img src={brandLogo} alt="" className="w-6 h-6 object-contain rounded shrink-0" />
                    ) : (
                      <span className="text-xl font-bold text-white select-none shrink-0">S</span>
                    )}
                    <span className="font-bold text-base text-white truncate">
                      {activeModule?.navTitle ?? (isOnWachtwoord ? "Wachtwoord" : "Instellingen")}
                    </span>
                    {activeModule?.id === "kennis" && (
                      <span className="text-[9px] font-bold uppercase tracking-wide bg-amber-400 text-amber-900 px-1.5 py-0.5 rounded leading-none shrink-0">
                        Beta
                      </span>
                    )}
                    <svg
                      className={`w-3 h-3 text-white/70 shrink-0 transition-transform ${mobileMenuOpen ? "rotate-180" : ""}`}
                      viewBox="0 0 12 12"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>

                  {/* Module-dropdown */}
                  {mobileMenuOpen && (
                    <div className="absolute top-full left-0 mt-2 w-56 bg-gray-900 rounded-xl shadow-2xl z-50 py-1.5 border border-white/10">
                      <div className="px-4 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-white/40 select-none">
                        Modules
                      </div>
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
                      <div className="mx-3 my-1 border-t border-white/10" />
                      <button
                        onClick={() => navigate("/wachtwoord")}
                        className={`flex items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors ${
                          isOnWachtwoord
                            ? "bg-white/20 text-white"
                            : "text-white/70 hover:text-white hover:bg-white/10"
                        }`}
                      >
                        <span className="text-lg">🔑</span>
                        <span>Wachtwoord wijzigen</span>
                        {isOnWachtwoord && <span className="ml-auto text-white/40 text-xs">✓</span>}
                      </button>
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
                      {hasSessionToken() && (
                        <>
                          <div className="mx-3 my-1 border-t border-white/10" />
                          <button
                            onClick={handleLogout}
                            className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                          >
                            <span className="text-lg">🚪</span>
                            <span>Uitloggen</span>
                          </button>
                        </>
                      )}
                    </div>
                  )}
                </div>

                {/* Op mobiel staat de titel al in de modulewisselaar-knop hierboven */}
                <span className="hidden md:flex font-bold text-lg mr-3 text-white shrink-0 items-center gap-1.5">
                  {activeModule?.navTitle ?? (isOnWachtwoord ? "Wachtwoord" : "Instellingen")}
                  {activeModule?.id === "kennis" && (
                    <span className="text-[9px] font-bold uppercase tracking-wide bg-amber-400 text-amber-900 px-1.5 py-0.5 rounded leading-none">
                      Beta
                    </span>
                  )}
                </span>

                {/* Navigatie links — altijd zichtbaar, horizontaal scrollbaar op mobiel */}
                <div className="flex items-center gap-0.5 md:gap-1 overflow-x-auto scrollbar-none min-w-0 flex-1">
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

                {/* Envelopje: ongelezen berichten (@-mentions + commentaar op eigen tickets) */}
                <div className="ml-auto shrink-0">
                  <InboxEnvelope />
                </div>
              </div>
            </div>
          </nav>
        )}

        {/* Inhoud */}
        {activeModule || isShellPage ? (
          <main
            className={`flex-1 px-4 py-6 w-full mx-auto ${location.pathname === "/kennis" ? "" : "touch-keyboard-pb"} ${["/pools/logboek", "/bikes", "/bikes/reserveringen"].includes(location.pathname) ? "" : "max-w-5xl"} ${showFabs ? "pb-28" : ""}`}
          >
            <Routes>
              {/* Taken module */}
              <Route path="/" element={<MijnOverzicht />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/tickets" element={<TicketList />} />
              <Route path="/tickets/new" element={<NewTicket />} />
              <Route path="/tickets/:id" element={<TicketDetail />} />
              <Route path="/berichten" element={<Berichten />} />
              <Route path="/recurring/:id" element={<RecurringTaskDetail />} />
              <Route path="/recurring" element={<RecurringTasks />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/settings" element={<Settings />} />
              {/* Zwembaden module */}
              <Route path="/pools" element={<PoolOverzicht />} />
              <Route path="/pools/logboek" element={<PoolLogboek />} />
              <Route path="/pools/nieuw" element={<PoolNieuweMeting />} />
              <Route path="/pools/log/:id" element={<PoolLogDetail />} />
              {/* Fietsen module */}
              <Route path="/bikes" element={<BikesDashboard />} />
              <Route path="/bikes/reserveringen" element={<BikeReserveringen />} />
              <Route path="/bikes/reserveringen/nieuw" element={<BikeNieuweReservering />} />
              <Route path="/bikes/reserveringen/:id" element={<BikeReserveringDetail />} />
              <Route path="/bikes/beheer" element={<BikeBeheer />} />
              <Route path="/bikes/instellingen" element={<BikeInstellingen />} />
              {/* Kennisbank module */}
              <Route path="/kennis" element={<KennisBot />} />
              <Route
                path="/kennis/beheer"
                element={
                  // Beheer is alleen voor admins. Tijdens het laden (currentUser
                  // nog niet bekend) niet beslissen, zodat een admin niet ten
                  // onrechte wordt weggestuurd.
                  currentUser == null ? (
                    <div className="text-sm text-gray-400">Laden…</div>
                  ) : currentUser.role === "admin" ? (
                    <KennisbankBeheer />
                  ) : (
                    <Navigate to="/kennis" replace />
                  )
                }
              />
              {/* Instellingen (globaal) */}
              <Route path="/instellingen" element={<Instellingen />} />
              {/* Wachtwoord wijzigen (voor iedereen) */}
              <Route path="/wachtwoord" element={<WachtwoordWijzigen />} />
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

        {/* Zwevende actieknoppen */}
        {showFabs && (
          <div
            className="fixed right-4 z-40 flex items-center gap-2"
            style={{ bottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
          >
            <button
              onClick={() => navigate("/kennis")}
              className="flex items-center gap-1.5 bg-white text-gray-700 border border-gray-200 shadow-lg rounded-full pl-3 pr-4 py-2.5 text-sm font-medium hover:bg-gray-50 active:scale-95 transition"
            >
              <span className="text-base leading-none">💬</span>
              <span>Stel een vraag</span>
            </button>
            <button
              onClick={() => navigate("/tickets/new")}
              className="flex items-center gap-1.5 bg-blue-600 text-white shadow-lg rounded-full pl-3 pr-4 py-2.5 text-sm font-semibold hover:bg-blue-700 active:scale-95 transition"
            >
              <span className="text-base leading-none font-bold">＋</span>
              <span>Nieuw ticket</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
