import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ticketApi, locationApi, userApi, type Category, type Priority, type Ticket, type UserRole } from "../api/client";
import TicketDetail from "./TicketDetail";
import { WorkRow } from "../components/WorkRow";
import { AFDELING_LABELS } from "../werk";
import { werkMeta } from "../components/werkMeta";

/**
 * Tickets — de lijst met filters.
 *
 * Dit scherm heeft één taak: iets terugvinden dat niet op Vandaag staat.
 * Daarom staat het zoekveld bovenaan en altijd zichtbaar (nooit achter een
 * knop "Filters"), en zijn er drie filters in plaats van negen. Zoeken gaat
 * naar de server, zodat een ticket dat buiten de eerste 100 valt óók gevonden
 * wordt — de oude lijst filterde alleen wat toevallig binnen was.
 *
 * Prioriteit als filter is geschrapt: de lijst staat al op urgentie
 * gesorteerd, dus filteren voegt niets toe.
 */

/** "all" is een echte keuze, geen lege waarde: zonder parameter val je terug
 *  op je eigen afdeling, en dan moet "alles" ook expliciet in de URL staan. */
const AFDELINGEN: { value: Category | "all"; label: string }[] = [
  { value: "all", label: "Alle afdelingen" },
  { value: "technical", label: AFDELING_LABELS.technical },
  { value: "housekeeping", label: AFDELING_LABELS.housekeeping },
  { value: "reception", label: AFDELING_LABELS.reception },
  { value: "service", label: AFDELING_LABELS.service },
  { value: "kitchen", label: AFDELING_LABELS.kitchen },
  { value: "sales", label: AFDELING_LABELS.sales },
  { value: "garden", label: AFDELING_LABELS.garden },
];

const OPEN_STATUS = "open,in_progress";

const BULK_PRIORITEITEN: { value: Priority; label: string }[] = [
  { value: "urgent", label: "Urgent" },
  { value: "high", label: "Hoog" },
  { value: "medium", label: "Normaal" },
  { value: "low", label: "Laag" },
];

/** Twee kolommen vanaf 1280 px — daaronder is er simpelweg geen ruimte voor. */
function useBreedScherm(): boolean {
  const [breed, setBreed] = useState(() => window.matchMedia("(min-width: 1280px)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)");
    const bij = (e: MediaQueryListEvent) => setBreed(e.matches);
    mq.addEventListener("change", bij);
    return () => mq.removeEventListener("change", bij);
  }, []);
  return breed;
}

