import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { locationApi, ticketApi, userApi, type Category, type Ticket } from "../api/client";
import { kamerKleur, kamerToestand } from "../werk";

/**
 * Kamers — het scherm dat de keycard-integratie uitbetaalt.
 *
 * Sortering is niet alfabetisch maar "vrij én werk eerst": dat is de enige
 * lijst waar een housekeeper op wacht — waar kan ik nú naar binnen en is daar
 * iets te doen. Bezette kamers staan eronder, met "Meld mij" per kamer in
 * plaats van per ticket.
 *
 * Dit vervangt de filterknop "Groepeer per locatie", die dezelfde gegevens
 * verstopte in een filter.
 */

interface Kamer {
  id: string;
  naam: string;
  bezet: boolean | null;
  tickets: Ticket[];
  urgent: number;
  gemeld: boolean;
}

export default function Kamers() {
  const [kamers, setKamers] = useState<Kamer[]>([]);
  const [loading, setLoading] = useState(true);
  const [alleKamers, setAlleKamers] = useState(false);
  const [bezig, setBezig] = useState<string | null>(null);
  const [mij, setMij] = useState("");
  const navigate = useNavigate();

  const laden = useCallback(async (metLegeKamers: boolean) => {
    const [locs, open, me] = await Promise.all([
      locationApi.list().catch(() => ({ data: [] as { id: string; name: string }[] })),
      ticketApi.list({ status: "open,in_progress" }),
      userApi.me().catch(() => null),
    ]);
    if (me) setMij(me.data.ha_user_id);

    const perKamer = new Map<string, Ticket[]>();
    for (const t of open.data) {
      if (!t.location_id) continue;
      const lijst = perKamer.get(t.location_id) ?? [];
      lijst.push(t);
      perKamer.set(t.location_id, lijst);
    }

    // Alleen keycards opvragen voor kamers die we ook tonen: dat is één
    // verzoek per kamer, en dat loopt met een heel gebouw hard op.
    const gebieden = locs.data.length
      ? locs.data
      : [...perKamer.keys()].map((id) => ({ id, name: id }));
    const relevant = metLegeKamers ? gebieden : gebieden.filter((g) => perKamer.has(g.id));

    const standen = await Promise.allSettled(
      relevant.map((g) =>
        locationApi.keycard(g.id).then((r) => ({ id: g.id, bezet: r.data.found ? r.data.occupied : null }))
      )
    );
    const bezetPer = new Map<string, boolean | null>();
    standen.forEach((s) => { if (s.status === "fulfilled") bezetPer.set(s.value.id, s.value.bezet); });

    setKamers(relevant.map((g) => {
      const tickets = perKamer.get(g.id) ?? [];
      return {
        id: g.id,
        naam: g.name,
        bezet: bezetPer.get(g.id) ?? null,
        tickets,
        urgent: tickets.filter((t) => t.priority === "urgent").length,
        gemeld: tickets.some((t) => t.notify_when_free),
      };
    }));
  }, []);

  useEffect(() => {
    setLoading(true);
    laden(alleKamers).finally(() => setLoading(false));
  }, [laden, alleKamers]);

  const { naarBinnen, bezet, rest } = useMemo(() => {
    const metWerk = kamers.filter((k) => k.tickets.length > 0);
    const zonderWerk = kamers.filter((k) => k.tickets.length === 0);
    const sorteer = (a: Kamer, b: Kamer) =>
      b.urgent - a.urgent || b.tickets.length - a.tickets.length || a.naam.localeCompare(b.naam, "nl");
    return {
      naarBinnen: metWerk.filter((k) => k.bezet !== true).sort(sorteer),
      bezet: metWerk.filter((k) => k.bezet === true).sort(sorteer),
      rest: zonderWerk.sort((a, b) => a.naam.localeCompare(b.naam, "nl")),
    };
  }, [kamers]);

  /**
   * "Meld mij" zet de bestaande melding-bij-vrij aan. Die notificatie gaat
   * naar de toegewezene van het ticket, dus als er nog niemand op zit pakken
   * we het meteen op — anders zou er niemand bericht krijgen.
   */
  async function meldMij(kamer: Kamer) {
    setBezig(kamer.id);
    try {
      const eigen = kamer.tickets.filter((t) => t.assigned_to === mij);
      if (eigen.length > 0) {
        await ticketApi.update(eigen[0].id, { notify_when_free: true });
      } else {
        const doel = kamer.tickets[0];
        await ticketApi.claim(doel.id);
        await ticketApi.update(doel.id, { notify_when_free: true });
      }
      await laden(alleKamers);
    } finally {
      setBezig(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="seg">
        <button
          onClick={() => setAlleKamers(false)}
          aria-pressed={!alleKamers}
          className={!alleKamers ? "seg-aan" : ""}
        >
          Vrij én werk {naarBinnen.length}
        </button>
        <button
          onClick={() => setAlleKamers(true)}
          aria-pressed={alleKamers}
          className={alleKamers ? "seg-aan" : ""}
        >
          Alle kamers
        </button>
      </div>

      <section>
        <SectieKop>Nu naar binnen</SectieKop>
        {naarBinnen.length === 0 ? (
          <p className="meta">Geen vrije kamer met openstaand werk.</p>
        ) : (
          <div className="grid gap-2">
            {naarBinnen.map((k) => (
              <KamerRij key={k.id} kamer={k} onOpen={() => navigate(`/tickets?kamer=${encodeURIComponent(k.id)}`)} />
            ))}
          </div>
        )}
      </section>

      {bezet.length > 0 && (
        <section>
          <SectieKop>Nog bezet</SectieKop>
          <div className="grid gap-2">
            {bezet.map((k) => (
              <KamerRij
                key={k.id}
                kamer={k}
                onOpen={() => navigate(`/tickets?kamer=${encodeURIComponent(k.id)}`)}
                actie={
                  k.gemeld ? (
                    <span className="shrink-0 h-tap px-3 inline-flex items-center text-meta text-done font-semibold">
                      ✓ Gemeld
                    </span>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); meldMij(k); }}
                      disabled={bezig === k.id}
                      title="Je pakt het openstaande werk op en krijgt bericht zodra de gast uitcheckt"
                      className="shrink-0 h-tap px-3.5 inline-flex items-center rounded-[10px] border border-ink
                                 text-ink text-meta font-semibold hover:bg-ink-6 disabled:opacity-50"
                    >
                      {bezig === k.id ? "…" : "Meld mij"}
                    </button>
                  )
                }
              />
            ))}
          </div>
        </section>
      )}

      {alleKamers && rest.length > 0 && (
        <section>
          <SectieKop>Zonder openstaand werk</SectieKop>
          <div className="grid gap-2">
            {rest.map((k) => (
              <KamerRij
                key={k.id}
                kamer={k}
                onOpen={() => navigate("/tickets/new", { state: { locationId: k.id } })}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SectieKop({ children }: { children: React.ReactNode }) {
  return <p className="mb-2.5 font-mono text-xs uppercase tracking-[0.14em] text-ink-45">{children}</p>;
}

function KamerRij({ kamer, onOpen, actie }: { kamer: Kamer; onOpen: () => void; actie?: React.ReactNode }) {
  const urgentRand = kamer.urgent > 0 ? "row--urgent" : "";
  // "Bezet" stond hier ook nog eens in woorden, terwijl de kamernaam het al
  // zegt en de kop erboven de rijen al op vrij/bezet sorteert.
  const beschrijving = [
    kamer.urgent > 0
      ? `${kamer.urgent} urgent`
      : kamer.tickets.length > 0
        ? `${kamer.tickets.length} open`
        : "niets open",
  ].filter(Boolean).join(" · ");

  return (
    <div className={`row ${urgentRand} min-h-[66px]`}>
      <button onClick={onOpen} className="flex-1 min-w-0 flex items-center gap-3.5 text-left">
        <span className="flex items-baseline gap-2 min-w-0">
          <span
            className={`text-[1.1875rem] font-bold truncate ${kamerKleur(kamer.bezet) || "text-ink"}`}
          >
            {kamer.naam}
            {kamerToestand(kamer.bezet) && (
              <span className="sr-only">, {kamerToestand(kamer.bezet)}</span>
            )}
          </span>
        </span>
        <span className="meta ml-auto shrink-0">{beschrijving}</span>
        {!actie && <ChevronRight size={18} className="text-ink-25 shrink-0" aria-hidden="true" />}
      </button>
      {actie}
    </div>
  );
}
