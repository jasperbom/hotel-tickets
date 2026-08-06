import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { locationApi, logbookApi, type LogObject } from "../api/client";
import { herhaalKort } from "../werk";
import { parseUTC } from "../api/client";

/**
 * Logboeken — het naslagscherm.
 *
 * Het werk blijft op Vandaag: niemand hoeft dit scherm dagelijks te openen,
 * de controle komt naar je toe als taak. Dit is waar je kijkt wat er met een
 * ding gebeurd is. Zelfde opbouw als Kamers: wat aandacht nodig heeft bovenaan,
 * de rest eronder.
 */

const TYPE_LABELS: Record<string, string> = {
  installatie: "Installatie",
  apparaat: "Apparaat",
  gereedschap: "Gereedschap",
};

export function laatsteTekst(obj: LogObject): string {
  if (!obj.last_check_at) return "nog niets vastgelegd";
  const dagen = Math.floor((Date.now() - parseUTC(obj.last_check_at).getTime()) / 86_400_000);
  if (dagen === 0) return "vandaag vastgelegd";
  if (dagen === 1) return "gisteren vastgelegd";
  if (dagen < 60) return `${dagen} dagen geleden vastgelegd`;
  return `${Math.round(dagen / 30)} maanden geleden vastgelegd`;
}

export default function Logboeken() {
  const [objecten, setObjecten] = useState<LogObject[]>([]);
  const [locaties, setLocaties] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [alles, setAlles] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    Promise.allSettled([logbookApi.listObjects(), locationApi.list()])
      .then(([objs, locs]) => {
        if (objs.status === "fulfilled") setObjecten(objs.value.data);
        if (locs.status === "fulfilled") {
          setLocaties(Object.fromEntries(locs.value.data.map((l) => [l.id, l.name])));
        }
      })
      .finally(() => setLoading(false));
  }, []);

  const { aandacht, inOrde } = useMemo(() => ({
    aandacht: objecten.filter((o) => o.overdue),
    inOrde: objecten.filter((o) => !o.overdue),
  }), [objecten]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
      </div>
    );
  }

  if (objecten.length === 0) {
    return (
      <div className="max-w-3xl space-y-4">
        <h1 className="hidden md:block text-2xl font-bold text-ink">Logboeken</h1>
        <div className="rounded-[10px] border border-dashed border-ink-12 bg-paper-raised px-5 py-6">
          <p className="text-[1.1875rem] font-semibold text-ink">Nog geen objecten.</p>
          <p className="mt-1.5 text-[0.9375rem] text-ink-70">
            Een object is een ding met een naam, een plek en een geschiedenis: de
            brandmeldcentrale, een airco, een slijptol. Begin met er één —
            leidinggevenden maken ze aan bij Instellingen.
          </p>
        </div>
      </div>
    );
  }

  const regel = (o: LogObject) => (
    <li key={o.id}>
      <button
        onClick={() => navigate(`/logboeken/${o.id}`)}
        className={`row ${o.overdue ? "row--urgent" : ""} min-h-[66px] w-full text-left hover:bg-ink-6 transition-colors`}
      >
        <span className="flex-1 min-w-0">
          <span className="block text-row text-ink">{o.name}</span>
          <span className="meta">
            {[
              o.location_id ? (locaties[o.location_id] ?? o.location_id) : TYPE_LABELS[o.type],
              o.overdue ? `${o.open_tickets} open` : laatsteTekst(o),
              herhaalKort(o.schedule ?? undefined),
            ].filter(Boolean).join(" · ")}
          </span>
        </span>
        <ChevronRight size={18} className="text-ink-25 shrink-0" aria-hidden="true" />
      </button>
    </li>
  );

  return (
    <div className="max-w-3xl space-y-6">
      <h1 className="hidden md:block text-2xl font-bold text-ink">Logboeken</h1>

      <div className="flex rounded-full border border-ink-12 bg-paper-raised overflow-hidden w-fit">
        <button
          onClick={() => setAlles(false)}
          aria-pressed={!alles}
          className={`h-tap px-4 text-meta transition-colors ${
            !alles ? "bg-ink text-paper font-semibold" : "text-ink-70 font-medium hover:bg-ink-6"
          }`}
        >
          Aandacht nodig {aandacht.length}
        </button>
        <button
          onClick={() => setAlles(true)}
          aria-pressed={alles}
          className={`h-tap px-4 text-meta transition-colors ${
            alles ? "bg-ink text-paper font-semibold" : "text-ink-70 font-medium hover:bg-ink-6"
          }`}
        >
          Alles
        </button>
      </div>

      {aandacht.length > 0 && (
        <section>
          <p className="mb-2.5 font-mono text-xs uppercase tracking-[0.14em] text-ink-45">Aandacht nodig</p>
          <ul className="grid gap-2">{aandacht.map(regel)}</ul>
        </section>
      )}

      {(alles || aandacht.length === 0) && (
        <section>
          <p className="mb-2.5 font-mono text-xs uppercase tracking-[0.14em] text-ink-45">In orde</p>
          {inOrde.length === 0 ? (
            <p className="meta">Alles heeft nu aandacht nodig.</p>
          ) : (
            <ul className="grid gap-2">{inOrde.map(regel)}</ul>
          )}
        </section>
      )}
    </div>
  );
}
