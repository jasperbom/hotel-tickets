import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  DndContext, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import api, {
  ticketApi, locationApi, userApi, recurringApi, parseUTC,
  type Ticket, type Category, type Priority, type Role, type UpcomingRecurring,
} from "../api/client";
import { WorkRow, type ExtraKamer } from "../components/WorkRow";
import { AfdelingChip } from "../components/AfdelingChip";
import { UndoBar } from "../components/UndoBar";
import { ScrollVak } from "../components/ScrollVak";
import { useUitgesteldeActie } from "../undo";
import {
  AFDELING_LABELS, PRIORITEIT_VOLGORDE, afdelingTekst, herhaalKort, leeftijdTekst,
  prioriteitKleur, prioriteitWoord,
} from "../werk";
import { werkMeta } from "../components/werkMeta";

/**
 * Vandaag — het startscherm.
 *
 * Bovenaan een schakelaar tussen twee soorten werk, met hoeveel er van elk
 * ligt:
 *   TICKETS    — NU (van jou of urgent) en TE PAKKEN (in jouw afdeling,
 *                zonder eigenaar).
 *   TAKEN      — de terugkerende taken van vandaag.
 *
 * NU en TE PAKKEN staan allebei altijd in beeld, elk in een eigen vak dat
 * zelf scrolt; de koppen blijven staan. Eerst stonden ze onder elkaar op een
 * lange pagina, en dan bestond TE PAKKEN op een telefoon pas na doorscrollen
 * — precies de lijst waarvan iemand moet weten dat hij er is. De vakken
 * verdelen de hoogte naar hoeveel erin staat: de langste lijst levert het
 * meeste in, en geen van beide wordt kleiner dan een paar rijen.
 *
 * De pagina zelf blijft een gewone, scrollende pagina zoals Tickets. Drie
 * pogingen om de app-shell vast te pinnen (kb-fit met visualViewport, met
 * 100dvh, met inset 0) lieten op een iPhone allemaal een strook onder de
 * onderbalk over: de browser houdt die ruimte in zolang de pagina niet
 * scrolt, en geeft hem pas vrij bij een pagina die dat wél kan. De vakken
 * zijn daarom samen zo hoog als het scherm boven de onderbalk, en de pagina
 * mag daaronder gewoon een stukje doorlopen, net als elke andere.
 *
 * NU is gegroepeerd per prioriteit, met een tussenkopje en aantal per groep.
 * Binnen een groep kun je je eigen tickets verslepen — de volgorde waarin je
 * ze wilt doen — en die volgorde onthoudt de server (sort_order). Een urgent
 * ticket van een collega staat in de groep Urgent onder je eigen tickets en is
 * niet versleepbaar.
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
/** Zelf gekozen hoogte van het vak NU op een telefoon, in px. */
const NU_HOOGTE_KEY = "hts.vandaag_nu_hoogte";

/** Ondergrens van een vak op een telefoon: kop plus een paar rijen. */
const VAK_MIN_PX = 9 * 16;
/** Het onderste vak heeft daarbovenop ruimte nodig voor de meldknop. */
const ONDER_MIN_PX = 15 * 16;

/** Een taak die zo lang blijft liggen gaat niet meer over vandaag. */
const OUD_NA_DAGEN = 3;

