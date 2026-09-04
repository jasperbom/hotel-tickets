/**
 * Het gedeelde leesmodel van een werkregel: eigendom, prioriteit, afdeling en
 * leeftijd. Vier dimensies, vier kanalen — en elke dimensie houdt overal
 * hetzelfde kanaal, zodat wie de rij op Vandaag leert lezen ook Tickets kan
 * lezen.
 *
 *   Kamer      → positie (altijd eerst)
 *   Titel      → grootte
 *   Prioriteit → kleur (de enige dimensie met kleur, en alleen bij uitzondering)
 *   Eigendom   → woord
 *   Afdeling   → gekleurd plaatje met de afkorting, alleen als het niet je
 *                eigen afdeling is
 *
 * "In behandeling" stond hier een tijd niet meer bij — van wie het werk is zei
 * meer dan of iemand het al aangeraakt had. Het staat er weer, als woord: een
 * collega die eraan begónnen is, is iets anders dan een collega aan wie het is
 * toegewezen.
 */
import type { Category, Priority, Ticket } from "./api/client";
import { parseUTC } from "./api/client";

/** Afdelingsafkorting voor de metaregel — kort genoeg om te negeren. */
export const AFDELING_KORT: Record<Category, string> = {
  technical: "TD",
  housekeeping: "HHD",
  reception: "REC",
  service: "BED",
  kitchen: "KEU",
  sales: "SLS",
  garden: "TUI",
};

export const AFDELING_LABELS: Record<Category, string> = {
  technical: "Technische dienst",
  housekeeping: "Huishouding",
  reception: "Receptie",
  service: "Bediening",
  kitchen: "Keuken",
  sales: "Sales",
  garden: "Tuin",
};

export type Eigendom = {
  label: string;
  /** af = klaar, afdeling = nog van niemand, mij = van mij, ander = collega */
  soort: "af" | "afdeling" | "mij" | "ander";
};

export function eigendom(
  ticket: Pick<Ticket, "status" | "assigned_to" | "category">,
  mij: string,
  naam?: (id: string) => string,
): Eigendom {
  if (ticket.status === "closed") return { label: "Klaar", soort: "af" };
  // Heeft niemand het opgepakt, dan is het van de afdeling. Hier stond eerst
  // "Vrij" en daarna "Niemand", en dat waren allebei antwoorden op de vraag
  // wie het níet heeft. De afdeling is het antwoord op wie het wél moet doen,
  // en dat is wat je van een werkregel wil weten.
  if (!ticket.assigned_to) return { label: AFDELING_KORT[ticket.category], soort: "afdeling" };
  if (ticket.assigned_to === mij) return { label: "Van mij", soort: "mij" };
  const wie = naam ? naam(ticket.assigned_to) : ticket.assigned_to;
  return { label: `Bij ${wie}`, soort: "ander" };
}

/**
 * "In behandeling" stond bewust niet meer in de interface: van wie het werk is
 * zei meer dan of iemand het al aangeraakt had. In de praktijk is het verschil
 * er wel degelijk — een collega die eraan begónnen is, is iets anders dan een
 * collega aan wie het is toegewezen. Het staat er daarom weer bij: als woord in
 * de metaregel, en op het ticket zelf als knop die je kunt omzetten.
 */
export function bezigTekst(status: Ticket["status"]): string | null {
  return status === "in_progress" ? "In behandeling" : null;
}

/**
 * Elk niveau krijgt een woord. Normaal en laag waren stilte — "stilte is óók
 * informatie" — maar wie een rij zonder woord zag, las "geen prioriteit
 * ingevuld" in plaats van "gewone prioriteit". Vier woorden, vier kleuren.
 */
export const PRIORITEIT_WOORD: Record<Priority, string> = {
  urgent: "Urgent",
  high: "Hoog",
  medium: "Normaal",
  low: "Laag",
};

export function prioriteitWoord(priority: Priority): string {
  return PRIORITEIT_WOORD[priority];
}

/** Tekstkleur van het prioriteitswoord: rood, oranje, geel, lichtgroen. */
export function prioriteitKleur(priority: Priority): string {
  return {
    urgent: "text-urgent",
    high: "text-high",
    medium: "text-normal",
    low: "text-low",
  }[priority];
}

/** De linkerrand van een werkrij, in dezelfde vier kleuren. */
export function prioriteitRand(priority: Priority): string {
  return {
    urgent: "row--urgent",
    high: "row--high",
    medium: "row--normal",
    low: "row--low",
  }[priority];
}

/** Volgorde waarin de niveaus overal staan: spoed eerst. */
export const PRIORITEIT_VOLGORDE: Priority[] = ["urgent", "high", "medium", "low"];

/**
 * Leeftijd in de metaregel.
 *
 * Stond eerst op dag drie: daarvóór was het ruis, want "17-07" zei niemand
 * iets. Maar hoe lang iets al ligt is nu juist wat je wil weten voordat je
 * kiest wat je oppakt, en dan is dag twee al laat. Vanaf dag één dus — en de
 * eerste dag blijft stil, want alles wat vandaag binnenkomt is even oud.
 */
export function leeftijdTekst(createdAt: string, vanafDagen = 1): string | null {
  const dagen = Math.floor((Date.now() - parseUTC(createdAt).getTime()) / 86_400_000);
  if (dagen < vanafDagen) return null;
  return dagen === 1 ? "1 dag open" : `${dagen} dagen open`;
}

/**
 * Leeftijd voor het wandscherm, ook binnen de eerste dag.
 *
 * Op een bord aan de muur is "20 min open" wél informatie: dat is het verschil
 * tussen een melding waar iemand mee bezig moet zijn en eentje die net binnen
 * is. In de app blijft de eerste dag stil — daar staat de lijst al op volgorde.
 */
