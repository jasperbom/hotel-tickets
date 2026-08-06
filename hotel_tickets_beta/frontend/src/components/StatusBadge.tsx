import type { Status, Priority, Category } from "../api/client";
import { AFDELING_KORT } from "../werk";

/**
 * De laatste badges in de app — nog in gebruik op de herhaaltaak-detailpagina.
 * Ze volgen nu het kleursysteem: kleur draagt alleen prioriteit (urgent, hoog)
 * en "klaar". Al het andere is grijze tekst.
 */

const STATUS_LABELS: Record<Status, string> = {
  open: "Te doen",
  // "In behandeling" bestaat niet meer in de interface: dat codeerde wie de
  // toewijzing deed, en dat wil niemand weten.
  in_progress: "Te doen",
  closed: "Klaar",
};

const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Laag",
  medium: "Normaal",
  high: "Hoog",
  urgent: "Urgent",
};

export function StatusBadge({ status }: { status: Status }) {
  const af = status === "closed";
  return (
    <span className={`badge ${af ? "bg-done-soft text-done" : "bg-ink-6 text-ink-70"}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  if (priority === "urgent") {
    return <span className="badge bg-urgent-soft text-urgent font-semibold">Urgent</span>;
  }
  if (priority === "high") {
    return <span className="badge bg-high-soft text-high font-semibold">Hoog</span>;
  }
  // Normaal en laag krijgen geen kleur: stilte is óók informatie.
  return <span className="badge bg-ink-6 text-ink-70">{PRIORITY_LABELS[priority]}</span>;
}

export function CategoryBadge({ category }: { category: Category }) {
  return <span className="badge bg-ink-6 text-ink-70">{AFDELING_KORT[category]}</span>;
}
