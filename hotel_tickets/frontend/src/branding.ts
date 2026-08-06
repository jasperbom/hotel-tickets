/**
 * Huisstijl-helpers + lokale cache.
 *
 * De huisstijl (kleuren, logo, achtergrond) komt uit de API en was daardoor
 * pas ná het eerste antwoord zichtbaar — elke keer dat de app laadde zag je
 * eerst kort de standaard blauwe kleuren en grijze achtergrond. Daarom wordt
 * de laatst opgehaalde huisstijl in localStorage bewaard en vóór de eerste
 * render toegepast (zie main.tsx); het API-antwoord ververst daarna de cache
 * en corrigeert eventuele wijzigingen.
 */

import type { BrandingSettings, LoginBranding } from "./api/client";

// --- Kleurpalet ---

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

const PALETTE_STEPS = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"];

/** Zet de --blue-* variabelen op basis van de knopkleur; null herstelt de
 *  standaard (uit index.css), zodat een verwijderde instelling niet uit de
 *  cache blijft hangen. */
export function applyButtonPalette(hex: string | null) {
  const root = document.documentElement;
  if (!hex) {
    for (const step of PALETTE_STEPS) root.style.removeProperty(`--blue-${step}`);
    root.style.removeProperty("--brand");
    return;
  }
  // Tokenlaag: `brand` is de enige kleur die interactie mag dragen.
  root.style.setProperty("--brand", hex);
  const [h, s] = hexToHsl(hex);
  const sat = Math.min(s * 1.1, 95);
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

/** Zet de app-achtergrond (--app-bg / --app-bg-image); nulls herstellen de
 *  standaard. Afbeelding gaat vóór kleur, net als in de backend-logica. */
export function applyAppBackground(bgImage: string | null, bgColor: string | null) {
  const root = document.documentElement;
  if (bgImage) {
    root.style.setProperty("--app-bg-image", `url("${bgImage}")`);
    root.style.removeProperty("--app-bg");
  } else {
    root.style.removeProperty("--app-bg-image");
    if (bgColor) root.style.setProperty("--app-bg", bgColor);
    else root.style.removeProperty("--app-bg");
  }
}

// --- Cache ---

const APP_KEY = "hts.branding";
const LOGIN_KEY = "hts.login_branding";

// Parse-resultaat onthouden: de cache kan een base64-achtergrond van enkele
// MB's bevatten en wordt bij het opstarten op meerdere plekken gelezen.
const parsed = new Map<string, unknown>();

function read<T>(key: string): T | null {
  if (parsed.has(key)) return parsed.get(key) as T | null;
  let value: T | null = null;
  try {
    const raw = localStorage.getItem(key);
    value = raw ? (JSON.parse(raw) as T) : null;
  } catch {
    value = null;
  }
  parsed.set(key, value);
  return value;
}

function write(key: string, value: unknown) {
  parsed.set(key, value);
  try {
    const raw = JSON.stringify(value);
    // Achtergrondafbeeldingen zijn base64 data-URL's (tot ~2,7 MB); alleen
    // schrijven bij een echte wijziging scheelt werk op de main thread.
    if (localStorage.getItem(key) !== raw) localStorage.setItem(key, raw);
  } catch {
    // Quota vol of private mode — dan geen cache, de API-respons stylet alsnog.
  }
}

export const readCachedAppBranding = () => read<BrandingSettings>(APP_KEY);
export const saveCachedAppBranding = (b: BrandingSettings) => write(APP_KEY, b);
export const readCachedLoginBranding = () => read<LoginBranding>(LOGIN_KEY);
export const saveCachedLoginBranding = (b: LoginBranding) => write(LOGIN_KEY, b);

/** Vóór de eerste render aanroepen: past de gecachte huisstijl direct toe,
 *  zodat er geen flits van de standaardkleuren is terwijl de API laadt. */
export function applyCachedBrandingBeforeMount() {
  const onLogin = window.location.hash.startsWith("#/login");
  const b = onLogin ? readCachedLoginBranding() : readCachedAppBranding();
  if (!b) return;
  applyButtonPalette(b.btn_color);
  applyAppBackground(b.bg_image, b.bg_color);
}
