import { Link } from "react-router-dom";
import { format } from "date-fns";
import { nl } from "date-fns/locale";
import type { Ticket } from "../api/client";
import { StatusBadge, PriorityBadge, CategoryBadge } from "./StatusBadge";

interface Props {
  ticket: Ticket;
  users?: Record<string, string>; // ha_user_id -> display_name
  locations?: Record<string, string>; // id -> name
}

export default function TicketCard({ ticket, users = {}, locations = {} }: Props) {
  return (
    <Link to={`/tickets/${ticket.id}`} className="block">
      <div className="card hover:shadow-md transition-shadow cursor-pointer">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-gray-900 leading-snug">{ticket.title}</h3>
          <div className="flex gap-1 shrink-0">
            <PriorityBadge priority={ticket.priority} />
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-2">
          <StatusBadge status={ticket.status} />
          <CategoryBadge category={ticket.category} />
          {ticket.location_id && locations[ticket.location_id] && (
            <span className="badge bg-gray-100 text-gray-600">
              {locations[ticket.location_id]}
            </span>
          )}
        </div>

        <div className="flex items-center justify-between mt-3 text-xs text-gray-500">
          <span>
            {ticket.assigned_to
              ? `Toegewezen aan ${users[ticket.assigned_to] || ticket.assigned_to}`
              : "Niet toegewezen"}
          </span>
          <span>
            {format(new Date(ticket.created_at), "d MMM yyyy HH:mm", { locale: nl })}
          </span>
        </div>
      </div>
    </Link>
  );
}
