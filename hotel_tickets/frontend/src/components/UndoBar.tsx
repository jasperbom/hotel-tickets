import { useEffect } from "react";

/**
 * Donkere balk onderin: "214 afgerond — Ongedaan maken". Staat er vijf
 * seconden; zolang hij staat schuiven de zwevende knoppen omhoog (--undo-lift),
 * anders dekt de meldknop precies de knop af die je nodig hebt.
 */
export function UndoBar({ tekst, onOngedaan }: { tekst: string; onOngedaan: () => void }) {
  useEffect(() => {
    document.body.classList.add("undo-open");
    return () => document.body.classList.remove("undo-open");
  }, []);

  return (
    <div
      role="status"
      className="fixed left-3 right-3 z-50 flex items-center gap-3 rounded-xl bg-ink pl-4 pr-3 py-3.5 shadow-lg md:left-auto md:right-6 md:w-96"
      style={{ bottom: "calc(0.875rem + env(safe-area-inset-bottom, 0px))" }}
    >
      <span className="flex-1 text-paper text-[0.9375rem] font-medium">{tekst}</span>
      <button
        onClick={onOngedaan}
        className="tap shrink-0 px-3.5 rounded-[9px] border border-paper/50 text-paper text-meta font-semibold hover:bg-paper/10 transition-colors"
      >
        Ongedaan maken
      </button>
    </div>
  );
}

export default UndoBar;
