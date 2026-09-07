import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { poolApi, type PoolId, type PoolLog } from "../api/client";
import { PoolGrafieken } from "../components/PoolGrafieken";
import { PeriodeFilters, PeriodeKop, apiParams, laadAlleLogs, usePoolPeriode } from "../components/PoolPeriode";

/**
 * Inzicht (zwembaden): kerncijfers en grafieken over een periode. Het logboek
 * zelf blijft een tabel; deze pagina leest dezelfde regels en laat zien wat
 * er in de cijfers zit. De periodekeuze is gedeeld met het logboek.
 */
export default function PoolInzicht() {
  const navigate = useNavigate();
  const p = usePoolPeriode();
  const [logs, setLogs] = useState<PoolLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetching, setFetching] = useState(false);
  // Per bad de datum van de allereerste meting: daarvóór werd er nog niet
  // gemeten, dus die dagen tellen niet als "gemist".
  const [eersteMeting, setEersteMeting] = useState<Partial<Record<PoolId, string | null>>>({});

  useEffect(() => {
    poolApi
      .status()
      .then((r) => {
        const map: Partial<Record<PoolId, string | null>> = {};
        for (const s of r.data) map[s.pool_id as PoolId] = s.first_measurement ?? null;
        setEersteMeting(map);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let actueel = true;
    setFetching(true);
    laadAlleLogs(apiParams(p, { only_measurements: "true" }))
      .then((alles) => {
        if (actueel) setLogs(alles);
      })
      .finally(() => {
        if (!actueel) return;
        setLoading(false);
        setFetching(false);
      });
    return () => {
      actueel = false;
    };
  }, [p.pool, p.bereik.van, p.bereik.tot]);

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold">Inzicht</h1>
          <PeriodeKop p={p} />
        </div>
        <button
          onClick={() => navigate(`/pools/logboek${p.query}`)}
          className="bg-paper-raised border border-ink-12 text-ink-70 px-4 py-2 rounded-lg text-sm hover:bg-ink-6 shrink-0"
        >
          Naar logboek
        </button>
      </div>

      <PeriodeFilters p={p} />

      {loading ? (
        <p className="text-ink-45">Laden...</p>
      ) : (
        <PoolGrafieken
          logs={logs}
          pool={p.pool}
          datumVan={p.bereik.van}
          datumTot={p.bereik.tot}
          eersteMeting={eersteMeting}
          laden={fetching}
        />
      )}
    </div>
  );
}
