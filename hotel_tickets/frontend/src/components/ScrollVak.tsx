import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Een lijst in een vast vak dat zelf scrolt.
 *
 * Op Vandaag staan "Nu" en "Te pakken" allebei altijd in beeld, elk in een
 * eigen vak; de rijen scrollen eronder. Zolang er meer onder zit vervaagt de
 * onderrand (klasse `scroll-fade` in index.css), zodat een half zichtbare rij
 * zegt "hier zit meer" zonder knop of tekst. Onderaan aangekomen gaat de
 * vervaging weg — anders bleef de laatste rij eeuwig half doorzichtig.
 */
export function ScrollVak({
  children, className = "",
}: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [onderaan, setOnderaan] = useState(true);

  const meet = () => {
    const el = ref.current;
    if (!el) return;
    setOnderaan(el.scrollTop + el.clientHeight >= el.scrollHeight - 2);
  };

  // Bij elke render opnieuw meten: de inhoud kan langer of korter geworden
  // zijn (ticket afgerond, lijst ververst) zonder dat er gescrold is.
  useLayoutEffect(meet);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener("scroll", meet, { passive: true });
    const ro = new ResizeObserver(meet);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", meet);
      ro.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`min-h-0 overflow-y-auto overscroll-contain scroll-fade ${onderaan ? "is-onderaan" : ""} ${className}`}
    >
      {children}
    </div>
  );
}
