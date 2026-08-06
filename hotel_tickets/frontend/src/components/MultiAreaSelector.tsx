import { useEffect, useState } from "react";
import { locationApi, type Location } from "../api/client";

interface Props {
  value: string[];
  onChange: (ids: string[]) => void;
}

export default function MultiAreaSelector({ value, onChange }: Props) {
  const [locations, setLocations] = useState<Location[]>([]);

  useEffect(() => {
    locationApi.list().then((r) => setLocations(r.data)).catch(() => {});
  }, []);

  function toggle(id: string) {
    const next = value.includes(id) ? value.filter((v) => v !== id) : [...value, id];
    onChange(next);
  }

  if (locations.length === 0) {
    return <p className="text-sm text-ink-45">Geen locaties beschikbaar</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {locations.map((loc) => {
        const selected = value.includes(loc.id);
        return (
          <button
            key={loc.id}
            type="button"
            onClick={() => toggle(loc.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
              selected
                ? "bg-brand text-white border-brand"
                : "bg-paper-raised text-ink-70 border-ink-12 hover:border-ink-25"
            }`}
          >
            🚪 {loc.name}
          </button>
        );
      })}
    </div>
  );
}
