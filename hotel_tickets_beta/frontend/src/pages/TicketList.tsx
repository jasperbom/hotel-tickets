import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ticketApi, locationApi, userApi, type Category, type Ticket } from "../api/client";
import { WorkRow } from "../components/WorkRow";
import {
  AFDELING_LABELS, afdelingTekst, eigendom, leeftijdTekst,
  prioriteitWoord, subtaakFractie,
} from "../werk";

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

const AFDELINGEN: { value: Category | ""; label: string }[] = [
  { value: "", label: "Alle afdelingen" },
  { value: "technical", label: AFDELING_LABELS.technical },
  { value: "housekeeping", label: AFDELING_LABELS.housekeeping },
  { value: "reception", label: AFDELING_LABELS.reception },
  { value: "service", label: AFDELING_LABELS.service },
  { value: "kitchen", label: AFDELING_LABELS.kitchen },
  { value: "sales", label: AFDELING_LABELS.sales },
  { value: "garden", label: AFDELING_LABELS.garden },
];

const OPEN_STATUS = "open,in_progress";

export default function TicketList() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [users, setUsers] = useState<Record<string, string>>({});
  const [mij, setMij] = useState<{ id: string; department: Category | null }>({ id: "", department: null });
  const [loading, setLoading] = useState(true);

  // Filters. Twee statuspillen in plaats van drie: of iets nog loopt of niet
  // is de enige statusvraag die iemand stelt.
  const klaar = searchParams.get("klaar") === "1" || searchParams.get("status") === "closed";
  const afdeling = ((searchParams.get("afd") || searchParams.get("category") || "") as Category | "");
  const alleenMijne = searchParams.get("mijn") === "1" || searchParams.get("assigned") === "me";
  const kamer = searchParams.get("kamer") ?? "";
  const zoekterm = searchParams.get("q") ?? "";
  // Het invoerveld loopt vooruit op de URL: die wordt pas na de debounce gezet.
  const [zoek, setZoek] = useState(zoekterm);
  const [aantallen, setAantallen] = useState<{ open: number; klaar: number } | null>(null);
  const [afdelingOpen, setAfdelingOpen] = useState(false);
  const zoekRef = useRef<HTMLInputElement>(null);

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
      }
      if (me.status === "fulfilled") {
        setMij({ id: me.value.data.ha_user_id, department: me.value.data.department ?? null });
      }
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

  useEffect(() => {
    setLoading(true);
    ticketApi.list(params)
      .then((r) => setTickets(r.data))
      .finally(() => setLoading(false));
  }, [params]);

  // Tellers voor de twee pillen, binnen de overige filters.
  useEffect(() => {
    const p: Record<string, string> = {};
    if (afdeling) p.category = afdeling;
    if (alleenMijne) p.assigned_to = "me";
    ticketApi.counts(p)
      .then((r) => setAantallen({
        open: (r.data.open ?? 0) + (r.data.in_progress ?? 0),
        klaar: r.data.closed ?? 0,
      }))
      .catch(() => setAantallen(null));
  }, [afdeling, alleenMijne]);

  /**
   * Sortering: prioriteit eerst, gepind daarná. Voorheen won een pin van
   * urgentie, waardoor een vastgezet normaal ticket boven een urgent stond.
   */
  const gesorteerd = useMemo(() => {
    if (klaar) return tickets; // afgerond: de server sorteert op sluitingsdatum
    return [...tickets].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
  }, [tickets, klaar]);

  function kamerVan(locationId: string | null | undefined): string | undefined {
    if (!locationId) return undefined;
    return locations[locationId] ?? locationId;
  }

  /** Op Tickets staat het eigendomswoord er wél altijd: deze lijst mengt
   *  werk van iedereen. */
  function meta(t: Ticket) {
    const bezit = eigendom(t, mij.id, (id) => users[id] ?? id);
    const prio = prioriteitWoord(t.priority);
    return [
      prio && (
        <strong className={`font-semibold ${t.priority === "urgent" ? "text-urgent" : "text-high"}`}>
          {prio}
        </strong>
      ),
      bezit.label,
      afdelingTekst(t.category, mij.department),
      subtaakFractie(t),
      leeftijdTekst(t.created_at),
    ].filter(Boolean);
  }

  const zoekPlaats = afdeling
    ? AFDELING_LABELS[afdeling].toLowerCase()
    : alleenMijne ? "jouw tickets" : "alle afdelingen";

  return (
    <div className="space-y-4 max-w-3xl">
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
                    onClick={() => { zetFilter({ afd: a.value || null }); setAfdelingOpen(false); }}
                    className={`flex w-full items-center px-4 min-h-tap text-meta text-left hover:bg-ink-6 ${
                      afdeling === a.value ? "font-semibold text-ink" : "text-ink-70"
                    }`}
                  >
                    {a.label}
                    {afdeling === a.value && <span className="ml-auto text-ink-45">✓</span>}
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
          onAlleAfdelingen={() => zetFilter({ afd: null, mijn: null, kamer: null })}
          onMelden={() => navigate("/tickets/new")}
        />
      ) : (
        <>
          <p className="meta">{gesorteerd.length} {gesorteerd.length === 1 ? "ticket" : "tickets"}</p>
          <div className="grid gap-2">
            {gesorteerd.map((t) => (
              <WorkRow
                key={t.id}
                to={`/tickets/${t.id}`}
                priority={t.priority}
                kamer={kamerVan(t.location_id)}
                title={t.title}
                meta={meta(t)}
                done={t.status === "closed"}
              />
            ))}
          </div>
        </>
      )}
    </div>
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
