/**
 * Afvinken zonder tussenstap, met een venster om terug te komen.
 *
 * Een `confirm()` vóór de handeling leert mensen reflexmatig te bevestigen —
 * dan beschermt hij niets meer en kost hij wel een tik. Daarom: de rij wordt
 * meteen als klaar getoond, de API-aanroep vertrekt pas na vijf seconden, en
 * zolang die staan blijft kun je hem intrekken. Verlaat je de pagina eerder,
 * dan vertrekt de aanroep alsnog (flush) — nooit stil verloren werk.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface UitgesteldeActie {
  /** Waarop de actie slaat — bijv. een ticket-id; om de rij als klaar te tonen. */
  id: string;
  /** Tekst in de balk, bijv. "214 afgerond". */
  label: string;
}

type Intern = UitgesteldeActie & {
  uitvoeren: () => Promise<unknown>;
  timer: number;
};

export function useUitgesteldeActie(vertragingMs = 5000, naAfloop?: () => void) {
  const [actie, setActie] = useState<UitgesteldeActie | null>(null);
  const lopend = useRef<Intern | null>(null);
  const naAfloopRef = useRef(naAfloop);
  naAfloopRef.current = naAfloop;

  const voerUit = useCallback((item: Intern) => {
    window.clearTimeout(item.timer);
    if (lopend.current === item) lopend.current = null;
    setActie((huidig) => (huidig?.id === item.id ? null : huidig));
    item
      .uitvoeren()
      .catch(() => {})
      .finally(() => naAfloopRef.current?.());
  }, []);

  /** Nog openstaande actie meteen laten vertrekken (paginawissel, tabblad weg). */
  const flush = useCallback(() => {
    if (lopend.current) voerUit(lopend.current);
  }, [voerUit]);

  const plan = useCallback(
    (id: string, label: string, uitvoeren: () => Promise<unknown>) => {
      // Twee keer achter elkaar afvinken: de eerste vertrekt direct.
      flush();
      const timer = window.setTimeout(() => {
        if (lopend.current) voerUit(lopend.current);
      }, vertragingMs);
      lopend.current = { id, label, uitvoeren, timer };
      setActie({ id, label });
    },
    [flush, vertragingMs, voerUit],
  );

  const ongedaan = useCallback(() => {
    if (!lopend.current) return;
    window.clearTimeout(lopend.current.timer);
    lopend.current = null;
    setActie(null);
    naAfloopRef.current?.();
  }, []);

  useEffect(() => {
    const bijVerlaten = () => flush();
    window.addEventListener("pagehide", bijVerlaten);
    return () => {
      window.removeEventListener("pagehide", bijVerlaten);
      flush();
    };
  }, [flush]);

  return { actie, plan, ongedaan };
}
