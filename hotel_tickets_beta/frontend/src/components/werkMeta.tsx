import type { ReactNode } from "react";
import type { Category, Ticket } from "../api/client";
import { AfdelingChip } from "./AfdelingChip";
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
 *   3. Van wie is het?        een naam, of de afdeling als niemand het heeft
 *   4. Van welke afdeling?    alleen als 3 een naam is en het niet jouw afdeling is
 *   5. Hoe ver is het?        subtaken
 *   6. Hoe lang ligt het al?  leeftijd
 *
 * "Kan ik erin?" stond hier ook, eerst als de woorden "kamer is vrij" en
 * daarna als label. Het staat nu in de kleur van het kamernummer zelf (rood =
 * bezet, groen = vrij): één plek per kaart, en de metaregel gaat weer alleen
 * over het werk.
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
    /**
     * Op Vandaag staat alles wat van jou is al onder het kopje "nu" — daar is
     * "Van mij" een woord dat niets toevoegt. In de ticketlijst staat werk van
     * iedereen door elkaar en is het juist het antwoord op de eerste vraag.
     */
    verbergEigenNaam?: boolean;
  },
): ReactNode[] {
  const { mij, naamVan, eigenAfdeling, verbergEigenNaam = false } = opties;

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
      // Een naam is een antwoord en krijgt gewicht. Heeft niemand het, dan
      // staat hier de afdeling — als plaatje, want zo staat de afdeling overal
      // in de app.
      bezit.soort === "afdeling"
        ? <AfdelingChip category={ticket.category} />
        : <strong className="font-semibold text-ink">{bezit.label}</strong>
    ),
    // Alleen nog als losse vermelding wanneer het vakje hierboven een naam
    // toont: anders zou dezelfde afdeling twee keer op één regel staan.
    bezit.soort !== "afdeling" &&
      afdelingTekst(ticket.category, eigenAfdeling) && <AfdelingChip category={ticket.category} />,
    subtaakFractie(ticket),
    leeftijdTekst(ticket.created_at),
  ].filter(Boolean);
}
