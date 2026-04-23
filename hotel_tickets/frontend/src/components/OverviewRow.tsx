import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { Priority } from "../api/client";

const PRIORITY_BORDER: Record<Priority, string> = {
  urgent: "border-l-red-600",
  high: "border-l-orange-500",
  medium: "border-l-yellow-400",
  low: "border-l-gray-300",
};

export type ExtraRoom = { id: string; name: string; occupied?: boolean | null };

export type OverviewRowProps = {
  to?: string;
  priority: Priority;
  borderOverride?: string;
  containerClassName?: string;

  roomName?: string;
  occupied?: boolean | null;
  extraRooms?: ExtraRoom[];

  titleIcon?: string;
  title: string;
  titleClassName?: string;

  statusSlot?: ReactNode;
  prioritySlot?: ReactNode;
  dateText?: string;
  dateClassName?: string;

  photoCount?: number;
  commentCount?: number;
  subtasks?: { done: number; total: number };

  actionSlot?: ReactNode;
  onComplete?: () => void;
  completeTitle?: string;
};

function OccupiedChip({ occupied }: { occupied: boolean | null | undefined }) {
  if (occupied === true) {
    return <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-orange-100 text-orange-700">Bezet</span>;
  }
  if (occupied === false) {
    return <span className="text-xs font-semibold px-1.5 py-0.5 rounded bg-green-100 text-green-700">Vrij</span>;
  }
  return null;
}

export function OverviewRow(props: OverviewRowProps) {
  const {
    to,
    priority,
    borderOverride,
    containerClassName = "",
    roomName,
    occupied,
    extraRooms,
    titleIcon,
    title,
    titleClassName = "",
    statusSlot,
    prioritySlot,
    dateText,
    dateClassName = "text-gray-400",
    photoCount,
    commentCount,
    subtasks,
    actionSlot,
    onComplete,
    completeTitle = "Afronden",
  } = props;

  const borderClass = borderOverride ?? PRIORITY_BORDER[priority];
  const baseClass =
    "block bg-white rounded-xl shadow-sm border border-gray-100 border-l-4 p-3 hover:shadow-md transition-shadow " +
    borderClass +
    " " +
    containerClassName;

  const subtasksAllDone = subtasks && subtasks.done === subtasks.total;

  const content = (
    <>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
        {/* Regel 1 op mobiel: kamer + bezet/vrij + titel */}
        <div className="flex items-center gap-2 min-w-0 sm:contents">
          <div className="flex items-center gap-1 shrink-0 min-w-0 sm:w-28 sm:shrink-0">
            {titleIcon && <span className="text-base shrink-0">{titleIcon}</span>}
            {roomName ? (
              <span className="font-bold text-base text-blue-900 truncate">{roomName}</span>
            ) : (
              <span className="text-xs text-gray-300 hidden sm:inline">—</span>
            )}
          </div>
          <div className="shrink-0 sm:w-14 sm:shrink-0">
            <OccupiedChip occupied={occupied} />
          </div>
          <div className="flex items-center gap-1.5 flex-1 min-w-0 sm:flex-1 sm:min-w-0">
            <p className={`font-medium text-sm truncate ${titleClassName || "text-gray-900"}`}>{title}</p>
          </div>
        </div>

        {/* Regel 2 op mobiel: status, prio, datum, tellers, actie */}
        <div className="flex items-center gap-2 pl-3 flex-wrap sm:pl-0 sm:flex-nowrap sm:contents">
          <div className="sm:w-28 sm:shrink-0 sm:flex sm:justify-start">{statusSlot}</div>
          <div className="sm:w-20 sm:shrink-0 sm:flex sm:justify-start">{prioritySlot}</div>
          <div className={`text-xs sm:w-16 sm:text-right sm:shrink-0 ${dateClassName}`}>
            {dateText ?? ""}
          </div>
          <div className="sm:w-16 sm:shrink-0 sm:flex sm:justify-end">
            {subtasks && (
              <span
                className={`text-xs font-medium px-1.5 py-0.5 rounded whitespace-nowrap ${
                  subtasksAllDone ? "bg-green-100 text-green-700" : "bg-blue-50 text-blue-600"
                }`}
              >
                ☑ {subtasks.done}/{subtasks.total}
              </span>
            )}
          </div>
          <div className="sm:w-12 sm:shrink-0 sm:flex sm:justify-end">
            {photoCount ? (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 whitespace-nowrap">
                📷 {photoCount}
              </span>
            ) : null}
          </div>
          <div className="sm:w-12 sm:shrink-0 sm:flex sm:justify-end">
            {commentCount ? (
              <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 whitespace-nowrap">
                💬 {commentCount}
              </span>
            ) : null}
          </div>
          {actionSlot && <div className="shrink-0 ml-auto sm:ml-0">{actionSlot}</div>}
          {onComplete && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onComplete(); }}
              title={completeTitle}
              aria-label={completeTitle}
              className={`shrink-0 inline-flex items-center justify-center w-8 h-8 rounded-lg border border-green-300 text-green-700 hover:bg-green-50 active:bg-green-100 transition-colors ${actionSlot ? "" : "ml-auto sm:ml-0"}`}
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4" aria-hidden="true">
                <path fillRule="evenodd" d="M16.704 5.296a1 1 0 010 1.408l-7.5 7.5a1 1 0 01-1.408 0l-3.5-3.5a1 1 0 111.408-1.408L8.5 12.092l6.796-6.796a1 1 0 011.408 0z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Extra kamers (recurring rooms-mode) — onder de hoofdregel zodat kolomposities vast blijven */}
      {extraRooms && extraRooms.length > 0 && (
        <div className="mt-1 pl-3 flex flex-wrap gap-x-3 gap-y-1">
          {extraRooms.map((r) => (
            <div key={r.id} className="flex items-center gap-1.5">
              {titleIcon && <span className="text-sm shrink-0">{titleIcon}</span>}
              <span className="font-bold text-sm text-blue-900">{r.name}</span>
              <OccupiedChip occupied={r.occupied} />
            </div>
          ))}
        </div>
      )}
    </>
  );

  if (to) {
    return (
      <Link to={to} className={baseClass}>
        {content}
      </Link>
    );
  }
  return <div className={baseClass}>{content}</div>;
}
