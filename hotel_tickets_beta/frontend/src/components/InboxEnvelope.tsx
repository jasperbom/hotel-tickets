import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { notificationApi, messageApi } from "../api/client";

/**
 * Envelopje in de navigatiebalk: toont het aantal ongelezen berichten
 * (directe berichten + @-mentions en commentaar op eigen tickets) en opent
 * de berichtenpagina. De teller ververst bij elke paginawissel en elke 60 sec.
 */
export function InboxEnvelope() {
  const [count, setCount] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let active = true;
    const refresh = () =>
      Promise.all([
        notificationApi.unreadCount().catch(() => ({ data: { count: 0 } })),
        messageApi.unreadCount().catch(() => ({ data: { count: 0 } })),
      ])
        .then(([n, m]) => { if (active) setCount(n.data.count + m.data.count); })
        .catch(() => {});
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [location.pathname]);

  return (
    <button
      onClick={() => navigate("/berichten")}
      title="Berichten"
      aria-label={count > 0 ? `Berichten (${count} ongelezen)` : "Berichten"}
      className={`relative flex items-center justify-center w-9 h-9 rounded-lg transition-colors shrink-0 ${
        location.pathname === "/berichten" ? "bg-white/20" : "hover:bg-white/10"
      }`}
    >
      <span className="text-lg">✉️</span>
      {count > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center leading-none shadow">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}
