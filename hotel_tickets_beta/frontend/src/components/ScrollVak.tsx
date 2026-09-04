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
 * Pint de app-shell op de zichtbare hoogte zolang deze pagina open is, zodat
 * de pagina zelf niet scrolt en zijn vakken de ruimte verdelen. Dezelfde
 * body-klasse als de kennisbot gebruikt (zie index.css, `kb-fit`); op een
 * telefoon volgt de hoogte de visualViewport, zodat het toetsenbord de
 * indeling niet omhoog duwt.
 */
export function useVasteHoogte() {
  useEffect(() => {
    const root = document.documentElement;
    document.body.classList.add("kb-fit");
    const isTouch = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
    const vv = isTouch ? window.visualViewport : null;
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const h = vv ? vv.height : window.innerHeight;
        root.style.setProperty("--app-vh", `${Math.round(h)}px`);
        window.scrollTo(0, 0);
      });
    };
    if (isTouch) {
      update();
      vv?.addEventListener("resize", update);
      vv?.addEventListener("scroll", update);
    }
    return () => {
      document.body.classList.remove("kb-fit");
      root.style.removeProperty("--app-vh");
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      cancelAnimationFrame(raf);
    };
  }, []);
}
