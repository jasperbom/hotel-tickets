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
    return <p className="text-sm text-gray-400">Geen locaties beschikbaar</p>;
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
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white text-gray-600 border-gray-300 hover:border-gray-400"
            }`}
          >
            🚪 {loc.name}
          </button>
        );
      })}
    </div>
  );
}
