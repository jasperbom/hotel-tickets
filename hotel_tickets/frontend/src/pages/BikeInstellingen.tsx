import { useEffect, useRef, useState } from "react";
import { bikesModuleApi, bikeAdminApi, type BikesModuleRoles } from "../api/client";

const ROLES_OPTIONS: { value: BikesModuleRoles; label: string; description: string }[] = [
  {
    value: "all",
    label: "Iedereen",
    description: "Alle ingelogde medewerkers kunnen de fietsenmodule zien en gebruiken.",
  },
  {
    value: "reception",
    label: "Receptie + leidinggevenden",
    description: "Alleen receptiemedewerkers, supervisors en admins hebben toegang.",
  },
  {
    value: "admin_supervisor",
    label: "Alleen leidinggevenden",
    description: "Alleen supervisors en admins kunnen de fietsenmodule zien.",
  },
];

export default function BikeInstellingen() {
  const [currentRoles, setCurrentRoles] = useState<BikesModuleRoles>("all");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Excel import state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    ok: boolean; imported: number; skipped: number; errors: string[];
  } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    bikesModuleApi
      .getSetting()
      .then((r) => setCurrentRoles(r.data.bikes_module_roles))
      .finally(() => setLoading(false));
  }, []);

  async function save(value: BikesModuleRoles) {
    setSaving(true);
    setSaved(false);
    try {
      const r = await bikesModuleApi.updateSetting(value);
      setCurrentRoles(r.data.bikes_module_roles);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } finally {
      setSaving(false);
    }
  }

  async function handleExcelUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setImportResult(null);
    setImportError(null);
    try {
      const r = await bikeAdminApi.importExcel(file);
      setImportResult(r.data);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setImportError(msg || "Import mislukt");
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  // resetImport is verwijderd — import werkt altijd met deduplicatie

  if (loading) return <p className="p-4 text-gray-400">Laden...</p>;

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold mb-6">Fietsen instellingen</h1>

      <div className="bg-white rounded-2xl shadow p-6 space-y-6">
        {/* Zichtbaarheid */}
        <div>
          <h2 className="font-bold text-base mb-1">Module-zichtbaarheid</h2>
          <p className="text-sm text-gray-500 mb-4">
            Bepaal welke medewerkers de fietsenmodule in het menu kunnen zien.
          </p>
          <div className="space-y-3">
            {ROLES_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex items-start gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
                  currentRoles === opt.value
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <input
                  type="radio"
                  name="roles"
                  value={opt.value}
                  checked={currentRoles === opt.value}
                  onChange={() => save(opt.value)}
                  className="mt-0.5 accent-blue-600"
                  disabled={saving}
                />
                <div>
                  <p className="font-medium text-sm">{opt.label}</p>
                  <p className="text-xs text-gray-500">{opt.description}</p>
                </div>
              </label>
            ))}
          </div>
          {saving && <p className="text-sm text-gray-400 mt-2">Opslaan...</p>}
          {saved && <p className="text-sm text-green-600 mt-2">✓ Instelling opgeslagen</p>}
        </div>

        {/* Excel import */}
        <div className="border-t pt-5">
          <h2 className="font-bold text-base mb-1">Historische data importeren</h2>
          <p className="text-sm text-gray-500 mb-4">
            Upload een Excel-bestand in het Fietsverhuur-formaat om historische reserveringen te importeren.
            Dit kan slechts één keer; gebruik de reset-knop om opnieuw te importeren.
          </p>
          <div className="flex flex-wrap gap-3 items-center">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              onChange={handleExcelUpload}
              className="hidden"
              id="excel-upload"
            />
            <label
              htmlFor="excel-upload"
              className={`cursor-pointer bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors ${importing ? "opacity-50 cursor-not-allowed pointer-events-none" : ""}`}
            >
              {importing ? "Importeren..." : "📂 Excel uploaden"}
            </label>
          </div>

          {importResult && (
            <div className="mt-3 bg-green-50 rounded-lg p-3 text-sm text-green-800">
              ✓ Import klaar — <strong>{importResult.imported}</strong> reserveringen geïmporteerd,{" "}
              <strong>{importResult.skipped}</strong> overgeslagen (fiets niet gevonden).
              {importResult.errors.length > 0 && (
                <ul className="mt-2 text-xs text-orange-700 space-y-0.5">
                  {importResult.errors.map((e, i) => <li key={i}>⚠ {e}</li>)}
                </ul>
              )}
            </div>
          )}
          {importError && (
            <p className="mt-3 text-sm text-red-600">{importError}</p>
          )}
        </div>

        {/* Info */}
        <div className="border-t pt-5">
          <h2 className="font-bold text-base mb-2">Over de fietsenmodule</h2>
          <div className="text-sm text-gray-600 space-y-2">
            <p>
              De fietsenmodule is geïntegreerd in het hotel-ticket systeem. Reserveringen,
              fietsbeheer en onderhoud worden vanuit één plek beheerd.
            </p>
            <p>
              <strong>Onderhoud → ticket integratie:</strong> Wanneer een fiets in onderhoud
              gaat, wordt er automatisch een ticket aangemaakt bij de technische dienst. Als
              het onderhoud afgerond wordt, sluit het bijbehorende ticket automatisch.
            </p>
            <p>
              <strong>Rotatie:</strong> Bij het aanmaken van reserveringen worden fietsen
              automatisch verdeeld op basis van het minste aantal verhuurdagen (eerlijke rotatie).
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
