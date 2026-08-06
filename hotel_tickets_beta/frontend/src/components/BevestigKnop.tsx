import { useState } from "react";

/**
 * Knop met de bevestiging in het scherm zelf, in plaats van een
 * browser-`confirm()`.
 *
 * Een dialoogvenster vóór de handeling leert mensen reflexmatig op OK te
 * drukken — dan beschermt het niets meer en kost het wel een tik. Deze knop
 * verandert bij de eerste tik in een vraag met twee antwoorden, op dezelfde
 * plek, zodat je ziet waar je "ja" tegen zegt.
 */
export function BevestigKnop({
  label,
  vraag,
  bevestigLabel = "Ja",
  onBevestig,
  className = "",
  disabled,
}: {
  label: React.ReactNode;
  vraag: string;
  bevestigLabel?: string;
  onBevestig: () => void;
  className?: string;
  disabled?: boolean;
}) {
  const [vragen, setVragen] = useState(false);

  if (!vragen) {
    return (
      <button type="button" onClick={() => setVragen(true)} disabled={disabled} className={className}>
        {label}
      </button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <span className="text-meta text-ink-70">{vraag}</span>
      <button
        type="button"
        onClick={() => { setVragen(false); onBevestig(); }}
        className="h-tap px-3 rounded-[10px] bg-urgent text-paper text-meta font-semibold"
      >
        {bevestigLabel}
      </button>
      <button
        type="button"
        onClick={() => setVragen(false)}
        className="h-tap px-3 rounded-[10px] border border-ink-12 text-ink-70 text-meta font-semibold"
      >
        Annuleren
      </button>
    </span>
  );
}

export default BevestigKnop;