export function leeftijdBoard(createdAt: string): string {
  const minuten = Math.floor((Date.now() - parseUTC(createdAt).getTime()) / 60_000);
  if (minuten < 60) return `${Math.max(0, minuten)} min open`;
  const uren = Math.floor(minuten / 60);
  if (uren < 24) return uren === 1 ? "1 uur open" : `${uren} uur open`;
  const dagen = Math.floor(uren / 24);
  return dagen === 1 ? "1 dag open" : `${dagen} dagen open`;
}

/** Binnen 24 uur binnengekomen — de "Nieuw"-lijst op het wandscherm. */
export function isNieuw(createdAt: string): boolean {
  return Date.now() - parseUTC(createdAt).getTime() < 86_400_000;
}

/** Afdeling alleen benoemen als het niet je eigen afdeling is. */
export function afdelingTekst(category: Category, eigenAfdeling: Category | null): string | null {
  if (eigenAfdeling && category === eigenAfdeling) return null;
  return AFDELING_KORT[category];
}

export function subtaakFractie(ticket: Pick<Ticket, "subtasks">): string | null {
  if (!ticket.subtasks || ticket.subtasks.length === 0) return null;
  const done = ticket.subtasks.filter((s) => s.done).length;
  return `${done}/${ticket.subtasks.length}`;
}

const DAG_KORT = ["zo", "ma", "di", "wo", "do", "vr", "za"];

/**
 * Kort herhaalpatroon voor in de metaregel: "elke wo". Een herhalende taak is
 * voor de medewerker gewoon werk; dat het uit een sjabloon komt hoort geen
 * eigen sectie, kleur of 🔁 te krijgen.
 */
export function herhaalKort(cron?: string, intervalDays?: number | null): string | null {
  if (intervalDays && intervalDays > 0) {
    return intervalDays === 1 ? "elke dag" : `elke ${intervalDays} dagen`;
  }
  if (!cron) return null;
  const delen = cron.trim().split(/\s+/);
  if (delen.length < 5) return null;
  const [, , dagVanMaand, maand, dagVanWeek] = delen;
  if (dagVanWeek !== "*") {
    const dagen = dagVanWeek
      .split(",")
      .map((d) => DAG_KORT[Number(d) % 7])
      .filter(Boolean);
    if (dagen.length) return `elke ${dagen.join("/")}`;
  }
  if (dagVanMaand !== "*") {
    const perMaanden = maand.startsWith("*/") ? Number(maand.slice(2)) : 1;
    if (perMaanden > 1) return `elke ${perMaanden} maanden`;
    return `elke ${dagVanMaand}e van de maand`;
  }
  return "elke dag";
}

/**
 * Onderhoudsinterval in woorden. "elke 30 dagen" is correct maar leest niet;
 * "maandelijks" wel. Alleen de ronde getallen krijgen een woord — 91 dagen
 * blijft "per kwartaal", 100 dagen blijft gewoon 100 dagen.
 */
export function intervalTekst(dagen: number): string {
  const vast: Record<number, string> = {
    1: "dagelijks",
    7: "wekelijks",
    14: "elke 2 weken",
    30: "maandelijks",
    91: "per kwartaal",
    182: "halfjaarlijks",
    365: "jaarlijks",
  };
  return vast[dagen] ?? `elke ${dagen} dagen`;
}

/**
 * De onderhoudsritmes van een object in één regel: "onderhoud maandelijks +
 * jaarlijks". Een object mag er meerdere hebben — visueel controleren gaat
 * vaker dan keuren.
 */
export function onderhoudTekst(
  schemas: { interval_days: number | null }[] | undefined,
): string | null {
  const ritmes = (schemas ?? [])
    .map((m) => m.interval_days)
    .filter((d): d is number => !!d && d > 0)
    .sort((a, b) => a - b)
    .map(intervalTekst);
  if (ritmes.length === 0) return null;
  return `onderhoud ${ritmes.join(" + ")}`;
}

/** De eerstvolgende controle over alle schema's heen. */
export function eersteControle(
  schemas: { next_check_at: string | null }[] | undefined,
): string | null {
  const data = (schemas ?? [])
    .map((m) => m.next_check_at)
    .filter((d): d is string => !!d)
    .sort();
  return data[0] ?? null;
}

/**
 * De kleur van het kamernummer: rood = bezet, groen = vrij, gewoon zwart =
 * geen keycard-sensor.
 *
 * Dit stond eerst als los label naast de kamer ("kamer vrij"), en daarvóór als
 * stip. Het probleem van een label is niet dat het onduidelijk is maar dat het
 * een tweede plek is: in één kaart stond de kamer op regel één en zijn
 * toestand ergens anders. De kamer is nu zijn eigen bericht.
 *
 * Let op bij het lezen van de rest van dit bestand: prioriteit was tot nu toe
 * de enige dimensie met kleur. Rood betekent op een werkregel ook "urgent" en
 * groen ook "klaar", dus een rood kamernummer op een spoedmelding is twee keer
 * rood met twee betekenissen. Daarom draagt de kleur nooit de hele boodschap:
 * er staat altijd een tekst voor schermlezers naast, en urgentie houdt zijn
 * eigen kanalen (de linkerrand en het woord).
 */
export function kamerKleur(bezet: boolean | null | undefined): string {
  if (bezet === true) return "text-urgent";
  if (bezet === false) return "text-done";
  return "";
}

/** Wat de kleur zegt, voor wie hem niet ziet. */
export function kamerToestand(bezet: boolean | null | undefined): string | null {
  if (bezet === true) return "kamer is bezet";
  if (bezet === false) return "kamer is vrij";
  return null;
}
