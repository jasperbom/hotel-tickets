import { useState } from "react";

interface Props {
  value: string;
  onChange: (cron: string) => void;
}

const DAYS = ["Zo", "Ma", "Di", "Wo", "Do", "Vr", "Za"];
const PRESET_OPTIONS = [
  { label: "Dagelijks om 08:00", cron: "0 8 * * *" },
  { label: "Werkdagen om 08:00", cron: "0 8 * * 1-5" },
  { label: "Elke maandag om 09:00", cron: "0 9 * * 1" },
  { label: "Wekelijks (maandag + donderdag)", cron: "0 8 * * 1,4" },
  { label: "Maandelijks (1e van de maand)", cron: "0 8 1 * *" },
  { label: "Handmatig invullen", cron: "custom" },
];

export default function RecurrenceEditor({ value, onChange }: Props) {
  const [mode, setMode] = useState<"preset" | "visual" | "manual">("preset");
  const [hour, setHour] = useState("8");
  const [minute, setMinute] = useState("0");
  const [selectedDays, setSelectedDays] = useState<number[]>([1]);
  const [manualCron, setManualCron] = useState(value);
  const [selectedPreset, setSelectedPreset] = useState(value);

  function toggleDay(idx: number) {
    const next = selectedDays.includes(idx)
      ? selectedDays.filter((d) => d !== idx)
      : [...selectedDays, idx].sort();
    setSelectedDays(next);
    const dayStr = next.length === 7 ? "*" : next.join(",");
    onChange(`${minute} ${hour} * * ${dayStr}`);
  }

  function handlePreset(cron: string) {
    setSelectedPreset(cron);
    if (cron !== "custom") {
      onChange(cron);
      setMode("preset");
    } else {
      setMode("manual");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {(["preset", "visual", "manual"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
              mode === m
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50"
            }`}
          >
            {m === "preset" ? "Voorinstelling" : m === "visual" ? "Visueel" : "Handmatig (cron)"}
          </button>
        ))}
      </div>

      {mode === "preset" && (
        <div className="grid grid-cols-1 gap-2">
          {PRESET_OPTIONS.map((opt) => (
            <label key={opt.cron} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="preset"
                value={opt.cron}
                checked={selectedPreset === opt.cron}
                onChange={() => handlePreset(opt.cron)}
                className="text-blue-600"
              />
              <span className="text-sm">{opt.label}</span>
              {opt.cron !== "custom" && (
                <code className="text-xs text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{opt.cron}</code>
              )}
            </label>
          ))}
        </div>
      )}

      {mode === "visual" && (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">Dagen van de week</p>
            <div className="flex gap-1">
              {DAYS.map((day, idx) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleDay(idx)}
                  className={`w-9 h-9 rounded-lg text-sm font-medium transition-colors ${
                    selectedDays.includes(idx)
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  }`}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-medium text-gray-700">Tijdstip:</label>
            <input
              type="number"
              min="0" max="23"
              value={hour}
              onChange={(e) => {
                setHour(e.target.value);
                const dayStr = selectedDays.length === 7 ? "*" : selectedDays.join(",");
                onChange(`${minute} ${e.target.value} * * ${dayStr}`);
              }}
              className="w-16 border border-gray-300 rounded-lg px-2 py-1 text-sm"
            />
            <span>:</span>
            <input
              type="number"
              min="0" max="59"
              value={minute}
              onChange={(e) => {
                setMinute(e.target.value);
                const dayStr = selectedDays.length === 7 ? "*" : selectedDays.join(",");
                onChange(`${e.target.value} ${hour} * * ${dayStr}`);
              }}
              className="w-16 border border-gray-300 rounded-lg px-2 py-1 text-sm"
            />
          </div>
        </div>
      )}

      {mode === "manual" && (
        <div>
          <label className="text-sm font-medium text-gray-700">Cron expressie</label>
          <input
            type="text"
            value={manualCron}
            onChange={(e) => {
              setManualCron(e.target.value);
              onChange(e.target.value);
            }}
            placeholder="0 8 * * 1-5"
            className="mt-1 block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono"
          />
          <p className="mt-1 text-xs text-gray-500">
            Formaat: minuut uur dag-van-maand maand dag-van-week
          </p>
        </div>
      )}

      <div className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 font-mono">
        Huidig schema: <strong>{value || "—"}</strong>
      </div>
    </div>
  );
}
