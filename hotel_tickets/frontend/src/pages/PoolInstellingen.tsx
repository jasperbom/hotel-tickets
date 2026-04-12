import { useEffect, useState } from "react";
import { poolApi, type PoolConfigItem } from "../api/client";

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
    </div>
  );
}
