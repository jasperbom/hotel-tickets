import { useState } from "react";

type Freq = "daily" | "weekly" | "monthly" | "every_x_months";

const FIXED_HOUR = 8;
const FIXED_MINUTE = 0;

const WEEK_DAYS = [
  { short: "Ma", label: "Maandag",    idx: 1 },
  { short: "Di", label: "Dinsdag",    idx: 2 },
  { short: "Wo", label: "Woensdag",   idx: 3 },
  { short: "Do", label: "Donderdag",  idx: 4 },
  { short: "Vr", label: "Vrijdag",    idx: 5 },
  { short: "Za", label: "Zaterdag",   idx: 6 },
  { short: "Zo", label: "Zondag",     idx: 0 },
];

const MONTH_DAYS = Array.from({ length: 31 }, (_, i) => i + 1);

function ordinal(n: number): string {
  return n === 1 ? "1ste" : `${n}e`;
}

export function cronToHuman(cron: string): string {
  const { freq, weekDays, monthDay, everyXMonths } = parseCron(cron);
  return humanLabel(freq, weekDays, monthDay, everyXMonths);
}

function humanLabel(freq: Freq, weekDays: number[], monthDay: number, everyXMonths: number): string {
  switch (freq) {
    case "daily":   return "Elke dag";
    case "weekly": {
      if (weekDays.length === 0) return "Wekelijks";
      const names = [...weekDays].sort((a, b) => a - b)
        .map(d => WEEK_DAYS.find(x => x.idx === d)?.label ?? String(d));
      if (names.length === 1) return `Elke ${names[0]}`;
      return `Elke ${names.slice(0, -1).join(", ")} en ${names[names.length - 1]}`;
    }
    case "monthly":        return `Elke ${ordinal(monthDay)} van de maand`;
    case "every_x_months": return `Elke ${everyXMonths} maanden (${ordinal(monthDay)})`;
  }
}

function buildCron(freq: Freq, weekDays: number[], monthDay: number, everyXMonths: number): string {
  const h = FIXED_HOUR;
  const m = FIXED_MINUTE;
  switch (freq) {
    case "daily":          return `${m} ${h} * * *`;
    case "weekly":
      return `${m} ${h} * * ${weekDays.length ? [...weekDays].sort((a,b)=>a-b).join(",") : "1"}`;
    case "monthly":        return `${m} ${h} ${monthDay} * *`;
    case "every_x_months": return `${m} ${h} ${monthDay} */${everyXMonths} *`;
  }
}

function parseCron(cron: string): { freq: Freq; weekDays: number[]; monthDay: number; everyXMonths: number } {
  const parts = cron.trim().split(/\s+/);
  const fallback = { freq: "daily" as Freq, weekDays: [1], monthDay: 1, everyXMonths: 1 };
  if (parts.length !== 5) return fallback;
  const [, , dom, month, dow] = parts;
  const mDay = parseInt(dom);

  if (!isNaN(mDay) && dom !== "*") {
    // Monthly of every_x_months
    if (month.startsWith("*/")) {
      const x = parseInt(month.slice(2));
      return { freq: "every_x_months", weekDays: [], monthDay: mDay, everyXMonths: isNaN(x) ? 1 : x };
    }
    return { freq: "monthly", weekDays: [], monthDay: mDay, everyXMonths: 1 };
  }
  if (dow === "*") return { freq: "daily", weekDays: [], monthDay: 1, everyXMonths: 1 };
  const days = dow.split(",").map(Number).filter(n => !isNaN(n));
  return { freq: "weekly", weekDays: days, monthDay: 1, everyXMonths: 1 };
}

interface Props {
  value: string;
  onChange: (cron: string) => void;
}

