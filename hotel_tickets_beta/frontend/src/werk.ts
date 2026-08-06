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
  /** af = klaar, vrij = niemand, mij = van mij, ander = bij een collega */
  soort: "af" | "vrij" | "mij" | "ander";
};

export function eigendom(
  ticket: Pick<Ticket, "status" | "assigned_to">,
  mij: string,
  naam?: (id: string) => string,
): Eigendom {
  if (ticket.status === "closed") return { label: "Klaar", soort: "af" };
  if (!ticket.assigned_to) return { label: "Vrij", soort: "vrij" };
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

/** Alleen urgent en hoog krijgen een woord; normaal en laag zijn stilte. */
export function prioriteitWoord(priority: Priority): string | null {
  if (priority === "urgent") return "Urgent";
  if (priority === "high") return "Hoog";
  return null;
}

/**
 * Leeftijd, maar pas vanaf dag drie — daarvóór is het ruis. "17-07" zei
 * niemand iets; "3 dagen open" wel.
 */
export function leeftijdTekst(createdAt: string, vanafDagen = 3): string | null {
  const dagen = Math.floor((Date.now() - parseUTC(createdAt).getTime()) / 86_400_000);
  if (dagen < vanafDagen) return null;
  return `${dagen} dagen open`;
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

/** "kamer is vrij" is werkbare informatie; "Bezet" als losse pil niet. */
export function kamerTekst(occupied: boolean | null | undefined): string | null {
  if (occupied === false) return "kamer is vrij";
  return null;
}
