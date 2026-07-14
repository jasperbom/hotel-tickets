// --- Route-herstel na refresh (HA ingress iframe verliest de URL-hash) ---
//
// De HashRouter bewaart de route in een gewone browsertab, maar via HA ingress
// draait de app in een iframe: een refresh herlaadt dat iframe op de basis-URL
// zónder hash, waardoor de app op "/" opende (bv. terug naar tickets vanuit
// zwembadcontrole). Daarom bewaren we de route in sessionStorage — maar alléén
// kort geldig (TTL), zodat op gedeelde tablets een latere gebruiker niet op de
// pagina van de vorige gebruiker belandt (de reden waarom de eerdere
// localStorage-variant is verwijderd). Deep-links (eigen hash) worden
// gerespecteerd.

const LAST_ROUTE_KEY = "lastRoute";
// Kort genoeg dat een andere gebruiker op een gedeelde tablet niet op de
// pagina van de vorige gebruiker belandt; ruim genoeg voor een refresh.
const LAST_ROUTE_TTL_MS = 30_000;

export function saveLastRoute(path: string) {
  try {
    sessionStorage.setItem(
      LAST_ROUTE_KEY,
      JSON.stringify({ path, ts: Date.now() })
    );
  } catch {
    // Opslag niet beschikbaar (bv. private mode) — dan geen herstel
  }
}

/**
 * Herstel de bewaarde route door de URL-hash te zetten vóórdat React mount.
 *
 * Dit moet synchroon vóór de eerste render gebeuren: de eerdere
 * useEffect-variant liet na een ingress-herlaad eerst het ticketoverzicht
 * ("/") zien en sprong daarna pas naar de bewaarde pagina — dat oogde alsof
 * het venster twee keer achter elkaar refreshte. Door de hash vooraf te
 * zetten start de router direct op de juiste pagina, in één render.
 */
export function restoreLastRouteBeforeMount() {
  // Alleen herstellen op de lege basis-URL; een eigen hash is een deep-link.
  const hash = window.location.hash;
  if (hash && hash !== "#" && hash !== "#/") return;
  try {
    const raw = sessionStorage.getItem(LAST_ROUTE_KEY);
    if (!raw) return;
    const { path, ts } = JSON.parse(raw);
    if (
      typeof path === "string" &&
      path.startsWith("/") &&
      path !== "/" &&
      typeof ts === "number" &&
      Date.now() - ts < LAST_ROUTE_TTL_MS
    ) {
      // replace() i.p.v. hash-toewijzing: geen extra history-entry en geen
      // herlaad — de HashRouter leest de nieuwe hash bij initialisatie.
      window.location.replace(
        window.location.pathname + window.location.search + "#" + path
      );
    }
  } catch {
    // Ongeldige opslag negeren
  }
}
