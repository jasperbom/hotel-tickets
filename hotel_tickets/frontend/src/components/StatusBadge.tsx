import type { Status, Priority, Category } from "../api/client";

const STATUS_COLORS: Record<Status, string> = {
  open: "bg-yellow-100 text-yellow-800",
  in_progress: "bg-blue-100 text-blue-800",
  closed: "bg-green-100 text-green-800",
};

const STATUS_LABELS: Record<Status, string> = {
  open: "Open",
  in_progress: "In behandeling",
  closed: "Gesloten",
};

const PRIORITY_COLORS: Record<Priority, string> = {
  low: "bg-gray-100 text-gray-600",
  medium: "bg-yellow-100 text-yellow-800",
  high: "bg-orange-300 text-orange-900",
  urgent: "bg-red-600 text-white font-semibold",
};

const PRIORITY_LABELS: Record<Priority, string> = {
  low: "Laag",
  medium: "Normaal",
  high: "Hoog",
  urgent: "Urgent",
};

const CATEGORY_LABELS: Record<Category, string> = {
  technical: "TD",
  housekeeping: "Huishouding",
  reception: "Receptie",
  service: "Bediening",
  kitchen: "Keuken",
  sales: "Sales",
  garden: "Tuin",
};

const CATEGORY_COLORS: Record<Category, string> = {
  technical: "bg-purple-100 text-purple-700",
  housekeeping: "bg-teal-100 text-teal-700",
  reception: "bg-indigo-100 text-indigo-700",
  service: "bg-orange-100 text-orange-700",
  kitchen: "bg-rose-100 text-rose-700",
  sales: "bg-amber-100 text-amber-700",
  garden: "bg-emerald-100 text-emerald-700",
};

/** Linkerrand-accent per afdeling — zelfde tinten als de CategoryBadge,
 *  zodat afdelingen overal aan dezelfde kleur herkenbaar zijn. */
export const CATEGORY_BORDER_COLORS: Record<Category, string> = {
  technical: "border-l-purple-500",
  housekeeping: "border-l-teal-500",
  reception: "border-l-indigo-500",
  service: "border-l-orange-500",
  kitchen: "border-l-rose-500",
  sales: "border-l-amber-500",
  garden: "border-l-emerald-500",
};

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`badge ${STATUS_COLORS[status]}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: Priority }) {
  return (
    <span className={`badge ${PRIORITY_COLORS[priority]}`}>
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

export function CategoryBadge({ category }: { category: Category }) {
  return (
    <span className={`badge ${CATEGORY_COLORS[category]}`}>
      {CATEGORY_LABELS[category]}
    </span>
  );
}
