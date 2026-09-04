import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronRight, X } from "lucide-react";
import { locationApi, logbookApi, parseUTC, type LogObject } from "../api/client";
import { onderhoudTekst } from "../werk";

/**
 * Logboeken — het naslagscherm.
 *
 * Het werk blijft op Vandaag: niemand hoeft dit scherm dagelijks te openen,
 * de controle komt naar je toe als taak. Dit is waar je kijkt wat er met een
 * ding gebeurd is. Zelfde opbouw als Kamers: wat aandacht nodig heeft bovenaan,
 * de rest eronder — maar dan gegroepeerd in mappen, want een gereedschapskist
 * met dertig stuks hoort niet door de installaties heen te staan.
 *
 * Een object zonder eigen map valt terug op zijn type. Zo staat gereedschap
 * ook zonder inrichten al apart.
 */

const TYPE_LABELS: Record<string, string> = {
  installatie: "Installatie",
  apparaat: "Apparaat",
  gereedschap: "Gereedschap",
};

/** Groepsnaam voor de mappenweergave: eigen map, anders het type. */
const TYPE_GROEPEN: Record<string, string> = {
  installatie: "Installaties",
  apparaat: "Apparaten",
  gereedschap: "Gereedschap",
};

const INGEKLAPT_KEY = "hts.logboek_mappen_dicht";

