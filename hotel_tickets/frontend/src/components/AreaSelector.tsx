import { useEffect, useState } from "react";
import { locationApi, type Location } from "../api/client";

interface Props {
  value: string | null;
  onChange: (id: string | null) => void;
}

export default function AreaSelector({ value, onChange }: Props) {
  const [locations, setLocations] = useState<Location[]>([]);

  useEffect(() => {
    locationApi.list().then((r) => setLocations(r.data)).catch(() => {});
  }, []);

  return (
    <select
      value={value || ""}
      onChange={(e) => onChange(e.target.value || null)}
      className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
    >
      <option value="">— Geen locatie —</option>
      {locations.map((loc) => (
        <option key={loc.id} value={loc.id}>
          {loc.name}
        </option>
      ))}
    </select>
  );
}
