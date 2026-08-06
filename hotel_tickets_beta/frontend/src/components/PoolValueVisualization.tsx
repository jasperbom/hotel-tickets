import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PoolLog } from "../api/client";

/**
 * Centrale definitie van meetwaarde-ranges.
 * - advies: streefrange (groene zone)
 * - bewaking: harde grenzen (waarde mag hier niet buiten vallen)
 */
export type RangeKey = "ph" | "vbc_in" | "vbc_uit" | "gbc";

export const POOL_RANGES: Record<
  RangeKey,
  { label: string; unit: string; advies: [number, number]; bewaking: [number, number] }
> = {
  ph: {
    label: "pH",
    unit: "",
    advies: [7.0, 7.6],
    bewaking: [4.0, 9.0],
  },
  vbc_in: {
    label: "VBC in",
    unit: "mg/l",
    advies: [0.5, 1.5],
    bewaking: [0.0, 2.0],
  },
  vbc_uit: {
    label: "VBC uit",
    unit: "mg/l",
    advies: [0.5, 1.5],
    bewaking: [0.0, 2.0],
  },
  gbc: {
    label: "Gebonden chloor",
    unit: "mg/l",
    // GBC moet onder 0,6 blijven; onder 0 kan niet dus 0-0.6 is "ok"
    advies: [0.0, 0.6],
    bewaking: [0.0, 2.5],
  },
};

export type ValueStatus = "leeg" | "ok" | "buiten_advies" | "buiten_bewaking";

export function getValueStatus(key: RangeKey, val: number | null | undefined): ValueStatus {
  if (val === null || val === undefined || Number.isNaN(val)) return "leeg";
  const { advies, bewaking } = POOL_RANGES[key];
  if (val < bewaking[0] || val > bewaking[1]) return "buiten_bewaking";
  if (val < advies[0] || val > advies[1]) return "buiten_advies";
  return "ok";
}

/**
 * Kleur-class voor tekstweergave, compatibel met bestaand PoolOverzicht/PoolLogboek-gebruik.
 * Default variant is voor witte achtergrond; "table" variant met lichte achtergrond.
 */
export function valueClass(
  key: RangeKey,
  val: number | null | undefined,
  variant: "text" | "table" = "text",
): string {
  const status = getValueStatus(key, val);
  if (status === "leeg") return variant === "table" ? "text-gray-400" : "";
  if (status === "ok") return variant === "table" ? "" : "text-green-700";
  if (status === "buiten_advies")
    return variant === "table" ? "bg-yellow-50 text-yellow-800 font-semibold" : "text-yellow-700 font-semibold";
  return variant === "table" ? "bg-red-100 text-red-700 font-bold" : "text-red-600 font-bold";
}

const STATUS_COLORS: Record<ValueStatus, string> = {
  leeg: "#9ca3af",
  ok: "#15803d",
  buiten_advies: "#ca8a04",
  buiten_bewaking: "#dc2626",
};

// ── Gauge ──────────────────────────────────────────────────────────────────

function Gauge({ rangeKey, value }: { rangeKey: RangeKey; value: number | null }) {
  const cfg = POOL_RANGES[rangeKey];
  const [bLo, bHi] = cfg.bewaking;
  const [aLo, aHi] = cfg.advies;
  const span = bHi - bLo || 1;
  const adviesLeftPct = ((aLo - bLo) / span) * 100;
  const adviesWidthPct = ((aHi - aLo) / span) * 100;

  const status = getValueStatus(rangeKey, value);
  const clamped =
    value === null ? null : Math.max(bLo, Math.min(bHi, value));
  const markerPct = clamped === null ? null : ((clamped - bLo) / span) * 100;
  const outsideBewaking = status === "buiten_bewaking";

  return (
    <div className="mb-3 last:mb-0">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-xs font-medium text-gray-700">
          {cfg.label}
          <span className="text-[10px] text-gray-400 ml-1">
            streef {aLo}
            {aHi > aLo ? `–${aHi}` : ""}
            {cfg.unit && ` ${cfg.unit}`}
          </span>
        </span>
        <span
          className="text-xs font-semibold tabular-nums"
          style={{ color: STATUS_COLORS[status] }}
        >
          {value === null || value === undefined ? "—" : value}
          {outsideBewaking && " ⚠"}
        </span>
      </div>
      <div className="relative w-full h-2.5 rounded-full bg-red-100 overflow-hidden">
        {/* Groene adviesrange */}
        <div
          className="absolute top-0 bottom-0 bg-green-200"
          style={{ left: `${adviesLeftPct}%`, width: `${adviesWidthPct}%` }}
        />
        {/* Marker */}
        {markerPct !== null && (
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full border-2 border-white shadow"
            style={{
              left: `${markerPct}%`,
              backgroundColor: STATUS_COLORS[status],
            }}
            title={`${value} (bewaking ${bLo}–${bHi})`}
          />
        )}
      </div>
      <div className="flex justify-between mt-0.5 text-[10px] text-gray-400 tabular-nums">
        <span>{bLo}</span>
        <span>{bHi}</span>
      </div>
    </div>
  );
}