export function mapVan(o: LogObject): string {
  const eigen = (o.folder ?? "").trim();
  return eigen || TYPE_GROEPEN[o.type] || "Overig";
}

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
  const [zoek, setZoek] = useState("");
  const [soort, setSoort] = useState<string | null>(null);
  const zoekRef = useRef<HTMLInputElement>(null);
  const [dicht, setDicht] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(INGEKLAPT_KEY) || "[]");
    } catch {
      return [];
    }
  });
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

  function klapOmVan(map: string) {
    setDicht((prev) => {
      const nieuw = prev.includes(map) ? prev.filter((m) => m !== map) : [...prev, map];
      localStorage.setItem(INGEKLAPT_KEY, JSON.stringify(nieuw));
      return nieuw;
    });
  }

  const aandacht = useMemo(() => objecten.filter((o) => o.overdue), [objecten]);

  /**
   * De soorten die er zijn, met hun aantal. Een boormachine heet in de lijst
   * vaak "Makita DHP482"; zonder soort vind je die nooit terug door op
   * "boormachine" te zoeken, en kun je ze ook niet als groep bekijken.
   */
  const soorten = useMemo(() => {
    const telling = new Map<string, number>();
    for (const o of objecten) {
      const k = (o.kind ?? "").trim();
      if (k) telling.set(k, (telling.get(k) ?? 0) + 1);
    }
    return [...telling.entries()]
      .map(([naam, aantal]) => ({ naam, aantal }))
      .sort((a, b) => b.aantal - a.aantal || a.naam.localeCompare(b.naam, "nl"));
  }, [objecten]);

  /**
   * Zoeken gaat over naam, map, serienummer en kamer. De lijst is klein genoeg
   * om in de browser te filteren — dat is meteen, zonder verzoek per toets.
   * Tijdens het zoeken vervallen de mappen: je zoekt juist omdat je niet weet
   * waar iets staat.
   */
  const gevonden = useMemo(() => {
    const q = zoek.trim().toLowerCase();
    if (!q && !soort) return null;
    return objecten
      .filter((o) => !soort || (o.kind ?? "").trim() === soort)
      .filter((o) =>
        !q ||
        [
          o.name,
          o.kind ?? "",
          o.folder ?? "",
          mapVan(o),
          o.serial ?? "",
          o.supplier ?? "",
          o.location_id ? (locaties[o.location_id] ?? o.location_id) : "",
          TYPE_LABELS[o.type] ?? "",
        ].some((veld) => veld.toLowerCase().includes(q))
      )
      .sort((a, b) => a.name.localeCompare(b.name, "nl"));
  }, [zoek, soort, objecten, locaties]);

  /** Alles per map, met de mappen alfabetisch en "Overig" achteraan. */
  const mappen = useMemo(() => {
    const groepen = new Map<string, LogObject[]>();
    for (const o of objecten) {
      const map = mapVan(o);
      const lijst = groepen.get(map) ?? [];
      lijst.push(o);
      groepen.set(map, lijst);
    }
    return [...groepen.entries()]
      .map(([map, lijst]) => ({
        map,
        lijst: lijst.sort((a, b) => a.name.localeCompare(b.name, "nl")),
        aandacht: lijst.filter((o) => o.overdue).length,
      }))
      .sort((a, b) => {
        if (a.map === "Overig") return 1;
        if (b.map === "Overig") return -1;
        return a.map.localeCompare(b.map, "nl");
      });
  }, [objecten]);

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
            leidinggevenden maken ze aan bij Instellingen → Logboeken.
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
              o.kind || (o.location_id ? (locaties[o.location_id] ?? o.location_id) : TYPE_LABELS[o.type]),
              o.kind && o.location_id ? (locaties[o.location_id] ?? o.location_id) : null,
              o.overdue ? `${o.open_tickets} open` : laatsteTekst(o),
              onderhoudTekst(o.maintenance),
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

      <div className="relative">
        <input
          ref={zoekRef}
          type="search"
          inputMode="search"
          placeholder="Zoek naam, soort, map, serienummer of leverancier"
          value={zoek}
          onChange={(e) => setZoek(e.target.value)}
          className="w-full h-tap border border-ink-12 rounded-[10px] pl-3 pr-10 text-body bg-paper-raised
                     text-ink placeholder:text-ink-45 focus:outline-none focus:ring-2 focus:ring-brand"
        />
        {zoek && (
          <button
            onClick={() => { setZoek(""); zoekRef.current?.focus(); }}
            aria-label="Zoekopdracht wissen"
            className="absolute right-1 top-1/2 -translate-y-1/2 tap text-ink-45 hover:text-ink"
          >
            <X size={18} aria-hidden="true" />
          </button>
        )}
      </div>

      {soorten.length > 1 && (
        <div className="flex gap-2 overflow-x-auto scrollbar-none -mx-4 px-4">
          {soorten.map((k) => (
            <button
              key={k.naam}
              onClick={() => setSoort(soort === k.naam ? null : k.naam)}
              aria-pressed={soort === k.naam}
              className={`chip ${soort === k.naam ? "chip-aan" : ""}`}
            >
              {k.naam} <span className="tabular-nums opacity-60">{k.aantal}</span>
            </button>
          ))}
        </div>
      )}

      {gevonden ? (
        <section>
          <p className="mb-2.5 font-mono text-xs uppercase tracking-[0.14em] text-ink-45">
            {gevonden.length} {gevonden.length === 1 ? "resultaat" : "resultaten"}
            {soort && <span className="normal-case tracking-normal font-sans"> · soort {soort}</span>}
          </p>
          {gevonden.length === 0 ? (
            <div className="rounded-[10px] border border-dashed border-ink-12 bg-paper-raised px-5 py-6">
              <p className="text-[1.1875rem] font-semibold text-ink">
                {zoek.trim() ? <>Geen object met “{zoek.trim()}”.</> : <>Geen object van dit soort.</>}
              </p>
              <p className="mt-1.5 text-[0.9375rem] text-ink-70">
                Gezocht in namen, soorten, mappen, serienummers, leveranciers en kamers van alle{" "}
                {objecten.length} objecten{soort ? ` van het soort ${soort}` : ""}.
              </p>
              {soort && (
                <button
                  onClick={() => setSoort(null)}
                  className="mt-4 h-tapLg px-4 inline-flex items-center rounded-[10px] border border-ink-12 text-ink text-meta font-semibold hover:bg-ink-6"
                >
                  Soortfilter loslaten
                </button>
              )}
            </div>
          ) : (
            <ul className="grid gap-2">{gevonden.map(regel)}</ul>
          )}
        </section>
      ) : (
      <>
      <div className="seg">
        <button
          onClick={() => setAlles(false)}
          aria-pressed={!alles}
          className={!alles ? "seg-aan" : ""}
        >
          Aandacht nodig {aandacht.length}
        </button>
        <button
          onClick={() => setAlles(true)}
          aria-pressed={alles}
          className={alles ? "seg-aan" : ""}
        >
          Alle mappen
        </button>
      </div>

      {!alles ? (
        <section>
          <p className="mb-2.5 font-mono text-xs uppercase tracking-[0.14em] text-ink-45">Aandacht nodig</p>
          {aandacht.length === 0 ? (
            <p className="meta">Niets dat aandacht nodig heeft. Kijk bij "Alle mappen" voor de boeken.</p>
          ) : (
            <ul className="grid gap-2">{aandacht.map(regel)}</ul>
          )}
        </section>
      ) : (
        <div className="space-y-5">
          {mappen.map((groep) => {
            const open = !dicht.includes(groep.map);
            return (
              <section key={groep.map}>
                <button
                  onClick={() => klapOmVan(groep.map)}
                  aria-expanded={open}
                  className="flex items-center gap-2 w-full min-h-tap text-left"
                >
                  {open ? (
                    <ChevronDown size={16} className="text-ink-45 shrink-0" aria-hidden="true" />
                  ) : (
                    <ChevronRight size={16} className="text-ink-45 shrink-0" aria-hidden="true" />
                  )}
                  <span className="font-mono text-xs uppercase tracking-[0.14em] text-ink-45">
                    {groep.map}
                  </span>
                  <span className="meta ml-auto tabular-nums">
                    {groep.aandacht > 0 && (
                      <span className="text-urgent font-semibold">{groep.aandacht} open · </span>
                    )}
                    {groep.lijst.length}
                  </span>
                </button>
                {open && <ul className="grid gap-2 mt-2">{groep.lijst.map(regel)}</ul>}
              </section>
            );
          })}
        </div>
      )}
      </>
      )}
    </div>
  );
}
