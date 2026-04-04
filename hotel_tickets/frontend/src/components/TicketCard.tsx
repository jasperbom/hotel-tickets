import { Link } from "react-router-dom";
import { format } from "date-fns";
import { nl } from "date-fns/locale";
import { parseUTC, type Ticket } from "../api/client";
import { StatusBadge, PriorityBadge, CategoryBadge } from "./StatusBadge";

interface Props {
  ticket: Ticket;
  users?: Record<string, string>;     // ha_user_id -> display_name
  locations?: Record<string, string>; // id -> name
}

export default function TicketCard({ ticket, users = {}, locations = {} }: Props) {
  const locationName = ticket.location_id ? locations[ticket.location_id] : null;

  return (
    <Link to={`/tickets/${ticket.id}`} className="block">
      <div className="card hover:shadow-md transition-shadow cursor-pointer p-0 overflow-hidden">

        {/* Kamer-banner — altijd zichtbaar bovenaan */}
        {locationName ? (
          <div className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2">
            <span className="text-lg">🚪</span>
            <span className="font-bold text-base tracking-wide">{locationName}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 bg-gray-100 text-gray-400 px-4 py-2">
            <span className="text-lg">📍</span>
            <span className="text-sm italic">Geen locatie opgegeven</span>
          </div>
        )}

        {/* Ticket-inhoud */}
        <div className="px-4 py-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-gray-900 leading-snug">{ticket.title}</h3>
            <PriorityBadge priority={ticket.priority} />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <StatusBadge status={ticket.status} />
            <CategoryBadge category={ticket.category} />
          </div>

          <div className="flex items-center justify-between text-xs text-gray-500 pt-1">
            <span>
              {ticket.assigned_to
                ? `→ ${users[ticket.assigned_to] || ticket.assigned_to}`
                : "Niet toegewezen"}
            </span>
            <span>
              {format(parseUTC(ticket.created_at), "d MMM HH:mm", { locale: nl })}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