function PoolGauges({ logs }: { logs: PoolLog[] }) {
  const latest = logs[0];
  if (!latest) {
    return <p className="text-sm text-gray-400 italic">Nog niet genoeg data voor grafiek</p>;
  }
  return (
    <div>
      <Gauge rangeKey="ph" value={latest.ph} />
      <Gauge rangeKey="vbc_in" value={latest.vbc_in} />
      <Gauge rangeKey="vbc_uit" value={latest.vbc_uit} />
      <Gauge rangeKey="gbc" value={latest.gbc} />
    </div>
  );
}

// ── Trend ──────────────────────────────────────────────────────────────────

type TrendPoint = {
  label: string;
  ph: number | null;
  vbc_in: number | null;
  vbc_uit: number | null;
  gbc: number | null;
};

function buildTrendData(logs: PoolLog[]): TrendPoint[] {
  // logs komen van nieuw → oud; we willen van oud → nieuw voor de grafiek.
  const sorted = [...logs].sort((a, b) => {
    const da = `${a.datum}T${a.tijd}`;
    const db = `${b.datum}T${b.tijd}`;
    return da.localeCompare(db);
  });
  return sorted.map((l) => ({
    label: `${l.datum.slice(5)} ${l.tijd}`,
    ph: l.ph,
    vbc_in: l.vbc_in,
    vbc_uit: l.vbc_uit,
    gbc: l.gbc,
  }));
}

function TrendChart({
  data,
  rangeKey,
}: {
  data: TrendPoint[];
  rangeKey: RangeKey;
}) {
  const cfg = POOL_RANGES[rangeKey];
  const [bLo, bHi] = cfg.bewaking;
  const [aLo, aHi] = cfg.advies;
  return (
    <div>
      <div className="flex items-baseline justify-between mb-0.5">
        <span className="text-xs font-medium text-gray-700">{cfg.label}</span>
        <span className="text-[10px] text-gray-400">
          streef {aLo}
          {aHi > aLo ? `–${aHi}` : ""}
          {cfg.unit && ` ${cfg.unit}`}
        </span>
      </div>
      <ResponsiveContainer width="100%" height={120}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid stroke="#f3f4f6" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 9, fill: "#9ca3af" }}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[bLo, bHi]}
            tick={{ fontSize: 10, fill: "#9ca3af" }}
            width={32}
          />
          <Tooltip
            contentStyle={{ fontSize: 12, padding: 6 }}
            formatter={(v: number | string) => [v, cfg.label]}
          />
          <ReferenceArea
            y1={aLo}
            y2={aHi}
            fill="#bbf7d0"
            fillOpacity={0.45}
            ifOverflow="extendDomain"
          />
          <ReferenceLine y={bLo} stroke="#dc2626" strokeDasharray="3 3" />
          <ReferenceLine y={bHi} stroke="#dc2626" strokeDasharray="3 3" />
          <Line
            type="monotone"
            dataKey={rangeKey}
            stroke="#1d4ed8"
            strokeWidth={2}
            dot={(props: any) => {
              const val = props.payload?.[rangeKey] as number | null | undefined;
              const status = getValueStatus(rangeKey, val);
              return (
                <circle
                  key={`${rangeKey}-dot-${props.index}`}
                  cx={props.cx}
                  cy={props.cy}
                  r={status === "ok" ? 3 : 4}
                  fill={STATUS_COLORS[status]}
                  stroke="#fff"
                  strokeWidth={1}
                />
              );
            }}
            isAnimationActive={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function PoolTrend({ logs }: { logs: PoolLog[] }) {
  if (logs.length < 2) {
    return <p className="text-sm text-gray-400 italic">Nog niet genoeg data voor grafiek</p>;
  }
  const data = buildTrendData(logs);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <TrendChart data={data} rangeKey="ph" />
      <TrendChart data={data} rangeKey="vbc_in" />
      <TrendChart data={data} rangeKey="vbc_uit" />
      <TrendChart data={data} rangeKey="gbc" />
    </div>
  );
}

// ── Wrapper met tab-toggle ────────────────────────────────────────────────

export function PoolValueVisualization({ logs }: { logs: PoolLog[] }) {
  const [mode, setMode] = useState<"huidig" | "trend">("huidig");

  return (
    <div className="mt-4 pt-3 border-t border-gray-100">
      <div className="flex items-center gap-1 mb-3">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide mr-auto">
          Waardes versus streefbereik
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMode("huidig");
          }}
          aria-pressed={mode === "huidig"}
          className={`text-xs px-2.5 py-1 rounded-md ${
            mode === "huidig"
              ? "bg-blue-600 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          Huidig
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMode("trend");
          }}
          aria-pressed={mode === "trend"}
          className={`text-xs px-2.5 py-1 rounded-md ${
            mode === "trend"
              ? "bg-blue-600 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          Trend 14d
        </button>
      </div>

      <div onClick={(e) => e.stopPropagation()}>
        {mode === "huidig" ? <PoolGauges logs={logs} /> : <PoolTrend logs={logs} />}
      </div>
    </div>
  );
}
