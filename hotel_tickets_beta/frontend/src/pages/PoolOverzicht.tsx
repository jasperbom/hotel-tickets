import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  poolApi,
  formatDateNL,
  type PoolId,
  type PoolIncident,
  type PoolLog,
  type PoolStatus,
} from "../api/client";
import { PoolValueVisualization, valueClass } from "../components/PoolValueVisualization";

function StatusCard({ pool, logs }: { pool: PoolStatus; logs: PoolLog[] }) {
  const navigate = useNavigate();
  const l = pool.latest;

  return (
    <div
      className="bg-paper-raised rounded-2xl shadow p-5 cursor-pointer hover:shadow-lg transition-shadow"
      onClick={() => navigate(`/pools/logboek?pool=${pool.pool_id}`)}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">{pool.label}</h2>
        <span
          className={`px-3 py-1 rounded-full text-sm font-semibold ${
            pool.compliant
              ? "bg-green-100 text-green-800"
              : "bg-red-100 text-red-800"
          }`}
        >
          {pool.measurements_today}/2 metingen
        </span>
      </div>

      {l ? (
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <span className="text-ink-45 block">Datum</span>
            <span className="font-medium">{formatDateNL(l.datum)} {l.tijd}</span>
          </div>
          <div>
            <span className="text-ink-45 block">Water temp</span>
            <span className="font-medium">{l.water_temp ?? "-"} °C</span>
          </div>
          <div>
            <span className="text-ink-45 block">Doorzicht</span>
            <span className="font-medium">{l.doorzicht ?? "-"}</span>
          </div>
          <div>
            <span className="text-ink-45 block">pH</span>
            <span className={`font-medium ${valueClass("ph", l.ph)}`}>{l.ph ?? "-"}</span>
          </div>
          <div>
            <span className="text-ink-45 block">VBC in</span>
            <span className={`font-medium ${valueClass("vbc_in", l.vbc_in)}`}>{l.vbc_in ?? "-"}</span>
          </div>
          <div>
            <span className="text-ink-45 block">VBC uit</span>
            <span className={`font-medium ${valueClass("vbc_uit", l.vbc_uit)}`}>{l.vbc_uit ?? "-"}</span>
          </div>
          <div>
            <span className="text-ink-45 block">GBC</span>
            <span className={`font-medium ${valueClass("gbc", l.gbc)}`}>{l.gbc ?? "-"}</span>
          </div>
          <div>
            <span className="text-ink-45 block">Flow</span>
            <span className="font-medium">{l.flow ?? "-"}</span>
          </div>
          <div>
            <span className="text-ink-45 block">Gemeten door</span>
            <span className="font-medium">{l.gemeten_door}</span>
          </div>
        </div>
      ) : (
        <p className="text-ink-45 italic">Nog geen metingen</p>
      )}

      {/* Chemicaliën: wanneer voor het laatst vervangen/bijgevuld */}
      <div className="mt-4 pt-3 border-t border-ink-6">
        <p className="text-xs font-semibold text-ink-45 uppercase tracking-wide mb-2">
          🧪 Chemicaliën laatst vervangen
        </p>
        <div className="grid grid-cols-3 gap-3 text-sm">
          {([["chloor", "Chloor"], ["zuur", "Zuur"], ["vlokmiddel", "Vlokmiddel"]] as const).map(([key, label]) => {
            const c = pool.chemicalien_vervangen?.[key];
            return (
              <div key={key}>
                <span className="text-ink-45 block">{label}</span>
                {c ? (
                  <>
                    <span className="font-medium">{formatDateNL(c.datum)}</span>
                    {c.door && <span className="block text-xs text-ink-45 truncate">{c.door}</span>}
                  </>
                ) : (
                  <span className="text-ink-45">—</span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Grafische weergave t.o.v. streefbereik */}
      <PoolValueVisualization logs={logs} />

      {/* Nieuwe meting knop */}
      <div className="mt-4 pt-3 border-t border-ink-6">
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/pools/nieuw?pool=${pool.pool_id}`);
          }}
          className="w-full bg-brand text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-colors"
        >
          + Nieuwe meting
        </button>
      </div>
    </div>
  );
}

const VOORVAL_INFO = `Voorbeeld ongewone voorvallen

Voorbeelden van ongewone voorvallen bij het gelegenheid bieden tot zwemmen of baden zijn verdrinking, of het in of rondom het badwaterbassin oplopen van ernstig letsel.

Voorbeeld niet-ongewoon voorval

Voorbeelden van een incident dat niet een ongewoon voorval is, is het oplopen van matig letsel zoals:
 • een oppervlakkige schaafwond
 • een tand door de lip

Het gaat hier namelijk niet om significante gevolgen. Over deze incidenten hoeft het bevoegd gezag niet onverwijld geïnformeerd te worden, maar deze moeten wel worden geregistreerd in het logboek.`;

function IncidentSection({ pools }: { pools: PoolStatus[] }) {
  const now = new Date();
  const [poolId, setPoolId] = useState<PoolId>((pools[0]?.pool_id as PoolId) ?? "wellness");
  const [datum, setDatum] = useState(now.toISOString().slice(0, 10));
  const [tijd, setTijd] = useState(now.toTimeString().slice(0, 5));
  const [beschrijving, setBeschrijving] = useState("");
  const [maatregelen, setMaatregelen] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [showInfo, setShowInfo] = useState(false);
  const [incidents, setIncidents] = useState<PoolIncident[]>([]);

  function loadIncidents() {
    poolApi.listIncidents({ limit: "10" }).then((r) => setIncidents(r.data)).catch(() => {});
  }

  useEffect(() => {
    loadIncidents();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!beschrijving.trim()) {
      setError("Beschrijf het voorval");
      return;
    }
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      await poolApi.createIncident({
        pool_id: poolId,
        datum,
        tijd,
        beschrijving: beschrijving.trim(),
        maatregelen: maatregelen.trim() || null,
      });
      setBeschrijving("");
      setMaatregelen("");
      setSuccess("Voorval geregistreerd — admins zijn genotificeerd");
      loadIncidents();
    } catch {
      setError("Registreren mislukt");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-paper-raised rounded-2xl shadow p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            ⚠️ Ongewoon voorval registreren
          </h2>
          <p className="text-sm text-ink-45 mt-1">
            Leg verdrinkingen of ernstig letsel vast. Admins krijgen direct een
            notificatie.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowInfo((s) => !s)}
          className="shrink-0 inline-flex items-center justify-center w-6 h-6 rounded-full bg-ink-6 text-brand text-xs font-bold hover:bg-blue-200"
          aria-label="Informatie over ongewone voorvallen"
          title="Wat is een ongewoon voorval?"
        >
          i
        </button>
      </div>

      {showInfo && (
        <div className="bg-ink-6 border border-ink-12 rounded-xl p-4 text-sm text-ink-70 whitespace-pre-line">
          {VOORVAL_INFO}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-ink-70 mb-1">Bad</label>
          <div className="grid grid-cols-2 gap-2">
            {pools.map((p) => (
              <button
                key={p.pool_id}
                type="button"
                onClick={() => setPoolId(p.pool_id as PoolId)}
                className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
                  poolId === p.pool_id
                    ? "bg-brand text-white border-brand"
                    : "bg-paper-raised text-ink-70 border-ink-12 hover:bg-ink-6"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs font-medium text-ink-70 mb-0.5">Datum</label>
            <input
              type="date"
              className="w-full border rounded-lg px-2 py-1.5 text-sm"
              value={datum}
              onChange={(e) => setDatum(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink-70 mb-0.5">Tijd</label>
            <input
              type="time"
              className="w-full border rounded-lg px-2 py-1.5 text-sm"
              value={tijd}
              onChange={(e) => setTijd(e.target.value)}
              required
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-ink-70 mb-0.5">
            Beschrijving van het voorval *
          </label>
          <textarea
            className="w-full border rounded-lg px-2 py-1.5 text-sm min-h-[80px]"
            value={beschrijving}
            onChange={(e) => setBeschrijving(e.target.value)}
            placeholder="Wat is er gebeurd? Wie is betrokken? Welk letsel?"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-ink-70 mb-0.5">
            Genomen maatregelen
          </label>
          <textarea
            className="w-full border rounded-lg px-2 py-1.5 text-sm min-h-[60px]"
            value={maatregelen}
            onChange={(e) => setMaatregelen(e.target.value)}
            placeholder="Welke actie is ondernomen? (optioneel)"
          />
        </div>

        {error && <p className="text-red-600 text-sm">{error}</p>}
        {success && <p className="text-green-700 text-sm">{success}</p>}

        <button
          type="submit"
          disabled={saving}
          className="bg-red-600 text-white px-6 py-2 rounded-lg hover:bg-red-700 disabled:opacity-50"
        >
          {saving ? "Verzenden..." : "Registreren & admins melden"}
        </button>
      </form>

      {incidents.length > 0 && (
        <div className="pt-3 border-t border-ink-6">
          <h3 className="text-sm font-semibold text-ink-70 mb-2">
            Logboek ongewone voorvallen
          </h3>
          <ul className="divide-y divide-ink-6">
            {incidents.map((i) => (
              <li key={i.id} className="py-2 text-sm">
                <div className="flex justify-between items-start gap-2">
                  <span className="font-medium capitalize">{i.pool_id}</span>
                  <span className="text-xs text-ink-45 shrink-0">
                    {formatDateNL(i.datum)} {i.tijd}
                  </span>
                </div>
                <p className="text-ink-70 whitespace-pre-line">{i.beschrijving}</p>
                {i.maatregelen && (
                  <p className="text-ink-45 text-xs mt-1">
                    <span className="font-medium">Maatregelen:</span> {i.maatregelen}
                  </p>
                )}
                <p className="text-xs text-ink-45 mt-1">Gemeld door {i.gemeld_door}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function PoolOverzicht() {
  const [status, setStatus] = useState<PoolStatus[]>([]);
  const [logsByPool, setLogsByPool] = useState<Record<string, PoolLog[]>>({});
  const [loading, setLoading] = useState(true);

  async function loadAll() {
    const statusRes = await poolApi.status();
    const pools = statusRes.data;
    setStatus(pools);

    // 14 dagen terug — gebruik bestaande datum_van filter
    const sinds = new Date();
    sinds.setDate(sinds.getDate() - 14);
    const datumVan = sinds.toISOString().slice(0, 10);

    const entries = await Promise.all(
      pools.map(async (p) => {
        const r = await poolApi.list({ pool_id: p.pool_id, datum_van: datumVan, limit: "100", only_measurements: "true" });
        return [p.pool_id, r.data] as const;
      }),
    );
    setLogsByPool(Object.fromEntries(entries));
    setLoading(false);
  }

  useEffect(() => {
    loadAll().catch(() => setLoading(false));
  }, []);

  if (loading) return <p className="p-4 text-ink-45">Laden...</p>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Zwembaden overzicht</h1>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {status.map((p) => (
          <StatusCard key={p.pool_id} pool={p} logs={logsByPool[p.pool_id] ?? []} />
        ))}
      </div>

      <IncidentSection pools={status} />
    </div>
  );
}
