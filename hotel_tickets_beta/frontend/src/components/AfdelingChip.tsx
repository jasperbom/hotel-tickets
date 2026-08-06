import type { Category } from "../api/client";
import { AFDELING_KORT, AFDELING_LABELS } from "../werk";

/**
 * De afdeling als klein gekleurd plaatje in de metaregel.
 *
 * Kleur staat in dit ontwerp voor prioriteit — daar mag niets aan tornen. Dit
 * is de ene uitzondering, en hij houdt zich aan twee regels: de kleur zit
 * alleen in het plaatje (nooit in de rand van de rij, nooit in de titel), en
 * het woord staat er nog steeds bij. Wie kleurenblind is leest gewoon "HHD".
 *
 * De volledige naam zit in het title-attribuut, want "BED" raadt niemand.
 */
const KLEUR: Record<Category, string> = {
  technical: "bg-afd-technical-soft text-afd-technical",
  housekeeping: "bg-afd-housekeeping-soft text-afd-housekeeping",
  reception: "bg-afd-reception-soft text-afd-reception",
  service: "bg-afd-service-soft text-afd-service",
  kitchen: "bg-afd-kitchen-soft text-afd-kitchen",
  sales: "bg-afd-sales-soft text-afd-sales",
  garden: "bg-afd-garden-soft text-afd-garden",
};

export function AfdelingChip({ category }: { category: Category }) {
  return (
    <span
      title={AFDELING_LABELS[category]}
      className={`inline-flex items-center rounded px-1.5 py-px text-[0.8125rem] font-semibold ${KLEUR[category]}`}
    >
      {AFDELING_KORT[category]}
    </span>
  );
}

export default AfdelingChip;
