import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import api, {
  ticketApi, locationApi, userApi, recurringApi,
  type Ticket, type Category, type Priority, type Role, type UpcomingRecurring,
} from "../api/client";
import { WorkRow, type ExtraKamer } from "../components/WorkRow";
import { UndoBar } from "../components/UndoBar";
import { useUitgesteldeActie } from "../undo";
import {
  AFDELING_LABELS, afdelingTekst, eigendom, herhaalKort, kamerTekst,
  leeftijdTekst, prioriteitWoord, subtaakFractie,
} from "../werk";

/**
 * Vandaag — het startscherm.
 *
 * Twee blokken, vaste volgorde, altijd aanwezig (ook leeg):
 *   NU        — wat aan jou toebehoort of urgent is, inclusief de
 *               herhaaltaken van vandaag; die staan gewoon tussen de rest.
 *   TE PAKKEN — wat er in jouw afdeling ligt zonder eigenaar.
 *
 * Meer blokken zijn er niet: een derde vraag heeft niemand in de eerste twee
 * seconden. Geen begroeting, geen datum, geen statistiektegels — die kostten
 * 342 px vóór de eerste regel werk.
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

const TE_PAKKEN_ZICHTBAAR = 3;

type NuItem =
  | { soort: "ticket"; key: string; ticket: Ticket }
  | { soort: "taak"; key: string; taak: UpcomingRecurring };

export default function Vandaag() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [locations, setLocations] = useState<Record<string, string>>({});
  const [users, setUsers] = useState<Record<string, string>>({});
  const [keycards, setKeycards] = useState<Record<string, boolean | null>>({});
  const [allesTonen, setAllesTonen] = useState(false);
  // De twee getallen bovenaan zetten een filter, ze navigeren niet.
  const [focus, setFocus] = useState<"nu" | "pakken" | null>(null);
  const tePakkenRef = useRef<HTMLElement>(null);

  const loadData = useCallback(async () => {
    // Het werk zelf is het enige dat moet lukken. Kamernamen en collega-namen
    // komen uit Home Assistant; hapert dat, dan hoort het startscherm niet leeg
    // te blijven — dan staat er een kamer-id in plaats van "214".
    const ov = await api.get<Overview>("/users/me/overview");
    setOverview(ov.data);

    const [locs, usrs] = await Promise.allSettled([locationApi.list(), userApi.list()]);
    if (locs.status === "fulfilled") {
      setLocations(Object.fromEntries(locs.value.data.map((l) => [l.id, l.name])));
    }
    if (usrs.status === "fulfilled") {
      setUsers(Object.fromEntries(usrs.value.data.map((u) => [u.ha_user_id, u.display_name])));
    }

    const tickets = [...(ov.data.urgent_tickets ?? []), ...ov.data.my_tickets, ...ov.data.available_tickets];
    const taken = [...(ov.data.today_recurring ?? []), ...(ov.data.upcoming_recurring ?? [])];
    const areaIds = [...new Set([
      ...tickets.map((t) => t.location_id).filter(Boolean) as string[],
      ...taken.map((t) => t.location_id).filter(Boolean) as string[],
      ...taken.filter((t) => t.subtask_mode === "rooms").flatMap((t) => t.subtask_items ?? []),
    ])];
    const results = await Promise.allSettled(
      areaIds.map((id) => locationApi.keycard(id).then((r) => ({ id, occupied: r.data.found ? r.data.occupied : null })))
    );
    const map: Record<string, boolean | null> = {};
    results.forEach((r) => { if (r.status === "fulfilled") map[r.value.id] = r.value.occupied; });
    setKeycards(map);
  }, []);

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

  const nuItems = useMemo<NuItem[]>(() => {
    if (!overview) return [];
    const gezien = new Set<string>();
    const tickets: Ticket[] = [];
    for (const t of [...(overview.urgent_tickets ?? []), ...overview.my_tickets]) {
      if (gezien.has(t.id)) continue;
      gezien.add(t.id);
      tickets.push(t);
    }
    const items: NuItem[] = [
      ...tickets.map((t) => ({ soort: "ticket" as const, key: t.id, ticket: t })),
      ...(overview.today_recurring ?? []).map((t) => ({ soort: "taak" as const, key: `taak-${t.id}`, taak: t })),
    ];
    // Urgent altijd bovenaan, daarna prioriteit, daarna het oudste eerst.
    return items.sort((a, b) => {
      const pa = a.soort === "ticket" ? a.ticket.priority : a.taak.priority;
      const pb = b.soort === "ticket" ? b.ticket.priority : b.taak.priority;
      if (PRIORITEIT_RANG[pa] !== PRIORITEIT_RANG[pb]) return PRIORITEIT_RANG[pa] - PRIORITEIT_RANG[pb];
      const da = a.soort === "ticket" ? a.ticket.created_at : a.taak.next_run;
      const db = b.soort === "ticket" ? b.ticket.created_at : b.taak.next_run;
      return da.localeCompare(db);
    });
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

  const aantalVoorJou = nuItems.length;
  const aantalTePakken = tePakken.length;

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
  function metaNu(t: Ticket) {
    const bezit = eigendom(t, user.ha_user_id, (id) => users[id] ?? id);
    const prio = prioriteitWoord(t.priority);
    return [
      prio && (
        <strong className={`font-semibold ${t.priority === "urgent" ? "text-urgent" : "text-high"}`}>
          {prio}
        </strong>
      ),
      bezit.soort === "ander" || bezit.soort === "vrij" ? bezit.label : null,
      afdelingTekst(t.category, user.department),
      subtaakFractie(t),
      kamerTekst(t.location_id ? keycards[t.location_id] : undefined),
      leeftijdTekst(t.created_at),
    ].filter(Boolean);
  }

  /** In "Te pakken" nooit "Vrij" — dat is precies wat de sectiekop zegt. */
  function metaTePakken(t: Ticket) {
    const prio = prioriteitWoord(t.priority);
    return [
      prio && (
        <strong className={`font-semibold ${t.priority === "urgent" ? "text-urgent" : "text-high"}`}>
          {prio}
        </strong>
      ),
      afdelingTekst(t.category, user.department),
      subtaakFractie(t),
      kamerTekst(t.location_id ? keycards[t.location_id] : undefined),
      leeftijdTekst(t.created_at),
    ].filter(Boolean);
  }

  function metaTaak(taak: UpcomingRecurring) {
    const fractie = taak.subtask_total ? `${taak.subtask_done ?? 0}/${taak.subtask_total}` : null;
    return [
      afdelingTekst(taak.category, user.department),
      fractie,
      kamerTekst(taak.location_id ? keycards[taak.location_id] : undefined),
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

  // De kop moet zeggen waarop de lijst écht gefilterd is: admins en
  // supervisors krijgen van de server alle afdelingen, ook als ze zelf bij een
  // afdeling horen.
  const afdelingNaam =
    !isManager && user.department ? AFDELING_LABELS[user.department].toLowerCase() : "alle afdelingen";

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Samenvatting: twee chips die filteren, niet navigeren */}
      <div className="flex gap-2">
        <FilterChip
          actief={focus === "nu"}
          onClick={() => setFocus(focus === "nu" ? null : "nu")}
          label={`${aantalVoorJou} voor jou`}
        />
        <FilterChip
          actief={focus === "pakken"}
          onClick={() => setFocus(focus === "pakken" ? null : "pakken")}
          label={`${aantalTePakken} te pakken`}
        />
      </div>

      {focus !== "pakken" && (
        <section>
          <SectieKop>Nu</SectieKop>
          {nuItems.length === 0 ? (
            <LegeStaatNu
              aantalTePakken={aantalTePakken}
              afdeling={afdelingNaam}
              onBekijk={() => {
                setFocus(null);
                tePakkenRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            />
          ) : (
            <div className="grid gap-2">
              {nuItems.map((item) =>
                item.soort === "ticket" ? (
                  <WorkRow
                    key={item.key}
                    to={`/tickets/${item.ticket.id}`}
                    priority={item.ticket.priority}
                    kamer={kamerVan(item.ticket.location_id)}
                    occupied={item.ticket.location_id ? keycards[item.ticket.location_id] : undefined}
                    title={item.ticket.title}
                    meta={afgevinkt(item.key) ? ["Klaar"] : metaNu(item.ticket)}
                    done={afgevinkt(item.key)}
                    actie={
                      magHandelen(item.ticket.category) && !afgevinkt(item.key)
                        ? { soort: "afronden", onAfronden: () => rondTicketAf(item.ticket), label: "Ticket afronden" }
                        : { soort: "geen" }
                    }
                  />
                ) : (
                  <TaakRij
                    key={item.key}
                    taak={item.taak}
                    kamers={kamersVanTaak(item.taak)}
                    meta={afgevinkt(item.key) ? ["Klaar"] : metaTaak(item.taak)}
                    done={afgevinkt(item.key)}
                    magAfronden={magHandelen(item.taak.category) && !afgevinkt(item.key)}
                    onAfronden={() => rondTaakAf(item.taak)}
                  />
                )
              )}
            </div>
          )}
        </section>
      )}

      {focus !== "nu" && (
        <section ref={tePakkenRef}>
          <SectieKop>Te pakken · {afdelingNaam}</SectieKop>
          {tePakken.length === 0 ? (
            <p className="meta">Niets zonder eigenaar in {afdelingNaam}.</p>
          ) : (
            <div className="grid gap-2">
              {tePakkenZichtbaar.map((t) => (
                <WorkRow
                  key={t.id}
                  to={`/tickets/${t.id}`}
                  priority={t.priority}
                  kamer={kamerVan(t.location_id)}
                  occupied={t.location_id ? keycards[t.location_id] : undefined}
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

function FilterChip({ label, actief, onClick }: { label: string; actief: boolean; onClick: () => void }) {
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
      {label}
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
