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

/**
 * Pint de app-shell op de schermhoogte zolang deze pagina open is, zodat de
 * pagina zelf niet scrolt en zijn vakken de ruimte verdelen. Dezelfde
 * body-klasse als de kennisbot gebruikt (zie index.css, `kb-fit`), maar
 * zónder de meting via de visualViewport: die dient daar om het toetsenbord
 * op te vangen, en in de iOS-app viel ze kleiner uit dan het scherm, waardoor
 * de onderbalk een stuk boven de onderrand hing. Vandaag heeft geen
 * invoerveld, dus 100dvh is hier gewoon het scherm.
 */
export function useVasteHoogte() {
  useEffect(() => {
    document.body.classList.add("kb-fit");
    window.scrollTo(0, 0);
    return () => {
      document.body.classList.remove("kb-fit");
    };
  }, []);
}
