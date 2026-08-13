import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api, {
  ticketApi, locationApi, userApi, recurringApi, parseUTC,
  type Ticket, type Category, type Priority, type Role, type UpcomingRecurring,
} from "../api/client";
import { WorkRow, type ExtraKamer } from "../components/WorkRow";
import { AfdelingChip } from "../components/AfdelingChip";
import { UndoBar } from "../components/UndoBar";
import { useUitgesteldeActie } from "../undo";
import {
  AFDELING_LABELS, afdelingTekst, herhaalKort, leeftijdTekst,
} from "../werk";
import { werkMeta } from "../components/werkMeta";

/**
 * Vandaag — het startscherm.
 *
 * Bovenaan staat een wissel tussen twee soorten werk, met hoeveel er van elk
 * ligt:
 *   TICKETS    — NU (van jou of urgent) en TE PAKKEN (in jouw afdeling,
 *                zonder eigenaar).
 *   HERHALEND  — de terugkerende taken van vandaag.
 *
 * De twee stonden eerst door elkaar in één lijst NU. Dat leest prettig op een
 * groot scherm en slecht op een telefoon: je scrolt langs de schoonmaakronde
 * heen om te zien of er een storing ligt, en andersom. Gescheiden is elke
 * lijst kort genoeg om in één blik te overzien, en het getal op de andere knop
 * zegt of daar iets op je wacht.
 *
 * De keuze blijft staan tussen bezoeken: een housekeeper leeft in Herhalend,
 * de technische dienst in Tickets. Meer blokken zijn er niet — geen
 * begroeting, geen datum, geen statistiektegels, die kostten 342 px vóór de
 * eerste regel werk.
 */

interface Overview {
  user: {
    ha_user_id: string;
    display_name: string;
    role: Role;
    department: Category | null;
  };
  stats: { my_open: number; team_open: number; urgent: number };
  urgent_tickets: Ticket[];
  my_tickets: Ticket[];
  available_tickets: Ticket[];
  today_recurring: UpcomingRecurring[];
  upcoming_recurring: UpcomingRecurring[];
}

const PRIORITEIT_RANG: Record<Priority, number> = { urgent: 0, high: 1, medium: 2, low: 3 };

const ALLE_AFDELINGEN_KEY = "hts.vandaag_alle_afdelingen";
const SOORT_KEY = "hts.vandaag_soort";

const TE_PAKKEN_ZICHTBAAR = 3;

/** Een taak die zo lang blijft liggen gaat niet meer over vandaag. */
const OUD_NA_DAGEN = 3;

