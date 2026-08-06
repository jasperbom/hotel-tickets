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
 *   Afdeling   → grijze tekst, alleen als het niet je eigen afdeling is
 *
 * `in_progress` bestaat in de database maar niet meer in de interface: of iets
 * "in behandeling" is zegt alleen wie de toewijzing deed. Wat een medewerker
 * wil weten is van wie het werk is.
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

/** "kamer is vrij" is werkbare informatie; "Bezet" als losse pil niet. */
export function kamerTekst(occupied: boolean | null | undefined): string | null {
  if (occupied === false) return "kamer is vrij";
  return null;
}
