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
  medium: "bg-blue-100 text-blue-700",
  high: "bg-orange-100 text-orange-700",
  urgent: "bg-red-100 text-red-700",
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
};

const CATEGORY_COLORS: Record<Category, string> = {
  technical: "bg-purple-100 text-purple-700",
  housekeeping: "bg-teal-100 text-teal-700",
  reception: "bg-indigo-100 text-indigo-700",
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
