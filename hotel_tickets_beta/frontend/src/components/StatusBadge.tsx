import type { Status, Priority, Category } from "../api/client";
import { AFDELING_KORT, prioriteitWoord } from "../werk";

/**
 * De laatste badges in de app — nog in gebruik op de herhaaltaak-detailpagina.
 * Ze volgen het kleursysteem: kleur draagt prioriteit (vier niveaus) en
 * "klaar". Al het andere is grijze tekst.
 */

const STATUS_LABELS: Record<Status, string> = {
  open: "Te doen",
  // "In behandeling" bestaat niet meer in de interface: dat codeerde wie de
  // toewijzing deed, en dat wil niemand weten.
  in_progress: "Te doen",
  closed: "Klaar",
};

export function StatusBadge({ status }: { status: Status }) {
  const af = status === "closed";
  return (
    <span className={`badge ${af ? "bg-done-soft text-done" : "bg-ink-6 text-ink-70"}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

const PRIORITY_BADGE: Record<Priority, string> = {
  urgent: "bg-urgent-soft text-urgent",
  high: "bg-high-soft text-high",
  medium: "bg-normal-soft text-normal",
  low: "bg-low-soft text-low",
};

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`badge font-semibold ${PRIORITY_BADGE[priority]}`}>
      {prioriteitWoord(priority)}
    </span>
  );
}

export function CategoryBadge({ category }: { category: Category }) {
  return <span className="badge bg-ink-6 text-ink-70">{AFDELING_KORT[category]}</span>;
}