export default function TicketList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [users, setUsers] = useState<Record<string, string>>({});
  const [mij, setMij] = useState<{ id: string; department: Category | null }>({ id: "", department: null });
  // Pas laden als we weten bij welke afdeling je hoort — anders zie je eerst
  // een tel lang alle afdelingen voorbijkomen.
  const [mijGeladen, setMijGeladen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Filters. Twee statuspillen in plaats van drie: of iets nog loopt of niet
  // is de enige statusvraag die iemand stelt.
  const klaar = searchParams.get("klaar") === "1" || searchParams.get("status") === "closed";
  // Zonder afdeling in de URL kijk je naar je eigen afdeling — net als op
  // Vandaag. "all" is de expliciete keuze om over de schutting te kijken.
  const afdelingParam = searchParams.get("afd") || searchParams.get("category") || "";
  const afdeling: Category | "" =
    afdelingParam === "all" ? "" : ((afdelingParam || mij.department || "") as Category | "");
  const alleenMijne = searchParams.get("mijn") === "1" || searchParams.get("assigned") === "me";
  const kamer = searchParams.get("kamer") ?? "";
  const zoekterm = searchParams.get("q") ?? "";
  // Het invoerveld loopt vooruit op de URL: die wordt pas na de debounce gezet.
  const [zoek, setZoek] = useState(zoekterm);
  const [aantallen, setAantallen] = useState<{ open: number; klaar: number } | null>(null);
  const [afdelingOpen, setAfdelingOpen] = useState(false);
  const [alleUsers, setAlleUsers] = useState<UserRole[]>([]);
  const zoekRef = useRef<HTMLInputElement>(null);

  // Master-detail en bulkacties bestaan alleen op desktop: op een telefoon zou
  // een selectiemodus botsen met tikken-om-te-openen.
  const breed = useBreedScherm();
  const geopend = searchParams.get("open");
  const [selectie, setSelectie] = useState<string[]>([]);
  const [laatsteIndex, setLaatsteIndex] = useState<number | null>(null);
  const [bulkBezig, setBulkBezig] = useState(false);
  const [bulkMenu, setBulkMenu] = useState<"prio" | "wie" | null>(null);

  /**
   * Al het filterstate staat in de URL: een gefilterde lijst is daarmee te
   * delen, te bookmarken en overleeft de terugknop. De chips op Vandaag en de
   * rijen op Kamers wijzen naar dezelfde parameters.
   */
  const zetFilter = useCallback((wijziging: Record<string, string | null>) => {
    setSearchParams((huidig) => {
      const nieuw = new URLSearchParams(huidig);
      // Oude parameternamen opruimen zodra we zelf iets zetten
      ["status", "category", "assigned", "priority"].forEach((k) => nieuw.delete(k));
      for (const [sleutel, waarde] of Object.entries(wijziging)) {
        if (waarde === null || waarde === "") nieuw.delete(sleutel);
        else nieuw.set(sleutel, waarde);
      }
      return nieuw;
    }, { replace: true });
  }, [setSearchParams]);

  // Zoeken gaat naar de server; 250 ms wachten voorkomt een verzoek per toets.
  useEffect(() => {
    const id = window.setTimeout(() => {
      if (zoek.trim() !== zoekterm) zetFilter({ q: zoek.trim() || null });
    }, 250);
    return () => window.clearTimeout(id);
  }, [zoek, zoekterm, zetFilter]);

  // Los van elkaar: hapert de kamerlijst (die komt uit Home Assistant), dan
  // hoort de lijst nog steeds "Van mij" te tonen in plaats van een user-id.
  useEffect(() => {
    Promise.allSettled([locationApi.list(), userApi.list(), userApi.me()]).then(([locs, usrs, me]) => {
      if (locs.status === "fulfilled") {
        setLocations(Object.fromEntries(locs.value.data.map((l) => [l.id, l.name])));
      }
      if (usrs.status === "fulfilled") {
        setUsers(Object.fromEntries(usrs.value.data.map((u) => [u.ha_user_id, u.display_name])));
        setAlleUsers(usrs.value.data);
      }
      if (me.status === "fulfilled") {
        setMij({ id: me.value.data.ha_user_id, department: me.value.data.department ?? null });
      }
      setMijGeladen(true);
    });
  }, []);

  const params = useMemo(() => {
    const p: Record<string, string> = { status: klaar ? "closed" : OPEN_STATUS };
    if (afdeling) p.category = afdeling;
    if (alleenMijne) p.assigned_to = "me";
    if (kamer) p.location_id = kamer;
    if (zoekterm) p.q = zoekterm;
    return p;
  }, [klaar, afdeling, alleenMijne, kamer, zoekterm]);

  const herlaad = useCallback(() => {
    if (!mijGeladen) return Promise.resolve();
    setLoading(true);
    return ticketApi.list(params)
      .then((r) => setTickets(r.data))
      .finally(() => setLoading(false));
  }, [params, mijGeladen]);

  useEffect(() => { herlaad(); }, [herlaad]);

  // Tellers voor de twee pillen, binnen de overige filters.
  const herlaadTellers = useCallback(() => {
    const p: Record<string, string> = {};
    if (afdeling) p.category = afdeling;
    if (alleenMijne) p.assigned_to = "me";
    return ticketApi.counts(p)
      .then((r) => setAantallen({
        open: (r.data.open ?? 0) + (r.data.in_progress ?? 0),
        klaar: r.data.closed ?? 0,
      }))
      .catch(() => setAantallen(null));
  }, [afdeling, alleenMijne]);

  useEffect(() => { herlaadTellers(); }, [herlaadTellers]);

  /**
   * Het detail ernaast wijzigt hetzelfde ticket dat links in de lijst staat.
   * Zonder dit bleef die rij staan zoals hij was: afronden in de rechterkolom
   * en de lijst toonde het ticket nog gewoon als open.
   */
  const naWijziging = useCallback(async () => {
    const verse = await ticketApi.list(params).then((r) => r.data).catch(() => null);
    if (verse) setTickets(verse);
    herlaadTellers();
    // Verwijderd ticket: de rechterkolom wijst dan naar iets dat niet meer
    // bestaat. Alleen sluiten als het echt weg is — een ticket dat door een
    // filter uit de lijst valt (afgerond bij "Open") blijft gewoon open staan,
    // zodat je nog kunt heropenen.
    const open = searchParams.get("open");
    if (open && verse && !verse.some((t) => t.id === open)) {
      ticketApi.get(open).catch(() => zetFilter({ open: null }));
    }
  }, [params, herlaadTellers, searchParams, zetFilter]);

  /**
   * Sortering: prioriteit eerst, gepind daarná. Voorheen won een pin van
   * urgentie, waardoor een vastgezet normaal ticket boven een urgent stond.
   */
  const gesorteerd = useMemo(() => {
    if (klaar) return tickets; // afgerond: de server sorteert op sluitingsdatum
    return [...tickets].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  }, [tickets, klaar]);

  // Pijltjes omhoog/omlaag lopen door de lijst zonder terug te navigeren.
  useEffect(() => {
    if (!breed || !geopend) return;
    function bijToets(e: KeyboardEvent) {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const doel = e.target as HTMLElement;
      if (doel && ["INPUT", "TEXTAREA", "SELECT"].includes(doel.tagName)) return;
      const i = gesorteerd.findIndex((t) => t.id === geopend);
      if (i < 0) return;
      const volgende = e.key === "ArrowDown" ? gesorteerd[i + 1] : gesorteerd[i - 1];
      if (!volgende) return;
      e.preventDefault();
      zetFilter({ open: volgende.id });
    }
    window.addEventListener("keydown", bijToets);
    return () => window.removeEventListener("keydown", bijToets);
  }, [breed, geopend, gesorteerd, zetFilter]);

  function kamerVan(locationId: string | null | undefined): string | undefined {
    if (!locationId) return undefined;
    return locations[locationId] ?? locationId;
  }

  /** Op Tickets staat het eigendomswoord er wél altijd: deze lijst mengt
   *  werk van iedereen. */
  function meta(t: Ticket) {
    return werkMeta(t, {
      mij: mij.id,
      naamVan: (id) => users[id] ?? id,
      eigenAfdeling: mij.department,
    });
  }

  /** Shift-klik selecteert een reeks; gewone klik opent ernaast. */
  function rijKlik(e: React.MouseEvent, t: Ticket, index: number) {
    if (!breed) return;
    if (e.shiftKey && laatsteIndex !== null) {
      const [van, tot] = laatsteIndex < index ? [laatsteIndex, index] : [index, laatsteIndex];
      setSelectie(gesorteerd.slice(van, tot + 1).map((x) => x.id));
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      setSelectie((prev) => prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id]);
      setLaatsteIndex(index);
      return;
    }
    setSelectie([]);
    setLaatsteIndex(index);
    zetFilter({ open: t.id });
  }

  async function bulk(wijziging: Partial<Ticket>) {
    setBulkBezig(true);
    try {
      for (const id of selectie) {
        await ticketApi.update(id, wijziging).catch(() => {});
      }
      setSelectie([]);
      setBulkMenu(null);
      await herlaad();
    } finally {
      setBulkBezig(false);
    }
  }

  const zoekPlaats = afdeling
    ? AFDELING_LABELS[afdeling].toLowerCase()
    : alleenMijne ? "jouw tickets" : "alle afdelingen";

  return (
    <div className="space-y-4 xl:max-w-none max-w-3xl">
      {/* Op mobiel staat de titel al in de topbalk */}
      <h1 className="hidden md:block text-2xl font-bold text-ink">Tickets</h1>

      {/* Zoekveld + filters: altijd zichtbaar, alles 44 px */}
      <div className="sticky top-11 md:top-0 z-30 -mx-4 px-4 py-3 bg-paper/95 backdrop-blur border-b border-ink-12 space-y-2">
        <div className="relative">
          <input
            ref={zoekRef}
            type="search"
            inputMode="search"
            placeholder="Zoek kamer of titel"
            value={zoek}
            onChange={(e) => setZoek(e.target.value)}
            className="w-full h-tap border border-ink-12 rounded-[10px] pl-3 pr-9 text-body bg-paper-raised
                       text-ink placeholder:text-ink-45 focus:outline-none focus:ring-2 focus:ring-brand"
          />
          {zoek && (
            <button
              onClick={() => { setZoek(""); zetFilter({ q: null }); zoekRef.current?.focus(); }}
              aria-label="Zoekopdracht wissen"
              className="absolute right-1 top-1/2 -translate-y-1/2 tap text-ink-45 hover:text-ink"
            >
              ×
            </button>
          )}
        </div>

        <div className="flex gap-2 flex-wrap">
          <div className="flex rounded-full border border-ink-12 bg-paper-raised overflow-hidden">
            <SegmentKnop actief={!klaar} onClick={() => zetFilter({ klaar: null })}>
              Te doen{aantallen ? ` ${aantallen.open}` : ""}
            </SegmentKnop>
            <SegmentKnop actief={klaar} onClick={() => zetFilter({ klaar: "1" })}>
              Klaar
            </SegmentKnop>
          </div>
          <Chip actief={alleenMijne} onClick={() => zetFilter({ mijn: alleenMijne ? null : "1" })}>
            Alleen mijne
          </Chip>
          <div className="relative">
            <Chip actief={!!afdeling} onClick={() => setAfdelingOpen(!afdelingOpen)}>
              {afdeling ? AFDELING_LABELS[afdeling] : "Afdeling"} ∨
            </Chip>
            {afdelingOpen && (
              <div className="absolute left-0 top-full mt-1 z-40 w-56 rounded-xl border border-ink-12 bg-paper-raised shadow-lg py-1">
                {AFDELINGEN.map((a) => (
                  <button
                    key={a.value}
                    onClick={() => { zetFilter({ afd: a.value }); setAfdelingOpen(false); }}
                    className={`flex w-full items-center px-4 min-h-tap text-meta text-left hover:bg-ink-6 ${
                      (afdeling || "all") === a.value ? "font-semibold text-ink" : "text-ink-70"
                    }`}
                  >
                    {a.label}
                    {(afdeling || "all") === a.value && <span className="ml-auto text-ink-45">✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-40">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
        </div>
      ) : gesorteerd.length === 0 ? (
        <LegeStaat
          zoekterm={zoekterm}
          plaats={zoekPlaats}
          klaar={klaar}
          afdeling={afdeling}
          onOokAfgerond={() => zetFilter({ klaar: "1" })}
          onAlleAfdelingen={() => zetFilter({ afd: "all", mijn: null, kamer: null })}
          onMelden={() => navigate("/tickets/new")}
        />
      ) : (
        <>
          {/* Bulkacties: alléén hier. Op een telefoon zou een selectiemodus
              botsen met tikken-om-te-openen. */}
          {breed && selectie.length > 0 ? (
            <div className="sticky top-[6.5rem] z-30 flex items-center gap-2 flex-wrap rounded-[10px] bg-ink px-3 py-2 text-paper">
              <span className="text-meta font-semibold">{selectie.length} geselecteerd</span>
              <div className="relative">
                <BulkKnop onClick={() => setBulkMenu(bulkMenu === "wie" ? null : "wie")}>Toewijzen</BulkKnop>
                {bulkMenu === "wie" && (
                  <div className="absolute left-0 top-full mt-1 z-40 w-56 max-h-72 overflow-auto rounded-xl border border-ink-12 bg-paper-raised shadow-lg py-1">
                    <button
                      onClick={() => bulk({ assigned_to: null })}
                      className="flex w-full items-center px-4 min-h-tap text-meta text-left text-ink-70 hover:bg-ink-6"
                    >
                      Niemand
                    </button>
                    {alleUsers.map((u) => (
                      <button
                        key={u.ha_user_id}
                        onClick={() => bulk({ assigned_to: u.ha_user_id })}
                        className="flex w-full items-center px-4 min-h-tap text-meta text-left text-ink-70 hover:bg-ink-6"
                      >
                        {u.display_name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="relative">
                <BulkKnop onClick={() => setBulkMenu(bulkMenu === "prio" ? null : "prio")}>Prioriteit</BulkKnop>
                {bulkMenu === "prio" && (
                  <div className="absolute left-0 top-full mt-1 z-40 w-44 rounded-xl border border-ink-12 bg-paper-raised shadow-lg py-1">
                    {BULK_PRIORITEITEN.map((o) => (
                      <button
                        key={o.value}
                        onClick={() => bulk({ priority: o.value })}
                        className="flex w-full items-center px-4 min-h-tap text-meta text-left text-ink-70 hover:bg-ink-6"
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <BulkKnop onClick={() => bulk({ status: "closed" })} disabled={bulkBezig}>
                Afronden
              </BulkKnop>
              <button
                onClick={() => { setSelectie([]); setBulkMenu(null); }}
                className="ml-auto tap px-2 text-meta text-paper/70 hover:text-paper"
              >
                Wissen
              </button>
            </div>
          ) : (
            <p className="meta">
              {gesorteerd.length} {gesorteerd.length === 1 ? "ticket" : "tickets"}
              {breed && <span className="text-ink-25"> · klik om te openen, shift-klik voor een reeks</span>}
            </p>
          )}

          <div className={breed ? "grid grid-cols-[minmax(0,26rem)_minmax(0,1fr)] gap-5 items-start" : ""}>
            {/* select-none: shift-klik zou anders de tekst van de rijen selecteren */}
            <div className={`grid gap-2 content-start ${breed ? "select-none" : ""}`}>
              {gesorteerd.map((t, i) =>
                breed ? (
                  <WorkRow
                    key={t.id}
                    onOpen={(e) => rijKlik(e, t, i)}
                    geselecteerd={selectie.includes(t.id) || geopend === t.id}
                    priority={t.priority}
                    kamer={kamerVan(t.location_id)}
                    title={t.title}
                    meta={meta(t)}
                    done={t.status === "closed"}
                  />
                ) : (
                  <WorkRow
                    key={t.id}
                    to={`/tickets/${t.id}`}
                    priority={t.priority}
                    kamer={kamerVan(t.location_id)}
                    title={t.title}
                    meta={meta(t)}
                    done={t.status === "closed"}
                  />
                )
              )}
            </div>

            {/* Rechterkolom: hetzelfde detailcomponent, zonder terugnavigatie */}
            {breed && (
              <div className="sticky top-4 max-h-[calc(100dvh-2rem)] overflow-auto rounded-[10px] border border-ink-12 bg-paper-raised px-4 py-4">
                {geopend ? (
                  <TicketDetail key={geopend} ticketId={geopend} ingebed onGewijzigd={naWijziging} />
                ) : (
                  <p className="meta py-8 text-center">Kies links een ticket.</p>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function BulkKnop({
  children, onClick, disabled,
}: { children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="h-9 px-3 rounded-[8px] border border-paper/40 text-meta font-semibold hover:bg-paper/10 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function SegmentKnop({ actief, onClick, children }: { actief: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={actief}
      className={`h-tap px-4 text-meta transition-colors ${
        actief ? "bg-ink text-paper font-semibold" : "text-ink-70 font-medium hover:bg-ink-6"
      }`}
    >
      {children}
    </button>
  );
}

function Chip({ actief, onClick, children }: { actief: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={actief}
      className={`tap px-3.5 rounded-full text-meta transition-colors ${
        actief
          ? "bg-ink text-paper font-semibold"
          : "bg-paper-raised border border-ink-12 text-ink-70 font-medium hover:bg-ink-6"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * De lege staat doet drie dingen: zeggen waar gezocht is, de twee manieren om
 * de zoekopdracht te verbreden als knoppen aanbieden, en pas daaronder de
 * uitwegen — melden, of het de kennisbot vragen. Dat laatste is een betere
 * plek voor de bot dan een zwevend wolkje op elk scherm: hier is de vraag net
 * ontstaan.
 */
function LegeStaat({
  zoekterm, plaats, klaar, afdeling, onOokAfgerond, onAlleAfdelingen, onMelden,
}: {
  zoekterm: string;
  plaats: string;
  klaar: boolean;
  afdeling: Category | "";
  onOokAfgerond: () => void;
  onAlleAfdelingen: () => void;
  onMelden: () => void;
}) {
  return (
    <div className="rounded-[10px] border border-dashed border-ink-12 bg-paper-raised px-5 py-6">
      <p className="text-[1.1875rem] font-semibold leading-snug text-ink">
        {zoekterm ? <>Geen ticket met “{zoekterm}”.</> : "Geen tickets."}
      </p>
      <p className="mt-1.5 text-[0.9375rem] text-ink-70">
        Gezocht in {klaar ? "afgeronde" : "alle open"} tickets van {plaats}.
      </p>

      <div className="mt-4 grid gap-2 sm:flex sm:flex-wrap">
        {!klaar && (
          <button
            onClick={onOokAfgerond}
            className="h-tapLg px-4 inline-flex items-center justify-center rounded-[10px] border border-ink-12 text-ink text-meta font-semibold hover:bg-ink-6"
          >
            Ook in afgeronde tickets zoeken
          </button>
        )}
        {afdeling && (
          <button
            onClick={onAlleAfdelingen}
            className="h-tapLg px-4 inline-flex items-center justify-center rounded-[10px] border border-ink-12 text-ink text-meta font-semibold hover:bg-ink-6"
          >
            Alle afdelingen meenemen
          </button>
        )}
      </div>

      <p className="mt-5 text-meta text-ink-45">Weet je niet of het gemeld is, of hoe het werkt?</p>
      <div className="mt-2 grid gap-2 sm:flex sm:flex-wrap">
        <button
          onClick={onMelden}
          className="h-tapLg px-4 inline-flex items-center justify-center rounded-[10px] bg-ink text-paper text-meta font-semibold hover:bg-ink-70"
        >
          Nieuw ticket melden
        </button>
        <Link
          to="/kennis"
          className="h-tapLg px-4 inline-flex items-center justify-center rounded-[10px] border border-ink-12 text-ink text-meta font-semibold hover:bg-ink-6"
        >
          Vraag het de kennisbot
        </Link>
      </div>
    </div>
  );
}
