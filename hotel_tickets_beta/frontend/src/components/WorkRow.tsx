import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import type { Priority } from "../api/client";

/**
 * Eén rij voor al het werk — op Vandaag, in Tickets, en straks in de modules
 * die hun rijen overnemen. Anatomie:
 *
 *   [rand 4px als urgent/hoog] [kamer 17px vet + bezet-stip] [titel 17px]
 *                              [metaregel 14px grijs]              [actie]
 *
 * Maximaal vier elementen, vijf met actie. Het vijfde verdringt het vierde —
 * dat is de regel die je in code review handhaaft.
 */

export type WorkRowActie =
  | { soort: "afronden"; onAfronden: () => void; label?: string }
  | { soort: "pakken"; onPakken: () => void }
  | { soort: "geen" };

export type ExtraKamer = { id: string; name: string; occupied?: boolean | null };

export interface WorkRowProps {
  to?: string;
  /** Alternatief voor `to`: op desktop opent een rij het ticket ernaast in
   *  plaats van een nieuwe pagina. De rij wordt dan een knop. */
  onOpen?: (e: React.MouseEvent) => void;
  geselecteerd?: boolean;
  /** Bepaalt uitsluitend de linkerrand: rood = urgent, amber = hoog, verder niets. */
  priority: Priority;
  kamer?: string | null;
  /** true = bezet (gevulde stip), false = vrij (open stip), null/undefined = geen sensor */
  occupied?: boolean | null;
  title: string;
  /** Onderdelen van de metaregel; worden met " · " aan elkaar gezet. */
  meta?: ReactNode[];
  /** Klaar: doorgehaalde titel op done-soft. */
  done?: boolean;
  actie?: WorkRowActie;
  extraKamers?: ExtraKamer[];
}

function BezetStip({ occupied }: { occupied?: boolean | null }) {
  if (occupied === null || occupied === undefined) return null;
  return (
    <span
      aria-label={occupied ? "kamer is bezet" : "kamer is vrij"}
      title={occupied ? "Kamer is bezet" : "Kamer is vrij"}
      className={`w-2 h-2 rounded-full shrink-0 -translate-y-0.5 ${
        occupied ? "bg-ink" : "border-[1.5px] border-ink"
      }`}
    />
  );
}

/** Knop in een rij die zelf een link is: klik nooit laten doorlekken. */
function rijActie(fn: () => void) {
  return (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fn();
  };
}

export function WorkRow({
  to,
  onOpen,
  geselecteerd = false,
  priority,
  kamer,
  occupied,
  title,
  meta,
  done = false,
  actie = { soort: "geen" },
  extraKamers,
}: WorkRowProps) {
  const randKlasse =
    priority === "urgent" ? "row--urgent" : priority === "high" ? "row--high" : "";

  const metaDelen = (meta ?? []).filter(Boolean);

  const inhoud = (
    <>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          {kamer && (
            <span className="text-row font-bold text-ink shrink-0 max-w-[45%] truncate">
              {kamer}
            </span>
          )}
          <BezetStip occupied={occupied} />
          <span
            className={`text-row text-ink line-clamp-2 ${done ? "line-through text-ink-45" : ""}`}
          >
            {title}
          </span>
        </div>
        {metaDelen.length > 0 && (
          <p className="meta mt-[3px]">
            {metaDelen.map((deel, i) => (
              <span key={i}>
                {i > 0 && <span className="text-ink-25"> · </span>}
                {deel}
              </span>
            ))}
          </p>
        )}
        {/* Herhaaltaak over meerdere kamers: de rest onder de hoofdregel */}
        {extraKamers && extraKamers.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
            {extraKamers.map((k) => (
              <span key={k.id} className="flex items-baseline gap-1.5">
                <span className="text-meta font-bold text-ink-70">{k.name}</span>
                <BezetStip occupied={k.occupied} />
              </span>
            ))}
          </div>
        )}
      </div>

      {actie.soort === "afronden" && (
        <button
          onClick={rijActie(actie.onAfronden)}
          title={actie.label ?? "Afronden"}
          aria-label={actie.label ?? "Afronden"}
          className="shrink-0 w-tapLg h-tapLg inline-flex items-center justify-center rounded-[10px]
                     border border-ink-12 text-ink hover:bg-ink-6 active:bg-ink-12 transition-colors"
        >
          <Check size={22} strokeWidth={2} aria-hidden="true" />
        </button>
      )}
      {actie.soort === "pakken" && (
        <button
          onClick={rijActie(actie.onPakken)}
          className="shrink-0 h-tap px-3.5 inline-flex items-center rounded-[10px] border border-ink
                     text-ink text-meta font-semibold hover:bg-ink-6 active:bg-ink-12 transition-colors"
        >
          Pakken
        </button>
      )}
    </>
  );

  const klasse =
    `row ${randKlasse} min-h-[66px] ${done ? "bg-done-soft" : ""} ` +
    (geselecteerd ? "ring-2 ring-ink ring-offset-0 " : "");

  if (to) {
    return (
      <Link to={to} className={`${klasse} transition-colors hover:bg-ink-6`}>
        {inhoud}
      </Link>
    );
  }
  if (onOpen) {
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => onOpen(e as unknown as React.MouseEvent)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(e as unknown as React.MouseEvent); } }}
        className={`${klasse} cursor-pointer text-left transition-colors hover:bg-ink-6`}
      >
        {inhoud}
      </div>
    );
  }
  return <div className={klasse}>{inhoud}</div>;
}

export default WorkRow;
