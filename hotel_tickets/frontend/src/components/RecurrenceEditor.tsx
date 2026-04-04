import { useState } from "react";

type Freq = "daily" | "workdays" | "weekly" | "monthly";

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
  const { freq, hour, minute, weekDays, monthDay } = parseCron(cron);
  return humanLabel(freq, hour, minute, weekDays, monthDay);
}

function humanLabel(freq: Freq, hour: number, minute: number, weekDays: number[], monthDay: number): string {
  const time = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  switch (freq) {
    case "daily":    return `Elke dag om ${time}`;
    case "workdays": return `Elke werkdag (ma–vr) om ${time}`;
    case "weekly": {
      if (weekDays.length === 0) return `Wekelijks om ${time}`;
      const names = [...weekDays].sort((a, b) => a - b)
        .map(d => WEEK_DAYS.find(x => x.idx === d)?.label ?? String(d));
      if (names.length === 1) return `Elke ${names[0]} om ${time}`;
      return `Elke ${names.slice(0, -1).join(", ")} en ${names[names.length - 1]} om ${time}`;
    }
    case "monthly":  return `Elke ${ordinal(monthDay)} van de maand om ${time}`;
  }
}

function buildCron(freq: Freq, hour: number, minute: number, weekDays: number[], monthDay: number): string {
  switch (freq) {
    case "daily":    return `${minute} ${hour} * * *`;
    case "workdays": return `${minute} ${hour} * * 1-5`;
    case "weekly":
      return `${minute} ${hour} * * ${weekDays.length ? [...weekDays].sort((a,b)=>a-b).join(",") : "1"}`;
    case "monthly":  return `${minute} ${hour} ${monthDay} * *`;
  }
}

function parseCron(cron: string): { freq: Freq; hour: number; minute: number; weekDays: number[]; monthDay: number } {
  const parts = cron.trim().split(/\s+/);
  const fallback = { freq: "daily" as Freq, hour: 8, minute: 0, weekDays: [1], monthDay: 1 };
  if (parts.length !== 5) return fallback;
  const [min, hr, dom, , dow] = parts;
  const hour   = parseInt(hr)  ?? 8;
  const minute = parseInt(min) ?? 0;
  const mDay   = parseInt(dom);
  if (!isNaN(mDay) && dom !== "*") return { freq: "monthly",  hour, minute, weekDays: [1], monthDay: mDay };
  if (dow === "1-5")                return { freq: "workdays", hour, minute, weekDays: [], monthDay: 1 };
  if (dow === "*")                  return { freq: "daily",    hour, minute, weekDays: [], monthDay: 1 };
  const days = dow.split(",").map(Number).filter(n => !isNaN(n));
  return { freq: "weekly", hour, minute, weekDays: days, monthDay: 1 };
}

interface Props {
  value: string;
  onChange: (cron: string) => void;
}

const FREQ_OPTIONS: { key: Freq; label: string; icon: string }[] = [
  { key: "daily",    label: "Dagelijks",   icon: "☀️" },
  { key: "workdays", label: "Werkdagen",   icon: "💼" },
  { key: "weekly",   label: "Wekelijks",   icon: "📅" },
  { key: "monthly",  label: "Maandelijks", icon: "🗓️" },
];

export default function RecurrenceEditor({ value, onChange }: Props) {
  const parsed = parseCron(value || "0 8 * * 1-5");
  const [freq,     setFreq]     = useState<Freq>(parsed.freq);
  const [hour,     setHour]     = useState(parsed.hour);
  const [minute,   setMinute]   = useState(parsed.minute);
  const [weekDays, setWeekDays] = useState<number[]>(parsed.weekDays.length ? parsed.weekDays : [1]);
  const [monthDay, setMonthDay] = useState(parsed.monthDay || 1);

  function emit(f: Freq, h: number, m: number, wd: number[], md: number) {
    onChange(buildCron(f, h, m, wd, md));
  }

  function handleFreq(f: Freq) {
    setFreq(f);
    emit(f, hour, minute, weekDays, monthDay);
  }

  function toggleWeekDay(idx: number) {
    const next = weekDays.includes(idx)
      ? weekDays.filter(d => d !== idx)
      : [...weekDays, idx];
    const safe = next.length === 0 ? [idx] : next;
    setWeekDays(safe);
    emit(freq, hour, minute, safe, monthDay);
  }

  function handleTime(rawH: string, rawM: string) {
    const h = Math.min(23, Math.max(0, parseInt(rawH) || 0));
    const m = Math.min(59, Math.max(0, parseInt(rawM) || 0));
    setHour(h);
    setMinute(m);
    emit(freq, h, m, weekDays, monthDay);
  }

  function handleMonthDay(d: number) {
    setMonthDay(d);
    emit(freq, hour, minute, weekDays, d);
  }

  const summary = humanLabel(freq, hour, minute, weekDays, monthDay);

  return (
    <div className="space-y-4">

      {/* Stap 1: frequentie */}
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

      {/* Stap 2: dag-selectie (alleen bij wekelijks of maandelijks) */}
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

      {freq === "monthly" && (
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

      {/* Stap 3: tijdstip */}
      <div>
        <p className="text-sm font-medium text-gray-700 mb-2">Hoe laat?</p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={0} max={23}
            value={String(hour).padStart(2, "0")}
            onChange={e => handleTime(e.target.value, String(minute))}
            className="w-16 border border-gray-300 rounded-lg px-2 py-2 text-sm text-center font-mono"
          />
          <span className="text-gray-500 font-bold">:</span>
          <input
            type="number"
            min={0} max={59}
            value={String(minute).padStart(2, "0")}
            onChange={e => handleTime(String(hour), e.target.value)}
            className="w-16 border border-gray-300 rounded-lg px-2 py-2 text-sm text-center font-mono"
          />
        </div>
      </div>

      {/* Samenvatting */}
      <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
        <span className="text-blue-500">🔁</span>
        <p className="text-sm font-medium text-blue-800">{summary}</p>
      </div>
    </div>
  );
}
