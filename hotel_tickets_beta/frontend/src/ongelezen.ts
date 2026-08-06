/**
 * Ongelezen berichten (directe berichten + @-mentions en commentaar op eigen
 * tickets). Eén plek, zodat het envelopje, de stip op Meer en de regel in Meer
 * hetzelfde getal tonen zonder er drie keer om te vragen.
 */
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { messageApi, notificationApi } from "./api/client";

export function useOngelezen(): number {
  const [aantal, setAantal] = useState(0);
  const location = useLocation();

  useEffect(() => {
    let actief = true;
    const ververs = () =>
      Promise.all([
        notificationApi.unreadCount().catch(() => ({ data: { count: 0 } })),
        messageApi.unreadCount().catch(() => ({ data: { count: 0 } })),
      ]).then(([n, m]) => {
        if (actief) setAantal(n.data.count + m.data.count);
      });
    ververs();
    const timer = window.setInterval(ververs, 60_000);
    return () => {
      actief = false;
      window.clearInterval(timer);
    };
  }, [location.pathname]);

  return aantal;
}
