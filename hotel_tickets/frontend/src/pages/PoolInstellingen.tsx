import { useEffect, useState } from "react";
import { poolApi, type PoolConfigItem } from "../api/client";

function ImportPanel() {
  const [poolId, setPoolId] = useState<string>("wellness");
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleImport() {
    if (!file) return;
    setImporting(true);
    setResult(null);
    try {
      const res = await poolApi.importCsv(file, poolId);
      const { imported, skipped } = res.data;
      const parts = [`${imported} metingen geïmporteerd`];
      if (skipped > 0) parts.push(`${skipped} duplicaten overgeslagen`);
      setResult(parts.join(", ") + ".");
    } catch {
      setResult("Import mislukt — controleer het CSV-formaat.");
    }
    setImporting(false);
  }

  return (
    <div className="bg-white rounded-2xl shadow p-5">
      <h2 className="text-lg font-bold mb-3">CSV importeren</h2>
      <p className="text-sm text-gray-500 mb-4">
        Importeer historische metingen uit een CSV-bestand (;-gescheiden, met header: Datum;Tijd;...).
        Bestaande metingen (zelfde bad, datum en tijd) worden overgeslagen.
      </p>
      <div className="flex gap-3 items-end flex-wrap">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Bad</label>
          <select
            className="border rounded-lg px-3 py-2 text-sm"
            value={poolId}
            onChange={(e) => setPoolId(e.target.value)}
          >
            <option value="wellness">Wellness</option>
            <option value="zwembad">Zwembad</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">CSV-bestand</label>
          <input
            type="file"
            accept=".csv,.txt"
            className="text-sm"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </div>
        <button
          onClick={handleImport}
          disabled={!file || importing}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
        >
          {importing ? "Importeren..." : "Importeren"}
        </button>
      </div>
      {result && (
        <p className={`mt-3 text-sm ${result.includes("mislukt") ? "text-red-600" : "text-green-700"}`}>
          {result}
        </p>
      )}
    </div>
  );
}

function ResetPanel() {
  const [poolId, setPoolId] = useState<string>("");
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleReset() {
    setDeleting(true);
    setResult(null);
    try {
      const res = await poolApi.resetLogs(poolId || undefined);
      setResult(`${res.data.deleted} metingen verwijderd.`);
      setConfirming(false);
    } catch {
      setResult("Reset mislukt.");
    }
    setDeleting(false);
  }

  return (
    <div className="bg-white rounded-2xl shadow p-5 border border-red-200">
      <h2 className="text-lg font-bold mb-3 text-red-700">Logboek resetten</h2>
      <p className="text-sm text-gray-500 mb-4">
        Verwijder alle metingen uit het logboek. Dit kan niet ongedaan gemaakt worden.
      </p>
      <div className="flex gap-3 items-end flex-wrap">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Bad</label>
          <select
            className="border rounded-lg px-3 py-2 text-sm"
            value={poolId}
            onChange={(e) => { setPoolId(e.target.value); setConfirming(false); }}
          >
            <option value="">Alle baden</option>
            <option value="wellness">Wellness</option>
            <option value="zwembad">Zwembad</option>
          </select>
        </div>
        {!confirming ? (
          <button
            onClick={() => setConfirming(true)}
            className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700"
          >
            Resetten
          </button>
        ) : (
          <div className="flex gap-2 items-center">
            <span className="text-red-600 text-sm font-medium">Weet je het zeker?</span>
            <button
              onClick={handleReset}
              disabled={deleting}
              className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700 disabled:opacity-50"
            >
              {deleting ? "Verwijderen..." : "Ja, verwijder alles"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="border px-4 py-2 rounded-lg text-sm hover:bg-gray-50"
            >
              Annuleren
            </button>
          </div>
        )}
      </div>
      {result && (
        <p className={`mt-3 text-sm ${result.includes("mislukt") ? "text-red-600" : "text-orange-600"}`}>
          {result}
        </p>
      )}
    </div>
  );
}

export default function PoolInstellingen() {
  const [configs, setConfigs] = useState<PoolConfigItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editValues, setEditValues] = useState<Record<string, Partial<PoolConfigItem>>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    poolApi.getConfigs().then((r) => {
      setConfigs(r.data);
      const vals: Record<string, Partial<PoolConfigItem>> = {};
      for (const c of r.data) {
        vals[c.pool_id] = { ...c };
      }
      setEditValues(vals);
      setLoading(false);
    });
  }, []);

  function setField(poolId: string, key: string, val: string) {
    setEditValues((v) => ({
      ...v,
      [poolId]: { ...v[poolId], [key]: val || null },
    }));
  }

  async function handleSave(poolId: string) {
    setSaving(poolId);
    setSuccess(null);
    try {
      const data = editValues[poolId];
      const res = await poolApi.updateConfig(poolId, data);
      setConfigs((prev) => prev.map((c) => (c.pool_id === poolId ? res.data : c)));
      setSuccess(poolId);
      setTimeout(() => setSuccess((s) => (s === poolId ? null : s)), 3000);
    } catch {
      // error handling
    }
    setSaving(null);
  }

  if (loading) return <p className="p-4 text-gray-400">Laden...</p>;

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">Zwembad instellingen</h1>

      <div className="space-y-6">
        {configs.map((cfg) => {
          const vals = editValues[cfg.pool_id] || {};
          const isZwembad = cfg.pool_id === "zwembad";

          return (
            <div key={cfg.pool_id} className="bg-white rounded-2xl shadow p-5">
              <h2 className="text-lg font-bold mb-4">{cfg.label}</h2>

              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Naam
                  </label>
                  <input
                    type="text"
                    className="w-full border rounded-lg px-3 py-2 text-sm"
                    value={vals.label ?? ""}
                    onChange={(e) => setField(cfg.pool_id, "label", e.target.value)}
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {isZwembad ? "NFC tag ID — filter links" : "NFC tag ID — filter"}
                  </label>
                  <input
                    type="text"
                    className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                    value={vals.filter_nfc_tag_id ?? ""}
                    placeholder="bijv. 04:A2:F3:1A:..."
                    onChange={(e) => setField(cfg.pool_id, "filter_nfc_tag_id", e.target.value)}
                  />
                </div>

                {isZwembad && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      NFC tag ID — filter rechts
                    </label>
                    <input
                      type="text"
                      className="w-full border rounded-lg px-3 py-2 text-sm font-mono"
                      value={vals.filter_nfc_tag_id_r ?? ""}
                      placeholder="bijv. 04:B7:E1:2C:..."
                      onChange={(e) => setField(cfg.pool_id, "filter_nfc_tag_id_r", e.target.value)}
                    />
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={() => handleSave(cfg.pool_id)}
                  disabled={saving === cfg.pool_id}
                  className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving === cfg.pool_id ? "Opslaan..." : "Opslaan"}
                </button>
                {success === cfg.pool_id && (
                  <span className="text-green-700 text-sm">Opgeslagen</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-8">
        <ImportPanel />
      </div>

      <div className="mt-8">
        <ResetPanel />
      </div>
    </div>
  );
}
