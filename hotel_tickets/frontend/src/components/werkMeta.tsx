import type { ReactNode } from "react";
import type { Category, Ticket } from "../api/client";
import { AfdelingChip } from "./AfdelingChip";
import KamerStatus from "./KamerStatus";
import {
  afdelingTekst, eigendom, leeftijdTekst, prioriteitWoord, subtaakFractie,
} from "../werk";

/**
 * De metaregel onder een werkregel — op één plek, voor elk scherm.
 *
 * Deze regel stond drie keer bijna hetzelfde in de code (Vandaag, Tickets, en
 * de rij "te pakken"), en "bijna" is hier het probleem: de volgorde verschilde,
 * en daarmee las dezelfde ticket op twee schermen anders. Wie leert dat het
 * derde woord de eigenaar is, moet dat overal kunnen blijven lezen.
 *
 * De volgorde is de volgorde van de vragen die iemand stelt:
 *
 *   1. Moet dit nú?          urgentie, in kleur
 *   2. Is iemand ermee bezig? status
 *   3. Van wie is het?        eigenaar, met nadruk als er een naam staat
 *   4. Van welke afdeling?    alleen als het niet de jouwe is
 *   5. Hoe ver is het?        subtaken
 *   6. Kan ik erin?           kamer vrij of bezet
 *   7. Hoe lang ligt het al?  leeftijd
 *
 * Punt 6 stond hier als de losse woorden "kamer is vrij" plus een stip naast
 * het kamernummer. De stip is weg — die moest je leren in plaats van lezen —
 * en de woorden staan er nu als label, hetzelfde label als op het ticket, het
 * kamerscherm en het wandscherm. Op een telefoon past het niet naast het
 * kamernummer: daar duwt het de titel van de regel af.
 *
 * Alleen 1, 2 en 3 krijgen nadruk. De rest is grijs — anders schreeuwt de hele
 * regel en valt er niets meer op.
 */
export function werkMeta(
  ticket: Ticket,
  opties: {
    /** Het eigen HA-user-id, om "van mij" van "bij een collega" te scheiden. */
    mij: string;
    naamVan: (id: string) => string;
    /** Eigen afdeling; die wordt niet benoemd. */
    eigenAfdeling: Category | null;
    /** Bezetting van de kamer, indien bekend. */
    keycard?: boolean | null;
    /**
     * Op Vandaag staat alles wat van jou is al onder het kopje "nu" — daar is
     * "Van mij" een woord dat niets toevoegt. In de ticketlijst staat werk van
     * iedereen door elkaar en is het juist het antwoord op de eerste vraag.
     */
    verbergEigenNaam?: boolean;
  },
): ReactNode[] {
  const { mij, naamVan, eigenAfdeling, keycard, verbergEigenNaam = false } = opties;

  const prio = prioriteitWoord(ticket.priority);
  const bezit = eigendom(ticket, mij, naamVan);
  const eigenaarZichtbaar = !(verbergEigenNaam && bezit.soort === "mij");

  return [
    prio && (
      <strong className={`font-semibold ${ticket.priority === "urgent" ? "text-urgent" : "text-high"}`}>
        {prio}
      </strong>
    ),
    ticket.status === "in_progress" && (
      <strong className="font-semibold text-brand">In behandeling</strong>
    ),
    eigenaarZichtbaar && (
      // "Vrij" is de afwezigheid van een eigenaar en blijft daarom grijs; een
      // naam is een antwoord en krijgt gewicht.
      bezit.soort === "vrij"
        ? bezit.label
        : <strong className="font-semibold text-ink">{bezit.label}</strong>
    ),
    afdelingTekst(ticket.category, eigenAfdeling) && <AfdelingChip category={ticket.category} />,
    subtaakFractie(ticket),
    keycard != null && <KamerStatus bezet={keycard} />,
    leeftijdTekst(ticket.created_at),
  ].filter(Boolean);
}
