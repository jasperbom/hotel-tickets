import { useState, useEffect, useRef } from "react";
import { Routes, Route, Navigate, NavLink, useNavigate, useLocation, useNavigationType } from "react-router-dom";
import MijnOverzicht from "./pages/MijnOverzicht";
import TicketList from "./pages/TicketList";
import TicketDetail from "./pages/TicketDetail";
import Kamers from "./pages/Kamers";
import Meer from "./pages/Meer";
import NewTicket from "./pages/NewTicket";
import RecurringTasks from "./pages/RecurringTasks";
import RecurringTaskDetail from "./pages/RecurringTaskDetail";
import Reports from "./pages/Reports";
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
import Apparaten from "./pages/Apparaten";
import Meldingen from "./pages/Meldingen";
import Login from "./pages/Login";
import { userApi, bikesModuleApi, brandingApi, betaApi, ticketApi, hasSessionToken, clearSessionToken, sessionsApi, type UserRole, type BikesModuleRoles, type BetaStatus } from "./api/client";
import { saveLastRoute } from "./lastRoute";
import { useOngelezen } from "./ongelezen";
// Iconen per stuk importeren; de regel is: nooit een icoon zonder tekstlabel,
// behalve terug, sluiten en camera.
import type { LucideIcon } from "lucide-react";
import {
  Bike, CircleDot, CircleUser, DoorClosed, LayoutList, Lightbulb,
  ListChecks, MoreHorizontal, Plus, Waves,
} from "lucide-react";
import { applyButtonPalette, applyAppBackground, leesbareTekstkleur, readCachedAppBranding, saveCachedAppBranding } from "./branding";

// Laatst bekende huisstijl — direct beschikbaar zodat logo en merkkleur al in
// de eerste render kloppen; de API-respons corrigeert eventuele wijzigingen.
const cachedBranding = readCachedAppBranding();

// --- Module configuratie ---

interface NavItem {
  to: string;
  label: string;
  icon?: LucideIcon;
  end?: boolean;
  restricted?: "adminOrSupervisor" | "admin";
}

interface ModuleConfig {
  id: string;
  label: string;
  icon: LucideIcon;
  defaultPath: string;
  navTitle: string;
  /** Alle schermen van de module — op desktop de kolom van 220 px. */
  schermen: NavItem[];
}

/**
 * Mobiele onderbalk: vier items met een permanent label. De modules staan in
 * Meer; wie dagelijks in Zwembaden werkt zet die als startscherm, en dat is
 * een voorkeur van een enkeling — geen tab voor iedereen.
 */
const ONDERBALK: NavItem[] = [
  { to: "/", label: "Vandaag", icon: CircleDot, end: true },
  { to: "/tickets", label: "Tickets", icon: LayoutList },
  { to: "/kamers", label: "Kamers", icon: DoorClosed },
  { to: "/meer", label: "Meer", icon: MoreHorizontal },
];

const MODULES: ModuleConfig[] = [
  {
    id: "taken",
    label: "Taken",
    icon: ListChecks,
    defaultPath: "/",
    navTitle: "Taken",
    schermen: [
      { to: "/", label: "Vandaag", end: true },
      { to: "/tickets", label: "Tickets" },
      { to: "/kamers", label: "Kamers" },
      { to: "/recurring", label: "Herhalend" },
      { to: "/berichten", label: "Berichten" },
      { to: "/reports", label: "Rapportage", restricted: "adminOrSupervisor" },
    ],
  },
  {
    id: "zwembaden",
    label: "Zwembaden",
    icon: Waves,
    defaultPath: "/pools",
    navTitle: "Zwembaden",
    schermen: [
      { to: "/pools", label: "Overzicht", end: true },
      { to: "/pools/logboek", label: "Logboek" },
      { to: "/pools/nieuw", label: "Nieuwe meting" },
    ],
  },
  {
    id: "fietsen",
    label: "Fietsen",
    icon: Bike,
    defaultPath: "/bikes",
    navTitle: "Fietsen",
    schermen: [
      { to: "/bikes", label: "Overzicht", end: true },
      { to: "/bikes/reserveringen", label: "Reserveringen" },
      { to: "/bikes/beheer", label: "Fietsbeheer" },
    ],
  },
  {
    id: "kennis",
    label: "Kennis",
    icon: Lightbulb,
    defaultPath: "/kennis",
    navTitle: "Kennisbot",
    schermen: [
      { to: "/kennis", label: "Vragen", end: true },
      { to: "/kennis/beheer", label: "Beheer", restricted: "admin" },
    ],
  },
];