export default function Vandaag() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [users, setUsers] = useState<Record<string, string>>({});
  const [keycards, setKeycards] = useState<Record<string, boolean | null>>({});
  const [allesTonen, setAllesTonen] = useState(false);
  // Vandaag toont standaard je eigen afdeling — ook als admin. Wie er bewust
  // overheen kijkt houdt die keuze; het is een werkinstelling, geen filter dat
  // je elke ochtend opnieuw wil zetten.
  const [alleAfdelingen, setAlleAfdelingen] = useState(
    () => localStorage.getItem(ALLE_AFDELINGEN_KEY) === "1",
  );
  // Tickets of herhalende taken; de knoppen bovenaan wisselen, ze navigeren
  // niet. Wie hier gisteren op Herhalend stond staat er morgen weer op.
  const [soort, setSoort] = useState<"tickets" | "herhalend">(
    () => (localStorage.getItem(SOORT_KEY) === "herhalend" ? "herhalend" : "tickets"),
  );
  const tePakkenRef = useRef<HTMLElement>(null);

  // Alleen wat nog van niemand is — dezelfde knop als vroeger, nu naast de
  // wissel in plaats van als tweede getal.
  const [alleenTePakken, setAlleenTePakken] = useState(false);
  // Openstaande achterstand: dicht, tenzij iemand hem opentrekt.
  const [toonOud, setToonOud] = useState(false);

  function kiesSoort(nieuw: "tickets" | "herhalend") {
    setSoort(nieuw);
    setAlleenTePakken(false);
    localStorage.setItem(SOORT_KEY, nieuw);
  }

  const loadData = useCallback(async () => {
    // Het werk zelf is het enige dat moet lukken. Kamernamen en collega-namen
    // komen uit Home Assistant; hapert dat, dan hoort het startscherm niet leeg
    // te blijven — dan staat er een kamer-id in plaats van "214".
    const ov = await api.get<Overview>("/users/me/overview", {
      params: alleAfdelingen ? { department: "all" } : undefined,
    });
    setOverview(ov.data);

    const [locs, usrs] = await Promise.allSettled([locationApi.list(), userApi.list()]);
    if (locs.status === "fulfilled") {
      setLocations(Object.fromEntries(locs.value.data.map((l) => [l.id, l.name])));
    }
    if (usrs.status === "fulfilled") {
      setUsers(Object.fromEntries(usrs.value.data.map((u) => [u.ha_user_id, u.display_name])));
    }

    // Alle kamers in één verzoek: dit waren er net zoveel als er kamers op het
    // scherm stonden, en op hotelwifi is dat het verschil tussen een scherm dat
    // staat en een scherm dat druppelt.
    const kc = await locationApi.keycards().catch(() => null);
    if (kc) setKeycards(kc.data);
  }, [alleAfdelingen]);

  // Afvinken gaat optimistisch: de rij is meteen klaar en de API-aanroep
  // vertrekt pas na het ongedaan-maken-venster.
  const { actie, plan, ongedaan } = useUitgesteldeActie(5000, () => {
    loadData().catch(() => {});
  });

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, [loadData]);

  // Stil verversen zolang de pagina open staat.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      loadData().catch(() => {});
    };
    const id = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadData]);

  /** Wat nú van jou is of urgent: dezelfde ticket twee keer telt één keer. */
  const nuTickets = useMemo<Ticket[]>(() => {
    if (!overview) return [];
    const gezien = new Set<string>();
    const tickets: Ticket[] = [];
    for (const t of [...(overview.urgent_tickets ?? []), ...overview.my_tickets]) {
      if (gezien.has(t.id)) continue;
      gezien.add(t.id);
      tickets.push(t);
    }
    // Urgent altijd bovenaan, daarna prioriteit, daarna het oudste eerst.
    return tickets.sort((a, b) =>
      PRIORITEIT_RANG[a.priority] - PRIORITEIT_RANG[b.priority] ||
      a.created_at.localeCompare(b.created_at));
  }, [overview]);

  /**
   * De taken van vandaag, in dezelfde volgorde als de tickets — maar in twee
   * stapels.
   *
   * Een herhaaltaak die al een week open staat blijft elke dag bovenaan
   * meedoen, en dan gaat de lijst over die ene achterstand in plaats van over
   * vandaag. Alles ouder dan drie dagen zakt daarom naar een dichtgeklapte map
   * onderaan: het staat er nog, met een getal, maar het duwt het werk van
   * vandaag niet meer weg.
   */
  const { taken, blijftLiggen } = useMemo(() => {
    const opVolgorde = [...(overview?.today_recurring ?? [])].sort((a, b) =>
      PRIORITEIT_RANG[a.priority] - PRIORITEIT_RANG[b.priority] ||
      a.next_run.localeCompare(b.next_run));
    // next_run is bij een achterstallige taak het moment dat hij open ging
    // (zie services/vandaag.py), dus dat is precies "hoe lang staat dit al".
    const grens = Date.now() - OUD_NA_DAGEN * 86_400_000;
    return {
      taken: opVolgorde.filter((t) => parseUTC(t.next_run).getTime() >= grens),
      blijftLiggen: opVolgorde.filter((t) => parseUTC(t.next_run).getTime() < grens),
    };
  }, [overview]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
      </div>
    );
  }
  if (!overview) return null;

  const { user, available_tickets } = overview;
  const isManager = user.role === "admin" || user.role === "supervisor";
  const magHandelen = (category: Category) => isManager || user.department === category;

  const afgevinkt = (key: string) => actie?.id === key;
  const tePakken = available_tickets.filter((t) => magHandelen(t.category));
  const tePakkenZichtbaar = allesTonen ? tePakken : tePakken.slice(0, TE_PAKKEN_ZICHTBAAR);

  const aantalTePakken = tePakken.length;
  // Het getal op de knop is wat je in dat scherm te zien krijgt. Een urgente
  // ticket zonder eigenaar staat in beide lijsten; die telt hier één keer.
  const aantalTickets = new Set([
    ...nuTickets.map((t) => t.id),
    ...tePakken.map((t) => t.id),
  ]).size;

  function kamerVan(locationId: string | null | undefined): string | undefined {
    if (!locationId) return undefined;
    return locations[locationId] ?? locationId;
  }

  function rondTicketAf(t: Ticket) {
    const naam = kamerVan(t.location_id) ?? t.title;
    plan(t.id, `${naam} afgerond`, () => ticketApi.update(t.id, { status: "closed" }));
  }

  function rondTaakAf(taak: UpcomingRecurring) {
    const naam = kamerVan(taak.location_id) ?? taak.title;
    plan(`taak-${taak.id}`, `${naam} afgerond`, () => recurringApi.complete(taak.id));
  }

  async function pakOp(t: Ticket) {
    await ticketApi.claim(t.id);
    await loadData();
  }

  /** Metaregel van een ticket in het blok NU: hier nooit "Van mij" — dat zegt
   *  de sectiekop al. */
  const metaOpties = {
    mij: user.ha_user_id,
    naamVan: (id: string) => users[id] ?? id,
    eigenAfdeling: user.department,
    // Zie werkMeta: op Vandaag zegt "3 dagen open" niets wat de volgorde niet
    // al zegt, en het kost op een telefoon een regel per ticket.
    verbergLeeftijd: true,
  };

  const keycardVan = (t: Ticket) => (t.location_id ? keycards[t.location_id] : undefined);

  function metaNu(t: Ticket) {
    // Onder "nu" staat al wat van jou is; "Van mij" zou daar een woord zijn
    // dat niets toevoegt.
    return werkMeta(t, { ...metaOpties, verbergEigenNaam: true });
  }

  /** In "te pakken" heeft per definitie niemand het opgepakt. */
  function metaTePakken(t: Ticket) {
    return werkMeta(t, metaOpties);
  }

  function metaTaak(taak: UpcomingRecurring, metLeeftijd = false) {
    const fractie = taak.subtask_total ? `${taak.subtask_done ?? 0}/${taak.subtask_total}` : null;
    return [
      afdelingTekst(taak.category, user.department) && <AfdelingChip category={taak.category} />,
      fractie,
      // In de map "blijft liggen" is hoe lang het al ligt juist het verschil
      // tussen deze taken; op de dagelijkse lijst zou het ruis zijn.
      metLeeftijd && leeftijdTekst(taak.next_run),
      herhaalKort(taak.cron_expression, taak.interval_days),
    ].filter(Boolean);
  }

  /** Herhaaltaak over meerdere kamers: eerste kamer op de regel, rest eronder. */
  function kamersVanTaak(taak: UpcomingRecurring): { kamer?: string; occupied?: boolean | null; extra: ExtraKamer[] } {
    if (taak.subtask_mode === "rooms" && taak.subtask_items?.length) {
      const [eerste, ...rest] = taak.subtask_items;
      return {
        kamer: kamerVan(eerste),
        occupied: keycards[eerste],
        extra: rest.map((id) => ({ id, name: kamerVan(id) ?? id, occupied: keycards[id] })),
      };
    }
    return {
      kamer: kamerVan(taak.location_id),
      occupied: taak.location_id ? keycards[taak.location_id] : undefined,
      extra: [],
    };
  }

  // De kop moet zeggen waarop de lijst écht gefilterd is.
  const afdelingNaam =
    !alleAfdelingen && user.department
      ? AFDELING_LABELS[user.department].toLowerCase()
      : "alle afdelingen";
  // Buiten je eigen afdeling kijken heeft alleen zin als je er ook iets mee
  // kunt; een medewerker kan andermans tickets niet oppakken.
  const magSchakelen = isManager && !!user.department;

  return (
    <div className="space-y-6 max-w-3xl">
      {/* De wissel: welk soort werk, en hoeveel ervan ligt er */}
      <div className="flex gap-2">
        <SoortKnop
          actief={soort === "tickets"}
          onClick={() => kiesSoort("tickets")}
          label="Tickets"
          aantal={aantalTickets}
        />
        <SoortKnop
          actief={soort === "herhalend"}
          onClick={() => kiesSoort("herhalend")}
          label="Taken"
          aantal={taken.length + blijftLiggen.length}
        />
        {/* Filter, geen wissel: hij zit binnen Tickets en staat daarom los. */}
        {soort === "tickets" && aantalTePakken > 0 && (
          <SoortKnop
            actief={alleenTePakken}
            onClick={() => setAlleenTePakken(!alleenTePakken)}
            label="Te pakken"
            aantal={aantalTePakken}
            losstaand
          />
        )}
      </div>

      {soort === "herhalend" && (
        <section>
          {taken.length === 0 && blijftLiggen.length === 0 ? (
            <p className="meta">Geen taken voor vandaag.</p>
          ) : (
            <div className="grid gap-1.5">
              {taken.map((taak) => (
                <TaakRij
                  key={`taak-${taak.id}`}
                  taak={taak}
                  kamers={kamersVanTaak(taak)}
                  meta={afgevinkt(`taak-${taak.id}`) ? ["Klaar"] : metaTaak(taak)}
                  done={afgevinkt(`taak-${taak.id}`)}
                  magAfronden={magHandelen(taak.category) && !afgevinkt(`taak-${taak.id}`)}
                  onAfronden={() => rondTaakAf(taak)}
                />
              ))}
              {taken.length === 0 && (
                <p className="meta">Niets meer voor vandaag.</p>
              )}

              {blijftLiggen.length > 0 && (
                <>
                  <button
                    onClick={() => setToonOud(!toonOud)}
                    aria-expanded={toonOud}
                    className="tap gap-2 mt-1.5 w-full rounded-[10px] border border-ink-12 bg-paper-raised px-4 text-meta font-semibold text-ink-70 hover:bg-ink-6 transition-colors"
                  >
                    <span>{toonOud ? "▾" : "▸"}</span>
                    <span>Blijft liggen</span>
                    <span className="tabular-nums text-ink-45">{blijftLiggen.length}</span>
                  </button>
                  {toonOud && blijftLiggen.map((taak) => (
                    <TaakRij
                      key={`taak-${taak.id}`}
                      taak={taak}
                      kamers={kamersVanTaak(taak)}
                      meta={afgevinkt(`taak-${taak.id}`) ? ["Klaar"] : metaTaak(taak, true)}
                      done={afgevinkt(`taak-${taak.id}`)}
                      magAfronden={magHandelen(taak.category) && !afgevinkt(`taak-${taak.id}`)}
                      onAfronden={() => rondTaakAf(taak)}
                    />
                  ))}
                </>
              )}
            </div>
          )}
        </section>
      )}

      {soort === "tickets" && !alleenTePakken && (
        <section>
          <SectieKop>Nu</SectieKop>
          {nuTickets.length === 0 ? (
            <LegeStaatNu
              aantalTePakken={aantalTePakken}
              afdeling={afdelingNaam}
              onBekijk={() =>
                tePakkenRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            />
          ) : (
            <div className="grid gap-1.5">
              {nuTickets.map((t) => (
                <WorkRow
                  key={t.id}
                  to={`/tickets/${t.id}`}
                  priority={t.priority}
                  kamer={kamerVan(t.location_id)}
                  occupied={keycardVan(t)}
                  title={t.title}
                  meta={afgevinkt(t.id) ? ["Klaar"] : metaNu(t)}
                  done={afgevinkt(t.id)}
                  actie={
                    magHandelen(t.category) && !afgevinkt(t.id)
                      ? { soort: "afronden", onAfronden: () => rondTicketAf(t), label: "Ticket afronden" }
                      : { soort: "geen" }
                  }
                />
              ))}
            </div>
          )}
        </section>
      )}

      {soort === "tickets" && (
        <section ref={tePakkenRef}>
          <div className="flex items-baseline gap-3">
            <SectieKop>Te pakken · {afdelingNaam}</SectieKop>
            {magSchakelen && (
              <button
                onClick={() => {
                  const nieuw = !alleAfdelingen;
                  setAlleAfdelingen(nieuw);
                  localStorage.setItem(ALLE_AFDELINGEN_KEY, nieuw ? "1" : "0");
                }}
                className="ml-auto meta underline underline-offset-2 hover:text-ink whitespace-nowrap"
              >
                {alleAfdelingen ? "Alleen mijn afdeling" : "Alles tonen"}
              </button>
            )}
          </div>
          {tePakken.length === 0 ? (
            <p className="meta">Niets zonder eigenaar in {afdelingNaam}.</p>
          ) : (
            <div className="grid gap-1.5">
              {tePakkenZichtbaar.map((t) => (
                <WorkRow
                  key={t.id}
                  to={`/tickets/${t.id}`}
                  priority={t.priority}
                  kamer={kamerVan(t.location_id)}
                  occupied={keycardVan(t)}
                  title={t.title}
                  meta={metaTePakken(t)}
                  actie={{ soort: "pakken", onPakken: () => pakOp(t) }}
                />
              ))}
              {!allesTonen && tePakken.length > TE_PAKKEN_ZICHTBAAR && (
                <button
                  onClick={() => setAllesTonen(true)}
                  className="tap w-full rounded-[10px] border border-ink-12 bg-paper-raised text-meta font-semibold text-ink-70 hover:bg-ink-6 transition-colors"
                >
                  Nog {tePakken.length - TE_PAKKEN_ZICHTBAAR} tonen
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {actie && <UndoBar tekst={actie.label} onOngedaan={ongedaan} />}
    </div>
  );
}

function SectieKop({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-2.5 font-mono text-xs uppercase tracking-[0.14em] text-ink-45">{children}</p>
  );
}

/**
 * Eén kant van de wissel. Het getal staat achter het woord en niet ervoor:
 * je zoekt de lijst op zijn naam en leest daarna pas hoeveel er ligt.
 */
function SoortKnop({
  label, aantal, actief, onClick, losstaand = false,
}: {
  label: string;
  aantal: number;
  actief: boolean;
  onClick: () => void;
  /** Een filter binnen de gekozen kant, geen kant van de wissel zelf. */
  losstaand?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={actief}
      // gap en niet een spatie: de knop is een flexbox, en die slikt een
      // losse spatie tussen twee elementen op.
      className={`tap gap-1.5 px-3.5 rounded-full text-meta transition-colors ${
        losstaand ? "ml-auto" : ""
      } ${
        actief
          ? "bg-ink text-paper font-semibold"
          : "bg-paper-raised border border-ink-12 text-ink-70 font-medium hover:bg-ink-6"
      }`}
    >
      <span>{label}</span>
      <span className={`tabular-nums ${actief ? "text-paper/70" : "text-ink-45"}`}>{aantal}</span>
    </button>
  );
}

/**
 * Een lege lijst is een moment waarop iemand iets kán doen. Dus geen
 * felicitatie met een uitroepteken, maar het werk dat er ligt.
 */
function LegeStaatNu({
  aantalTePakken, afdeling, onBekijk,
}: { aantalTePakken: number; afdeling: string; onBekijk: () => void }) {
  return (
    <div className="rounded-[10px] border border-dashed border-ink-12 bg-paper-raised px-5 py-6">
      <p className="text-[1.1875rem] font-semibold leading-snug text-ink">Niets voor jou op dit moment.</p>
      {aantalTePakken > 0 ? (
        <>
          <p className="mt-1.5 text-[0.9375rem] text-ink-70">
            Er ligt wel werk in {afdeling} dat niemand heeft.
          </p>
          <button
            onClick={onBekijk}
            className="mt-4 h-tapLg px-4 inline-flex items-center rounded-[10px] bg-ink text-paper text-[0.96875rem] font-semibold hover:bg-ink-70 transition-colors"
          >
            Bekijk wat er ligt ({aantalTePakken})
          </button>
        </>
      ) : (
        <p className="mt-1.5 text-[0.9375rem] text-ink-70">Er ligt ook niets zonder eigenaar in {afdeling}.</p>
      )}
    </div>
  );
}

function TaakRij({
  taak, kamers, meta, done, magAfronden, onAfronden,
}: {
  taak: UpcomingRecurring;
  kamers: { kamer?: string; occupied?: boolean | null; extra: ExtraKamer[] };
  meta: React.ReactNode[];
  done: boolean;
  magAfronden: boolean;
  onAfronden: () => void;
}) {
  return (
    <WorkRow
      to={`/recurring/${taak.id}`}
      priority={taak.priority}
      kamer={kamers.kamer}
      occupied={kamers.occupied}
      extraKamers={kamers.extra}
      title={taak.title}
      meta={meta}
      done={done}
      actie={magAfronden ? { soort: "afronden", onAfronden, label: "Taak afronden" } : { soort: "geen" }}
    />
  );
}