export default function Vandaag() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [users, setUsers] = useState<Record<string, string>>({});
  const [keycards, setKeycards] = useState<Record<string, boolean | null>>({});
  // Vandaag toont standaard je eigen afdeling — ook als admin. Wie er bewust
  // overheen kijkt houdt die keuze; het is een werkinstelling, geen filter dat
  // je elke ochtend opnieuw wil zetten.
  const [alleAfdelingen, setAlleAfdelingen] = useState(
    () => localStorage.getItem(ALLE_AFDELINGEN_KEY) === "1",
  );
  // Tickets of herhalende taken; de schakelaar bovenaan wisselt, hij navigeert
  // niet. Wie hier gisteren op Taken stond staat er morgen weer op.
  const [soort, setSoort] = useState<"tickets" | "herhalend">(
    () => (localStorage.getItem(SOORT_KEY) === "herhalend" ? "herhalend" : "tickets"),
  );
  // Openstaande achterstand: dicht, tenzij iemand hem opentrekt.
  const [toonOud, setToonOud] = useState(false);
  // De verdeling tussen NU en TE PAKKEN op een telefoon. Standaard verdelen
  // de vakken zich naar inhoud; wie de sleepbalk ertussen verschuift kiest
  // een vaste hoogte voor NU, en die blijft staan tussen bezoeken.
  const [nuHoogte, setNuHoogte] = useState<number | null>(() => {
    const v = Number(localStorage.getItem(NU_HOOGTE_KEY));
    return v > 0 ? v : null;
  });
  const vakkenRef = useRef<HTMLDivElement>(null);
  const nuRef = useRef<HTMLElement>(null);

  /**
   * Slepen aan de balk tussen de vakken. De nieuwe hoogte van NU is de hoogte
   * bij het begin van de sleep plus de afstand die de vinger aflegt, begrensd
   * zodat geen van beide vakken onder zijn minimum komt.
   */
  function begintSleep(e: React.PointerEvent<HTMLDivElement>) {
    const vakken = vakkenRef.current;
    const nu = nuRef.current;
    if (!vakken || !nu) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const startY = e.clientY;
    const startHoogte = nu.getBoundingClientRect().height;
    const totaal = vakken.getBoundingClientRect().height;
    const balk = e.currentTarget.getBoundingClientRect().height;
    const max = totaal - balk - ONDER_MIN_PX;
    let laatste = startHoogte;
    const beweeg = (ev: PointerEvent) => {
      laatste = Math.round(Math.min(max, Math.max(VAK_MIN_PX, startHoogte + ev.clientY - startY)));
      setNuHoogte(laatste);
    };
    const klaar = () => {
      window.removeEventListener("pointermove", beweeg);
      window.removeEventListener("pointerup", klaar);
      window.removeEventListener("pointercancel", klaar);
      localStorage.setItem(NU_HOOGTE_KEY, String(laatste));
    };
    window.addEventListener("pointermove", beweeg);
    window.addEventListener("pointerup", klaar);
    window.addEventListener("pointercancel", klaar);
  }

  /** Dubbeltik op de balk: terug naar de automatische verdeling. */
  function herstelVerdeling() {
    setNuHoogte(null);
    localStorage.removeItem(NU_HOOGTE_KEY);
  }

  function kiesSoort(nieuw: "tickets" | "herhalend") {
    setSoort(nieuw);
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

  /**
   * Wat nú van jou is of urgent, per prioriteit. Eigen tickets komen in de
   * volgorde van de server (prioriteit, dan je eigen sort_order, dan leeftijd);
   * daarachter per groep de urgente tickets van collega's. Dezelfde ticket in
   * beide lijsten telt één keer.
   */
  const nuGroepen = useMemo(() => {
    const groepen = new Map<Priority, { mijn: Ticket[]; anderen: Ticket[] }>(
      PRIORITEIT_VOLGORDE.map((p) => [p, { mijn: [], anderen: [] }]),
    );
    if (!overview) return groepen;
    const gezien = new Set<string>();
    for (const t of overview.my_tickets) {
      gezien.add(t.id);
      groepen.get(t.priority)!.mijn.push(t);
    }
    for (const t of overview.urgent_tickets ?? []) {
      if (gezien.has(t.id)) continue;
      gezien.add(t.id);
      groepen.get(t.priority)!.anderen.push(t);
    }
    return groepen;
  }, [overview]);

  const aantalNu = useMemo(
    () => [...nuGroepen.values()].reduce((n, g) => n + g.mijn.length + g.anderen.length, 0),
    [nuGroepen],
  );

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

  // Slepen: muis na 4 px, vinger na 150 ms vasthouden — anders begint elke
  // scrollbeweging een sleep.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  );

  /**
   * Losgelaten. Alleen binnen dezelfde prioriteit en alleen eigen tickets;
   * de rij verschuift meteen, de server krijgt daarna de volledige volgorde
   * van al je tickets (sort_order telt over de groepen heen).
   */
  function bijSleepEinde(event: DragEndEvent) {
    const { active, over } = event;
    if (!overview || !over || active.id === over.id) return;
    const mijn = overview.my_tickets;
    const van = mijn.findIndex((t) => t.id === active.id);
    const naar = mijn.findIndex((t) => t.id === over.id);
    if (van < 0 || naar < 0) return;
    if (mijn[van].priority !== mijn[naar].priority) return;
    const nieuw = arrayMove(mijn, van, naar);
    setOverview({ ...overview, my_tickets: nieuw });
    ticketApi.reorder(nieuw.map((t) => t.id)).catch(() => loadData().catch(() => {}));
  }

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

  // Het getal op de schakelaar is wat je in dat scherm te zien krijgt. Een
  // urgente ticket zonder eigenaar staat in beide lijsten; die telt één keer.
  const aantalTickets = new Set([
    ...[...nuGroepen.values()].flatMap((g) => [...g.mijn, ...g.anderen].map((t) => t.id)),
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
      <strong className={`font-semibold ${prioriteitKleur(taak.priority)}`}>
        {prioriteitWoord(taak.priority)}
      </strong>,
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

  function ticketRij(t: Ticket, meta: React.ReactNode[], afronden: boolean) {
    return (
      <WorkRow
        to={`/tickets/${t.id}`}
        priority={t.priority}
        kamer={kamerVan(t.location_id)}
        occupied={keycardVan(t)}
        title={t.title}
        meta={afgevinkt(t.id) ? ["Klaar"] : meta}
        done={afgevinkt(t.id)}
        actie={
          afronden && !afgevinkt(t.id)
            ? { soort: "afronden", onAfronden: () => rondTicketAf(t), label: "Ticket afronden" }
            : { soort: "geen" }
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 xl:max-w-5xl h-[calc(100dvh-var(--kopbalk)-var(--onderbalk)-2.25rem)] md:h-[calc(100dvh-3rem)]">
      {/* De schakelaar: welk soort werk, en hoeveel ervan ligt er */}
      <div className="shrink-0 flex">
        <div className="seg" role="tablist">
          <SoortKnop actief={soort === "tickets"} onClick={() => kiesSoort("tickets")} label="Tickets" aantal={aantalTickets} />
          <SoortKnop actief={soort === "herhalend"} onClick={() => kiesSoort("herhalend")} label="Taken" aantal={taken.length + blijftLiggen.length} />
        </div>
      </div>

      {soort === "herhalend" && (
        <Vak kop="Taken" aantal={taken.length + blijftLiggen.length} onder>
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
        </Vak>
      )}

      {soort === "tickets" && (
        // Twee vakken. Op een telefoon onder elkaar, op een breed scherm naast
        // elkaar: daar is breedte over en hoogte schaars.
        <div ref={vakkenRef} className="flex-1 min-h-0 flex flex-col md:flex-row md:gap-6">
          <Vak kop="Nu" aantal={aantalNu} gewicht={1.25} vasteHoogte={nuHoogte} sectieRef={nuRef}>
            {aantalNu === 0 ? (
              <LegeStaatNu aantalTePakken={tePakken.length} afdeling={afdelingNaam} />
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={bijSleepEinde}>
                <div className="grid gap-3.5">
                  {PRIORITEIT_VOLGORDE.map((p) => {
                    const groep = nuGroepen.get(p)!;
                    const aantal = groep.mijn.length + groep.anderen.length;
                    if (aantal === 0) return null;
                    // Slepen heeft pas zin met twee eigen tickets in de groep.
                    const sleepbaar = groep.mijn.length > 1;
                    return (
                      <section key={p}>
                        <p className={`mb-1.5 flex items-baseline gap-2 font-mono text-xs uppercase tracking-[0.14em] ${prioriteitKleur(p)}`}>
                          <span>{prioriteitWoord(p)}</span>
                          <span className="tabular-nums opacity-80">{aantal}</span>
                        </p>
                        <div className="grid gap-1.5">
                          <SortableContext items={groep.mijn.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                            {groep.mijn.map((t) => (
                              <SleepRij key={t.id} id={t.id} sleepbaar={sleepbaar}>
                                {ticketRij(t, metaNu(t), magHandelen(t.category))}
                              </SleepRij>
                            ))}
                          </SortableContext>
                          {groep.anderen.map((t) => (
                            <div key={t.id} className={sleepbaar ? "pl-6" : ""}>
                              {ticketRij(t, metaNu(t), magHandelen(t.category))}
                            </div>
                          ))}
                        </div>
                      </section>
                    );
                  })}
                </div>
              </DndContext>
            )}
          </Vak>

          {/* De sleepbalk: alleen op een telefoon, waar de vakken onder elkaar
              staan en hoogte schaars is. Naast elkaar is er niets te verdelen. */}
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Verdeling tussen Nu en Te pakken; sleep om aan te passen, dubbeltik om te herstellen"
            onPointerDown={begintSleep}
            onDoubleClick={herstelVerdeling}
            className="md:hidden shrink-0 h-6 my-1 flex items-center justify-center cursor-row-resize touch-none select-none"
          >
            <span className="h-1.5 w-12 rounded-full bg-ink-25" aria-hidden="true" />
          </div>

          <Vak
            kop="Te pakken"
            aantal={tePakken.length}
            onder
            rechts={
              magSchakelen && (
                <button
                  onClick={() => {
                    const nieuw = !alleAfdelingen;
                    setAlleAfdelingen(nieuw);
                    localStorage.setItem(ALLE_AFDELINGEN_KEY, nieuw ? "1" : "0");
                  }}
                  className="meta underline underline-offset-2 hover:text-ink whitespace-nowrap"
                >
                  {alleAfdelingen ? "Alleen mijn afdeling" : "Alles tonen"}
                </button>
              )
            }
          >
            {tePakken.length === 0 ? (
              <p className="meta">Niets zonder eigenaar in {afdelingNaam}.</p>
            ) : (
              <div className="grid gap-1.5">
                {tePakken.map((t) => (
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
              </div>
            )}
          </Vak>
        </div>
      )}

      {actie && <UndoBar tekst={actie.label} onOngedaan={ongedaan} />}
    </div>
  );
}

/**
 * Eén vak: een kop die blijft staan en een lijst die eronder scrolt.
 *
 * `gewicht` is de flex-basis-verhouding waarmee de vakken de hoogte verdelen
 * zodra ze samen niet passen; wat wél past krijgt gewoon zijn eigen hoogte.
 * Met `vasteHoogte` (de sleepbalk) staat de hoogte op een telefoon vast.
 * Een vak wordt nooit kleiner dan een paar rijen; `onder` reserveert
 * daarbovenop ruimte voor de zwevende meldknop, zodat de laatste rij
 * eronderuit kan scrollen — die ruimte telt niet mee als "zichtbare rijen",
 * daar ging de eerste versie de mist in: er bleef één rij over.
 */
function Vak({
  kop, aantal, rechts, onder = false, gewicht = 1, vasteHoogte = null, sectieRef, children,
}: {
  kop: string;
  aantal: number;
  rechts?: React.ReactNode;
  onder?: boolean;
  gewicht?: number;
  vasteHoogte?: number | null;
  sectieRef?: React.Ref<HTMLElement>;
  children: React.ReactNode;
}) {
  const minPx = onder ? ONDER_MIN_PX : VAK_MIN_PX;
  return (
    <section
      ref={sectieRef}
      // 0 1 en niet 0 0: een op een groter scherm gekozen hoogte mag op een
      // kleiner scherm krimpen tot het onderste vak zijn minimum heeft.
      className={`flex flex-col md:[flex:1_1_0%] ${
        vasteHoogte ? "max-md:[flex:0_1_var(--vast)]" : "max-md:[flex:var(--gewicht)_1_auto]"
      }`}
      style={{
        "--gewicht": gewicht,
        "--vast": vasteHoogte ? `${vasteHoogte}px` : undefined,
        minHeight: `${minPx}px`,
      } as CSSProperties}
    >
      <h2 className="shrink-0 mb-2.5 pb-2 border-b border-ink-12 flex items-baseline gap-2.5 text-[1.3125rem] font-bold leading-tight text-ink">
        <span>{kop}</span>
        <span className="text-row font-semibold text-ink-45 tabular-nums">{aantal}</span>
        {rechts && <span className="ml-auto">{rechts}</span>}
      </h2>
      <ScrollVak className={`flex-1 pb-2 ${onder ? "pb-[4.75rem] md:pb-2" : ""}`}>
        {children}
      </ScrollVak>
    </section>
  );
}

function SoortKnop({
  label, aantal, actief, onClick,
}: {
  label: string;
  aantal: number;
  actief: boolean;
  onClick: () => void;
}) {
  return (
    <button onClick={onClick} role="tab" aria-selected={actief} className={actief ? "seg-aan" : ""}>
      <span>{label}</span>
      <span className="tabular-nums text-ink-45">{aantal}</span>
    </button>
  );
}

/**
 * Een eigen ticket in NU, versleepbaar binnen zijn prioriteitsgroep. Het
 * greepje links is het enige dat sleept; de rij zelf blijft een link.
 */
function SleepRij({ id, sleepbaar, children }: { id: string; sleepbaar: boolean; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled: !sleepbaar });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : undefined,
    position: "relative",
  };
  if (!sleepbaar) return <div ref={setNodeRef} style={style}>{children}</div>;
  return (
    <div ref={setNodeRef} style={style} className="flex items-stretch gap-1">
      <button
        {...attributes}
        {...listeners}
        type="button"
        aria-label="Versleep om de volgorde te wijzigen"
        title="Versleep om de volgorde te wijzigen"
        className="shrink-0 w-5 -ml-1 flex items-center justify-center cursor-grab active:cursor-grabbing touch-none select-none text-ink-25 hover:text-ink-70"
      >
        <GripVertical size={16} aria-hidden="true" />
      </button>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

/**
 * Een lege lijst is een moment waarop iemand iets kán doen. Dus geen
 * felicitatie met een uitroepteken, maar het werk dat er ligt — en dat staat
 * in het vak hieronder, altijd in beeld.
 */
function LegeStaatNu({ aantalTePakken, afdeling }: { aantalTePakken: number; afdeling: string }) {
  return (
    <div className="rounded-[10px] border border-dashed border-ink-12 bg-paper-raised px-5 py-6">
      <p className="text-[1.1875rem] font-semibold leading-snug text-ink">Niets voor jou op dit moment.</p>
      <p className="mt-1.5 text-[0.9375rem] text-ink-70">
        {aantalTePakken > 0
          ? `Er ligt wel werk in ${afdeling} dat niemand heeft.`
          : `Er ligt ook niets zonder eigenaar in ${afdeling}.`}
      </p>
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