export default function App() {
  const [currentUser, setCurrentUser] = useState<UserRole | null>(null);
  const [hasAdmin, setHasAdmin] = useState(true);
  const [activeModuleId, setActiveModuleId] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [openTickets, setOpenTickets] = useState<number | null>(null);
  const [bikesModuleRoles, setBikesModuleRoles] = useState<BikesModuleRoles>("all");
  const [brandColor, setBrandColor] = useState<string | null>(cachedBranding?.brand_color ?? null);
  const [brandLogo, setBrandLogo] = useState<string | null>(cachedBranding?.brand_logo ?? null);
  const [beta, setBeta] = useState<BetaStatus | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const ongelezen = useOngelezen();

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

  // Draait deze installatie als beta-testomgeving? Dan komt er een duidelijke
  // balk bovenin en krijgt het tabblad een eigen titel, zodat je nooit per
  // ongeluk in de testomgeving zit te werken.
  useEffect(() => {
    betaApi.status()
      .then((r) => {
        setBeta(r.data);
        if (r.data.beta_mode) {
          document.title = `${r.data.label} — Hotel Tickets`;
        }
      })
      .catch(() => {});
  }, []);

  // Teller naast "Tickets" in de desktopkolom.
  useEffect(() => {
    ticketApi.counts({})
      .then((r) => setOpenTickets((r.data.open ?? 0) + (r.data.in_progress ?? 0)))
      .catch(() => setOpenTickets(null));
  }, [location.pathname]);

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
    } else if (p.startsWith("/instellingen") || p.startsWith("/wachtwoord") || p.startsWith("/apparaten") || p.startsWith("/meldingen")) {
      setActiveModuleId(null); // Instellingen/wachtwoord/apparaten/meldingen hebben geen module-context
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
  // Sluit het accountmenu bij navigatie
  useEffect(() => {
    setAccountOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setAccountOpen(false);
      }
    }
    if (accountOpen) {
      document.addEventListener("mousedown", handleClick);
      return () => document.removeEventListener("mousedown", handleClick);
    }
  }, [accountOpen]);

  const isAdminOrSupervisor =
    currentUser?.role === "admin" || currentUser?.role === "supervisor";

  // Rapportage volgt standaard de rol; een expliciete schakelaar op het profiel
  // wint. Zo kan een hoofd huishouding rapportage krijgen zonder supervisor te
  // worden.
  const magRapportage = currentUser?.can_reports ?? isAdminOrSupervisor;

  /**
   * Modules per gebruiker: dat is zichtbaarheid van gereedschap, niet van
   * andermans werk — daarom mag dit wél verborgen worden. Leeg of niet gezet
   * betekent alles.
   */
  const toegestaneModules = currentUser?.modules ?? null;

  // Filter de fietsenmodule op basis van de instelling
  const canSeeBikes =
    bikesModuleRoles === "all" ||
    (bikesModuleRoles === "reception" &&
      (currentUser?.department === "reception" || isAdminOrSupervisor)) ||
    (bikesModuleRoles === "admin_supervisor" && isAdminOrSupervisor);

  const visibleModules = MODULES.filter(
    (m) =>
      (m.id !== "fietsen" || canSeeBikes) &&
      (!toegestaneModules || toegestaneModules.length === 0 || toegestaneModules.includes(m.id))
  );
  const activeModule = visibleModules.find((m) => m.id === activeModuleId) || null;
  const canSeeInstellingen = isAdminOrSupervisor || !hasAdmin;

  const zichtbareSchermen = (activeModule?.schermen ?? []).filter((item) => {
    if (item.restricted === "adminOrSupervisor") return magRapportage;
    if (item.restricted === "admin") return currentUser?.role === "admin";
    return true;
  });

  // Eén primaire actie: melden. Niet op de invoerformulieren zelf (die hebben
  // hun eigen knop onderin) en niet in de kennisbot (eigen invoerbalk).
  // Op het ticketdetail staat de eigen actiebalk onderin; een meldknop
  // erbovenop zou precies die knop afdekken.
  const toonMelden =
    activeModuleId === "taken" &&
    !location.pathname.startsWith("/tickets/") &&
    !["/kennis", "/meer"].includes(location.pathname);

  function handleModuleClick(mod: ModuleConfig) {
    setActiveModuleId(mod.id);
    navigate(mod.defaultPath);
  }

  async function handleLogout() {
    // Trek de server-side sessie in zodat dit token nergens meer geldig is.
    // Best effort: ook bij een netwerkfout loggen we lokaal uit.
    try {
      await sessionsApi.logout();
    } catch {
      /* negeren — lokaal token wordt hoe dan ook gewist */
    }
    clearSessionToken();
    window.location.hash = "#/login";
    window.location.reload();
  }

  // Standalone loginpagina — buiten de app-shell (geen navigatie eromheen)
  if (location.pathname === "/login") {
    return <Login />;
  }

  const schermTitel = SCHERMTITELS[location.pathname] ?? afgeleideTitel(location.pathname, activeModule);

  // Tekst op de merkkleur wordt berekend in plaats van gegokt: bij een lichte
  // merkkleur haalde wit (en zeker text-white/60) het contrast niet.
  const merkAchtergrond = brandColor ?? "#1C1B19";
  const opMerk = leesbareTekstkleur(merkAchtergrond);

  return (
    <>
      {beta?.beta_mode && (
        <div
          className="flex items-center justify-center gap-2 flex-wrap px-3 py-1.5 bg-amber-400 text-amber-950 text-xs font-semibold text-center"
          style={{ paddingTop: "calc(0.375rem + env(safe-area-inset-top, 0px))" }}
        >
          <span className="uppercase tracking-wider bg-amber-950 text-amber-50 px-1.5 py-0.5 rounded">
            {beta.label}
          </span>
          <span className="font-normal">
            Testomgeving met een kopie van de echte data — meldingen staan uit. v{beta.version}
          </span>
        </div>
      )}

      <div data-app-root className="flex min-h-[100dvh]">
        {/* ── Desktop: rail van 64 px met de modules ───────────────────────── */}
        <aside
          className="hidden md:flex w-16 flex-col items-center shrink-0 sticky top-0 h-[100dvh]"
          style={{ backgroundColor: merkAchtergrond, color: opMerk }}
        >
          <div className="flex items-center justify-center w-full h-14 shrink-0">
            {brandLogo ? (
              <img src={brandLogo} alt="Logo" className="w-8 h-8 object-contain rounded" />
            ) : (
              <span className="text-2xl font-bold opacity-80 select-none">S</span>
            )}
          </div>
          <div className="flex flex-col items-center gap-2 pt-2 w-full flex-1">
            {visibleModules.map((mod) => (
              <button
                key={mod.id}
                onClick={() => handleModuleClick(mod)}
                title={mod.label}
                className={`flex flex-col items-center gap-0.5 w-14 py-2.5 rounded-xl text-[10px] font-medium transition-colors ${
                  activeModuleId === mod.id ? "bg-paper-raised/20 opacity-100" : "opacity-60 hover:opacity-100 hover:bg-paper-raised/10"
                }`}
              >
                <mod.icon size={20} strokeWidth={1.75} aria-hidden="true" />
                <span className="leading-tight text-center truncate w-full px-0.5">{mod.label}</span>
              </button>
            ))}
          </div>

          {/* Eén accountmenu onderaan in plaats van vijf losse iconen */}
          <div className="relative mb-3" ref={menuRef}>
            <button
              onClick={() => setAccountOpen(!accountOpen)}
              title="Account"
              aria-haspopup="menu"
              aria-expanded={accountOpen}
              className={`flex flex-col items-center gap-0.5 w-14 py-2.5 rounded-xl text-[10px] font-medium transition-colors ${
                accountOpen ? "bg-paper-raised/20 opacity-100" : "opacity-60 hover:opacity-100 hover:bg-paper-raised/10"
              }`}
            >
              <CircleUser size={20} strokeWidth={1.75} aria-hidden="true" />
              <span className="leading-tight text-center truncate w-full px-0.5">Account</span>
            </button>
            {accountOpen && (
              <div className="absolute bottom-0 left-full ml-2 w-56 bg-ink rounded-xl shadow-2xl z-50 py-1.5 border border-white/10">
                <div className="px-4 pt-1.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-white/40 select-none">
                  {currentUser?.display_name ?? "Account"}
                </div>
                <AccountKnop label="Wachtwoord wijzigen" onClick={() => navigate("/wachtwoord")} />
                <AccountKnop label="Meldingen" onClick={() => navigate("/meldingen")} />
                {hasSessionToken() && <AccountKnop label="Apparaten" onClick={() => navigate("/apparaten")} />}
                {canSeeInstellingen && <AccountKnop label="Instellingen" onClick={() => navigate("/instellingen")} />}
                {hasSessionToken() && (
                  <>
                    <div className="mx-3 my-1 border-t border-white/10" />
                    <AccountKnop label="Uitloggen" onClick={handleLogout} />
                  </>
                )}
              </div>
            )}
          </div>
        </aside>

        {/* ── Desktop: kolom van 220 px met alle schermen van de module ────── */}
        {zichtbareSchermen.length > 0 && (
          <nav className="hidden md:flex w-[220px] shrink-0 flex-col gap-0.5 px-3 py-4 border-r border-ink-12 bg-paper-raised sticky top-0 h-[100dvh]">
            <p className="px-3 pb-2 font-mono text-xs uppercase tracking-[0.14em] text-ink-45">
              {activeModule?.navTitle}
            </p>
            {zichtbareSchermen.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 min-h-tap rounded-[10px] text-meta transition-colors ${
                    isActive ? "bg-ink-6 text-ink font-semibold" : "text-ink-70 hover:bg-ink-6"
                  }`
                }
              >
                <span>{item.label}</span>
                {item.to === "/berichten" && ongelezen > 0 && (
                  <span className="ml-auto min-w-[1.25rem] h-5 px-1.5 rounded-full bg-ink text-paper text-[0.6875rem] font-semibold inline-flex items-center justify-center">
                    {ongelezen > 99 ? "99+" : ongelezen}
                  </span>
                )}
                {item.to === "/tickets" && openTickets !== null && (
                  <span className="ml-auto meta tabular-nums">{openTickets}</span>
                )}
              </NavLink>
            ))}
          </nav>
        )}

        <div className="flex-1 flex flex-col min-w-0">
          {/* ── Mobiel: topbalk van 44 px — logo en schermtitel, geen navigatie ── */}
          <header
            className="md:hidden flex items-center gap-2 h-11 px-4 shrink-0 sticky top-0 z-40"
            style={{
              backgroundColor: merkAchtergrond,
              color: opMerk,
              paddingTop: beta?.beta_mode ? undefined : "env(safe-area-inset-top, 0px)",
              height: beta?.beta_mode ? undefined : "calc(2.75rem + env(safe-area-inset-top, 0px))",
            }}
          >
            {brandLogo ? (
              <img src={brandLogo} alt="" className="w-6 h-6 object-contain rounded shrink-0" />
            ) : (
              <span className="text-lg font-bold select-none shrink-0">S</span>
            )}
            <span className="font-bold text-body truncate">{schermTitel}</span>
          </header>

          {/* Inhoud — max 1100 px, rijen links uitgelijnd */}
          <main
            className={`flex-1 px-4 py-6 w-full max-w-[1100px] ${
              location.pathname === "/kennis" ? "" : "touch-keyboard-pb"
            } ${toonMelden ? "fab-clearance" : ""} pb-[calc(4rem+env(safe-area-inset-bottom,0px))] md:pb-6`}
          >
            {/* Modules die nog hun eigen schermen hebben houden op mobiel een
                eigen regel; de onderbalk hieronder is van de hoofdnavigatie. */}
            {activeModule && activeModuleId !== "taken" && zichtbareSchermen.length > 1 && (
              <div className="md:hidden flex gap-1 mb-4 overflow-x-auto scrollbar-none">
                {zichtbareSchermen.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) =>
                      `shrink-0 h-tap px-3.5 inline-flex items-center rounded-full text-meta transition-colors ${
                        isActive
                          ? "bg-ink text-paper font-semibold"
                          : "bg-paper-raised border border-ink-12 text-ink-70 font-medium"
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            )}

            <Routes>
              {/* Taken module */}
              <Route path="/" element={<MijnOverzicht />} />
              <Route path="/tickets" element={<TicketList />} />
              <Route path="/tickets/new" element={<NewTicket />} />
              <Route path="/tickets/:id" element={<TicketDetail />} />
              <Route path="/kamers" element={<Kamers />} />
              <Route
                path="/meer"
                element={
                  <Meer
                    gebruiker={currentUser}
                    modules={visibleModules.map((m) => m.id)}
                    magRapportage={magRapportage}
                    kanInstellingen={canSeeInstellingen}
                  />
                }
              />
              <Route path="/berichten" element={<Berichten />} />
              <Route path="/recurring/:id" element={<RecurringTaskDetail />} />
              <Route path="/recurring" element={<RecurringTasks />} />
              <Route path="/reports" element={<Reports />} />
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
                    <div className="meta">Laden…</div>
                  ) : currentUser.role === "admin" ? (
                    <KennisbankBeheer />
                  ) : (
                    <Navigate to="/kennis" replace />
                  )
                }
              />
              {/* Buiten de modules */}
              <Route path="/instellingen" element={<Instellingen />} />
              <Route path="/wachtwoord" element={<WachtwoordWijzigen />} />
              <Route path="/apparaten" element={<Apparaten />} />
              <Route path="/meldingen" element={<Meldingen />} />
            </Routes>
          </main>
        </div>

        {/* ── Mobiel: onderbalk van 56 px, vier items met vast label ───────── */}
        <nav
          className="md:hidden fixed bottom-0 left-0 right-0 z-40 flex border-t border-ink-12 bg-paper-raised"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          {ONDERBALK.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex-1 h-14 flex flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-medium transition-colors ${
                  isActive ? "text-ink" : "text-ink-45"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span className="relative leading-none" aria-hidden="true">
                    {item.icon && <item.icon size={20} strokeWidth={isActive ? 2.25 : 1.75} />}
                    {item.to === "/meer" && ongelezen > 0 && (
                      <span className="absolute -top-0.5 -right-1.5 w-2 h-2 rounded-full bg-urgent" />
                    )}
                  </span>
                  <span className={isActive ? "font-semibold" : ""}>{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Eén primaire actie: melden. Rechtsboven de onderbalk — binnen
            duimbereik, buiten het rijgebied. */}
        {toonMelden && (
          <button
            onClick={() => navigate("/tickets/new")}
            title="Melden"
            aria-label="Nieuw ticket melden"
            className="fixed right-4 z-40 flex items-center justify-center w-14 h-14 rounded-full shadow-lg active:scale-95 transition"
            style={{
              backgroundColor: merkAchtergrond,
              color: opMerk,
              bottom: "calc(4.5rem + var(--undo-lift, 0px) + env(safe-area-inset-bottom, 0px))",
            }}
          >
            <Plus size={26} strokeWidth={2} aria-hidden="true" />
          </button>
        )}
      </div>
    </>
  );
}

function AccountKnop({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 w-full px-4 py-2.5 text-sm text-white/70 hover:text-white hover:bg-paper-raised/10 transition-colors"
    >
      {label}
    </button>
  );
}

const SCHERMTITELS: Record<string, string> = {
  "/": "Vandaag",
  "/tickets": "Tickets",
  "/tickets/new": "Melden",
  "/kamers": "Kamers",
  "/meer": "Meer",
  "/berichten": "Berichten",
  "/recurring": "Herhalend",
  "/reports": "Rapportage",
  "/instellingen": "Instellingen",
  "/wachtwoord": "Wachtwoord",
  "/apparaten": "Apparaten",
  "/meldingen": "Meldingen",
};

function afgeleideTitel(pad: string, mod: ModuleConfig | null): string {
  if (pad.startsWith("/tickets/")) return "Ticket";
  if (pad.startsWith("/recurring/")) return "Herhaaltaak";
  return mod?.navTitle ?? "Tickets";
}