const FREQ_OPTIONS: { key: Freq; label: string; icon: string }[] = [
  { key: "daily",          label: "Dagelijks",       icon: "☀️" },
  { key: "weekly",         label: "Wekelijks",        icon: "📅" },
  { key: "monthly",        label: "Maandelijks",      icon: "🗓️" },
  { key: "every_x_months", label: "Elke X maanden",  icon: "📆" },
];

export default function RecurrenceEditor({ value, onChange }: Props) {
  const parsed = parseCron(value || "0 8 * * *");
  const [freq,          setFreq]          = useState<Freq>(parsed.freq);
  const [weekDays,      setWeekDays]      = useState<number[]>(parsed.weekDays.length ? parsed.weekDays : [1]);
  const [monthDay,      setMonthDay]      = useState(parsed.monthDay || 1);
  const [everyXMonths,  setEveryXMonths]  = useState(parsed.everyXMonths || 1);

  function emit(f: Freq, wd: number[], md: number, xm: number) {
    onChange(buildCron(f, wd, md, xm));
  }

  function handleFreq(f: Freq) {
    setFreq(f);
    emit(f, weekDays, monthDay, everyXMonths);
  }

  function toggleWeekDay(idx: number) {
    const next = weekDays.includes(idx)
      ? weekDays.filter(d => d !== idx)
      : [...weekDays, idx];
    const safe = next.length === 0 ? [idx] : next;
    setWeekDays(safe);
    emit(freq, safe, monthDay, everyXMonths);
  }

  function handleMonthDay(d: number) {
    setMonthDay(d);
    emit(freq, weekDays, d, everyXMonths);
  }

  function handleEveryXMonths(x: number) {
    const safe = Math.min(12, Math.max(1, x));
    setEveryXMonths(safe);
    emit(freq, weekDays, monthDay, safe);
  }

  const summary = humanLabel(freq, weekDays, monthDay, everyXMonths);

  return (
    <div className="space-y-4">

      {/* Frequentie */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Hoe vaak?</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {FREQ_OPTIONS.map(opt => (
            <button
              key={opt.key}
              type="button"
              onClick={() => handleFreq(opt.key)}
              className={`flex flex-col items-center gap-1 py-3 px-2 rounded-xl border-2 text-sm font-medium transition-all ${
                freq === opt.key
                  ? "border-blue-600 bg-blue-50 text-blue-700"
                  : "border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-gray-50"
              }`}
            >
              <span className="text-xl">{opt.icon}</span>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Dag-selectie wekelijks */}
      {freq === "weekly" && (
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Op welke dag(en)?</p>
          <div className="flex flex-wrap gap-2">
            {WEEK_DAYS.map(day => (
              <button
                key={day.idx}
                type="button"
                onClick={() => toggleWeekDay(day.idx)}
                title={day.label}
                className={`w-10 h-10 rounded-xl text-sm font-semibold transition-all ${
                  weekDays.includes(day.idx)
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {day.short}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Dag van de maand (maandelijks + elke X maanden) */}
      {(freq === "monthly" || freq === "every_x_months") && (
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Op welke dag van de maand?</p>
          <div className="flex flex-wrap gap-1.5">
            {MONTH_DAYS.map(d => (
              <button
                key={d}
                type="button"
                onClick={() => handleMonthDay(d)}
                className={`w-9 h-9 rounded-lg text-sm font-medium transition-all ${
                  monthDay === d
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Interval voor elke X maanden */}
      {freq === "every_x_months" && (
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Elke hoeveel maanden?</p>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              max={12}
              value={everyXMonths}
              onChange={e => handleEveryXMonths(parseInt(e.target.value) || 1)}
              className="w-20 border border-gray-300 rounded-lg px-3 py-2 text-sm text-center font-mono"
            />
            <span className="text-sm text-gray-500">maanden</span>
          </div>
        </div>
      )}

      {/* Samenvatting */}
      <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
        <span className="text-blue-500">🔁</span>
        <p className="text-sm font-medium text-blue-800">{summary}</p>
      </div>
    </div>
  );
}
