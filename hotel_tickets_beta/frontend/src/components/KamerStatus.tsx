/**
 * Staat de kamer leeg? Eén manier van zeggen, op elk scherm.
 *
 * Dit stond in vijf varianten in de app: een kale stip op Vandaag, een stip
 * plus woord op het ticket, 🔑/🔓 met oranje en groen op een herhaaltaak, een
 * stip op het kamerscherm en een stip op het wandscherm. Wie een stip ziet
 * moet zich herinneren welke kant gevuld ook alweer was; wie een woord ziet
 * leest het. Vandaar overal hetzelfde label.
 *
 * Er staat "kamer vrij" en niet "vrij", omdat op een werkregel het woord
 * "Vrij" al bezet is: dat betekent daar dat niemand het ticket heeft
 * opgepakt. Twee betekenissen voor één woord op één regel is precies de
 * verwarring die hier weggaat. In een lijst die alleen uit kamers bestaat kan
 * het korter — daar kan "vrij" nergens anders over gaan.
 *
 * Geen sensor betekent geen label. "Ik weet het niet" is iets anders dan
 * "bezet", en op dat verschil loopt iemand de trap op.
 */
export default function KamerStatus({
  bezet,
  kort = false,
}: {
  /** true = bezet, false = vrij, null/undefined = geen (bruikbare) sensor. */
  bezet?: boolean | null;
  /** Binnen een lijst van kamers: "vrij" in plaats van "kamer vrij". */
  kort?: boolean;
}) {
  if (bezet === null || bezet === undefined) return null;
  // Vrij is het bericht waar iemand op wacht en krijgt daarom het contrast;
  // bezet is de achtergrondstand en blijft stil.
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-0.5 text-meta font-semibold ${
        bezet ? "bg-ink-6 text-ink-45" : "bg-ink-12 text-ink"
      }`}
    >
      {bezet ? (kort ? "bezet" : "kamer bezet") : kort ? "vrij" : "kamer vrij"}
    </span>
  );
}
