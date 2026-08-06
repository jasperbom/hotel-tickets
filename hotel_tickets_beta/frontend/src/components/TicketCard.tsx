import { Link } from "react-router-dom";
import { format } from "date-fns";
import { nl } from "date-fns/locale";
import { parseUTC, type Ticket } from "../api/client";
import { StatusBadge, PriorityBadge, CategoryBadge, CATEGORY_BORDER_COLORS } from "./StatusBadge";

interface Props {
  ticket: Ticket;
  users?: Record<string, string>;     // ha_user_id -> display_name
  locations?: Record<string, string>; // id -> name
  /** Aantal andere tickets op dezelfde locatie in de huidige lijst (excl. dit ticket) */
  relatedCount?: number;
}

export default function TicketCard({ ticket, users = {}, locations = {}, relatedCount = 0 }: Props) {
  const locationName = ticket.location_id ? locations[ticket.location_id] : null;

  return (
    <Link to={`/tickets/${ticket.id}`} className="block">
      <div className={`card border-l-4 ${CATEGORY_BORDER_COLORS[ticket.category]} hover:shadow-md transition-shadow cursor-pointer px-3 py-2.5`}>

        {/* Regel 1: locatie + titel + prioriteit */}
        <div className="flex items-center gap-2 min-w-0">
          {locationName && (
            <span className="shrink-0 inline-flex items-center gap-1 text-xs font-bold bg-blue-600 text-white px-2 py-0.5 rounded-md">
              🚪 {locationName}
            </span>
          )}
          <h3 className="font-semibold text-gray-900 text-sm leading-snug truncate flex-1">{ticket.title}</h3>
          {ticket.pinned && <span className="shrink-0 text-yellow-500 text-sm" title="Gepind">★</span>}
          <span className="shrink-0"><PriorityBadge priority={ticket.priority} /></span>
        </div>

        {/* Regel 2: badges + meta */}
        <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
          <StatusBadge status={ticket.status} />
          <CategoryBadge category={ticket.category} />
          {ticket.subtasks && ticket.subtasks.length > 0 && (
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
              ticket.subtasks.every((s) => s.done)
                ? "bg-green-100 text-green-700"
                : "bg-blue-50 text-blue-600"
            }`}>
              ☑ {ticket.subtasks.filter((s) => s.done).length}/{ticket.subtasks.length}
            </span>
          )}
          {ticket.photos && ticket.photos.length > 0 && (
            <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-purple-50 text-purple-600">
              📷 {ticket.photos.length}
            </span>
          )}
          {(ticket.comment_count ?? 0) > 0 && (
            <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
              💬 {ticket.comment_count}
            </span>
          )}
          {relatedCount > 0 && (
            <span
              className="text-xs font-semibold bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded"
              title={`Nog ${relatedCount} ticket${relatedCount === 1 ? "" : "s"} op deze locatie`}
            >
              +{relatedCount} hier
            </span>
          )}
          <span className="ml-auto flex items-center gap-2 text-xs text-gray-500 whitespace-nowrap">
            <span>
              {ticket.assigned_to
                ? `→ ${users[ticket.assigned_to] || ticket.assigned_to}`
                : "Niet toegewezen"}
            </span>
            <span>{format(parseUTC(ticket.created_at), "dd:MM HH:mm", { locale: nl })}</span>
          </span>
        </div>
      </div>
    </Link>
  );
}
