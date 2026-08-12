import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { boardApi, type Board, type BoardKolom, type BoardTaak, type BoardTicket } from "../api/client";
import { leeftijdTekst } from "../werk";

/**
 * Wandscherm — één scherm aan de muur in de werkplaats of het
 * huishoudkantoor. Read-only: er valt niets af te vinken, dus er staat ook
 * geen knop op. De enige uitzondering is de weg terug naar de app, en die
 * verschijnt pas als er een muis beweegt.
 *
 * Het is Vandaag, maar dan gelezen op vier meter afstand. Daarom hetzelfde
 * leesmodel als de rest van de app (kamer → positie, titel → grootte,
 * prioriteit → kleur, eigendom → woord), alleen met alles maal een
 * schaalfactor. Een eigen ontwerp zou betekenen dat een monteur het bord
 * anders moet leren lezen dan zijn telefoon.
 *
 * De URL is de instelling — het scherm hangt op een vaste plek en heeft geen
 * gebruiker die iets aanklikt:
 *
 *   #/wandscherm                              eigen afdeling
 *   #/wandscherm?afdeling=technical           één afdeling
 *   #/wandscherm?afdeling=technical,housekeeping
 *   #/wandscherm?afdeling=all
 *   #/wandscherm?schaal=1.4                   groter, voor een verder scherm
 */

const VERVERS_MS = 30_000;

function heeftWerk(k: BoardKolom): boolean {
  return k.tickets.length > 0 || k.taken.length > 0;
}

/** Buiten dit bereik wordt het onleesbaar of past er niets meer op. */
function leesSchaal(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(2, Math.max(0.6, n));
}

/** Het scherm mag niet in slaap vallen; zonder wake lock dooft een tablet. */
function useSchermWakker() {
  useEffect(() => {
    // Niet elke browser kent de wake lock, en hij gaat verloren zodra het
    // tabblad naar de achtergrond gaat — dus opnieuw aanvragen bij terugkeer.
    let sentinel: { release: () => Promise<void> } | null = null;
    let gestopt = false;

    async function aanvragen() {
      const wl = (navigator as any).wakeLock;
      if (!wl || document.visibilityState !== "visible") return;
      try {
        const s = await wl.request("screen");
        if (gestopt) { s.release?.(); return; }
        sentinel = s;
      } catch {
        /* geweigerd of niet ondersteund — het scherm dooft dan gewoon */
      }
    }

    aanvragen();
    document.addEventListener("visibilitychange", aanvragen);
    return () => {
      gestopt = true;
      document.removeEventListener("visibilitychange", aanvragen);
      sentinel?.release().catch(() => {});
    };
  }, []);
}

/**
 * Een bord aan de muur heeft geen knoppen nodig, maar wie het scherm vanuit de
 * app opent zit anders vast: de navigatie is weg. De uitweg verschijnt daarom
 * pas bij beweging en verdwijnt weer — op een kiosk zonder muis blijft hij
 * onzichtbaar.
 */
function useBeweging(msZichtbaar = 4000): boolean {
  const [zichtbaar, setZichtbaar] = useState(false);
  useEffect(() => {
    let timer: number | null = null;
    function beweeg() {
      setZichtbaar(true);
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => setZichtbaar(false), msZichtbaar);
    }
    window.addEventListener("mousemove", beweeg);
    window.addEventListener("touchstart", beweeg);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("mousemove", beweeg);
      window.removeEventListener("touchstart", beweeg);
    };
  }, [msZichtbaar]);
  return zichtbaar;
}

/** Breed genoeg voor twee kolommen naast elkaar? Op een staande tablet niet. */
function useBreed(): boolean {
  const [breed, setBreed] = useState(() => window.innerWidth >= 1400);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1400px)");
    const luister = () => setBreed(mq.matches);
    mq.addEventListener("change", luister);
    return () => mq.removeEventListener("change", luister);
  }, []);
  return breed;
}

function useKlok(): Date {
  const [nu, setNu] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNu(new Date()), 10_000);
    return () => window.clearInterval(id);
  }, []);
  return nu;
}

export default function Wandscherm() {
  const params = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
  const afdeling = params.get("afdeling") ?? params.get("afdelingen") ?? undefined;
  const schaal = leesSchaal(params.get("schaal"));

  const [board, setBoard] = useState<Board | null>(null);
  const [fout, setFout] = useState(false);
  const [laatstGelukt, setLaatstGelukt] = useState<Date | null>(null);
  const nu = useKlok();
  const breed = useBreed();
  const uitwegZichtbaar = useBeweging();
  const navigate = useNavigate();
  useSchermWakker();

  const laden = useCallback(async () => {
    try {
      const r = await boardApi.get(afdeling);
      setBoard(r.data);
      setLaatstGelukt(new Date());
      setFout(false);
    } catch {
      // Bij een storing blijft het laatste bord staan — een leeg bord aan de
      // muur leest als "niets te doen", en dat is een gevaarlijker leugen dan
      // een bord dat een paar minuten oud is. De koptekst zegt hoe oud.
      setFout(true);
    }
  }, [afdeling]);

  useEffect(() => {
    laden();
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") laden();
    }, VERVERS_MS);
    return () => window.clearInterval(id);
  }, [laden]);

  const alle = board?.kolommen ?? [];
  // Bij één gekozen afdeling hoort "Niets open" er gewoon te staan — dat is de
  // stand van het bord dat je hebt opgehangen. Bij meerdere afdelingen is een
  // lege kolom alleen maar ruimte die de rest kleiner maakt.
  const kolommen = alle.length > 1 ? alle.filter(heeftWerk) : alle;
  // Bij één afdeling is een enkele kolom over 1600 px onleesbaar breed; die
  // splitsen we in twee. Op een staande tablet juist niet — daar wordt elke
  // titel dan een woordenslang van drie regels.
  const enkel = kolommen.length === 1;
  const tweekoloms = enkel && breed;
  // Drie afdelingen naast elkaar vraagt om een breed scherm; anders twee.
  const kolomKlasse =
    enkel ? "grid-cols-1"
    : kolommen.length === 2 || !breed ? "grid-cols-2"
    : "grid-cols-3";

  return (
    // Alle maten op deze pagina staan in em; hier staat de grondmaat. Die
    // groeit mee met de schermbreedte — een tablet naast de deur en een
    // 4K-scherm boven de werkbank vragen niet om dezelfde letter — en `schaal`
    // in de URL is het laatste duwtje bij het ophangen.
    <div
      className="h-[100dvh] overflow-hidden bg-paper text-ink flex flex-col"
      style={{ fontSize: `calc(${schaal} * clamp(1rem, 1.15vw, 1.9rem))` }}
    >
      <Kop
        nu={nu}
        kolommen={kolommen}
        laatstGelukt={laatstGelukt}
        fout={fout}
        bezig={board === null && !fout}
      />

      <main
        className={`flex-1 min-h-0 grid items-stretch gap-x-[2em] gap-y-[1.5em] p-[1.5em] ${
          kolomKlasse
        }`}
      >
        {board === null && !fout && (
          <p className="text-[1.5em] text-ink-45">Bord wordt geladen…</p>
        )}
        {board !== null && kolommen.length === 0 && (
          <p className="text-[1.5em] text-ink-45">
            {alle.length === 0 ? "Geen afdelingen gekozen." : "Niets open."}
          </p>
        )}
        {kolommen.map((k) => (
          <Kolom key={k.afdeling} kolom={k} tweekoloms={tweekoloms} toonLabel={!enkel} />
        ))}
      </main>

      {uitwegZichtbaar && (
        <button
          onClick={() => navigate("/")}
          className="fixed bottom-[1em] right-[1em] px-[1em] py-[0.5em] rounded-[0.5em]
                     bg-paper-raised border border-ink-12 text-[1em] text-ink-70
                     shadow-lg hover:bg-ink-6 transition-colors"
        >
          Terug naar de app
        </button>
      )}
    </div>
  );
}

function Kop({
  nu, kolommen, laatstGelukt, fout, bezig,
}: {
  nu: Date;
  kolommen: BoardKolom[];
  laatstGelukt: Date | null;
  fout: boolean;
  bezig: boolean;
}) {
  const titel = kolommen.length === 1 ? kolommen[0].label : "Openstaand werk";
  const open = kolommen.reduce((n, k) => n + k.tellers.open, 0);
  const urgent = kolommen.reduce((n, k) => n + k.tellers.urgent, 0);
  const klaar = kolommen.reduce((n, k) => n + k.tellers.afgerond_vandaag, 0);

  // "Bijgewerkt om 09:31" zegt niets zolang het klopt; pas als het bord
  // achterloopt hoort er iets te staan dat opvalt vanaf de deur.
  const seconden = laatstGelukt ? (nu.getTime() - laatstGelukt.getTime()) / 1000 : null;
  const verouderd = fout && seconden !== null && seconden > 120;

  return (
    <header className="flex items-baseline gap-[1em] px-[1.5em] pt-[1em] pb-[0.75em] border-b border-ink-12">
      <h1 className="text-[2em] font-bold leading-none">{titel}</h1>

      <div className="flex items-baseline gap-[0.9em] text-[1.1em] text-ink-70">
        <Teller aantal={open} label="open" />
        {urgent > 0 && <Teller aantal={urgent} label="urgent" kleur="text-urgent" />}
        {klaar > 0 && <Teller aantal={klaar} label="vandaag klaar" kleur="text-done" />}
      </div>

      <div className="ml-auto flex items-baseline gap-[0.8em]">
        {verouderd && (
          <span className="text-[1em] font-semibold text-urgent">
            Geen verbinding — bord is {Math.round(seconden! / 60)} min oud
          </span>
        )}
        {bezig && <span className="text-[1em] text-ink-45">verbinden…</span>}
        <span className="text-[1.05em] text-ink-45 first-letter:uppercase">
          {nu.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" })}
        </span>
        <span className="text-[2.2em] font-bold leading-none tabular-nums">
          {nu.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
    </header>
  );
}

function Teller({ aantal, label, kleur = "text-ink" }: { aantal: number; label: string; kleur?: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className={`font-bold tabular-nums ${kleur}`}>{aantal}</span>{" "}
      <span className="text-ink-45">{label}</span>
    </span>
  );
}

function Kolom({
  kolom, tweekoloms, toonLabel,
}: {
  kolom: BoardKolom;
  /** Eén afdeling op het bord: de rijen in twee kolommen naast elkaar. */
  tweekoloms: boolean;
  toonLabel: boolean;
}) {
  const regels = [
    ...kolom.taken.map((t) => <TaakRegel key={`taak-${t.id}`} taak={t} />),
    ...kolom.tickets.map((t) => <TicketRegel key={t.id} ticket={t} />),
  ];
  const { lijstRef, past } = usePassendAantal(kolom);
  const zichtbaar = regels.slice(0, past);
  // Alles wat niet op het bord past: wat de server al inkortte plus wat er hier
  // afvalt. Eén getal, want vanaf de deur is het verschil niet interessant.
  const verborgen = kolom.verborgen + (regels.length - zichtbaar.length);

  return (
    <section className="min-w-0 flex flex-col min-h-0">
      {toonLabel && (
        <h2 className="flex items-baseline gap-[0.6em] pb-[0.5em] mb-[0.5em] border-b-2 border-ink-12 shrink-0">
          <span className="text-[1.4em] font-bold">{kolom.label}</span>
          <span className="text-[1em] text-ink-45 tabular-nums">{kolom.tellers.open}</span>
          {kolom.tellers.urgent > 0 && (
            <span className="text-[1em] font-semibold text-urgent tabular-nums">
              {kolom.tellers.urgent} urgent
            </span>
          )}
        </h2>
      )}

      {regels.length === 0 ? (
        <p className="text-[1.3em] text-ink-45 py-[0.5em]">Niets open.</p>
      ) : (
        <div
          ref={lijstRef}
          className={`flex-1 min-h-0 overflow-hidden ${tweekoloms ? "columns-2 gap-x-[2em]" : ""}`}
        >
          {zichtbaar}
          {verborgen > 0 && (
            <p className="text-[1em] text-ink-45 pt-[0.4em]">
              + nog {verborgen} {verborgen === 1 ? "regel" : "regels"}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * Hoeveel regels passen er in de kolom?
 *
 * Een bord aan de muur scrollt niet, dus alles wat eronder valt is onzichtbaar
 * — en onzichtbaar werk op een werkbord is erger dan geen bord. Daarom knippen
 * we bewust af en zetten we eronder hoeveel er nog is.
 *
 * Het aantal wordt niet uitgerekend maar uitgeprobeerd: render alles, en zolang
 * de inhoud hoger is dan de kolom gaat er één regel af. Rijen zijn niet even
 * hoog (een lange titel loopt over twee regels) en de lettergrootte hangt aan
 * de schermbreedte; een berekening zou beide moeten nabootsen. Tijdens het
 * inkorten is de overloop al weggeknipt door overflow-hidden, dus je ziet er
 * niets van.
 */
function usePassendAantal(kolom: BoardKolom) {
  const lijstRef = useRef<HTMLDivElement>(null);
  const totaal = kolom.taken.length + kolom.tickets.length;
  const [past, setPast] = useState(totaal);

  // Opnieuw vanaf alles beginnen zodra de inhoud of het venster verandert —
  // anders blijft een bord dat ooit vol stond te weinig regels tonen.
  useLayoutEffect(() => setPast(totaal), [kolom, totaal]);
  useEffect(() => {
    const opnieuw = () => setPast(totaal);
    window.addEventListener("resize", opnieuw);
    return () => window.removeEventListener("resize", opnieuw);
  }, [totaal]);

  useLayoutEffect(() => {
    const el = lijstRef.current;
    if (!el) return;
    // +1 px speling: sub-pixelafronding maakte anders altijd één regel weg.
    if (el.scrollHeight > el.clientHeight + 1 && past > 1) setPast(past - 1);
  });

  return { lijstRef, past };
}

/** Dezelfde anatomie als WorkRow, alleen in em zodat de schaal alles meeneemt. */
function Regel({
  rand, kamer, titel, meta, voorvoegsel,
}: {
  rand: "urgent" | "high" | null;
  kamer?: string | null;
  titel: string;
  meta: (string | null)[];
  voorvoegsel?: string | null;
}) {
  const randKlasse =
    rand === "urgent" ? "border-l-[0.25em] border-l-urgent pl-[0.6em]"
    : rand === "high" ? "border-l-[0.25em] border-l-high pl-[0.6em]"
    : "pl-[0.85em]";
  const delen = meta.filter(Boolean) as string[];

  return (
    <div className={`break-inside-avoid py-[0.45em] border-b border-ink-6 ${randKlasse}`}>
      <div className="flex items-baseline gap-[0.4em]">
        {voorvoegsel && <span className="text-[1.3em] leading-tight shrink-0">{voorvoegsel}</span>}
        {kamer && (
          <span className="text-[1.3em] font-bold leading-tight shrink-0 max-w-[45%] truncate">
            {kamer}
          </span>
        )}
        <span className="text-[1.3em] leading-tight line-clamp-2">{titel}</span>
      </div>
      {delen.length > 0 && (
        <p className="text-[1em] text-ink-45 mt-[0.15em]">
          {delen.map((d, i) => (
            <span key={i}>
              {i > 0 && <span className="text-ink-25"> · </span>}
              {d}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function TicketRegel({ ticket }: { ticket: BoardTicket }) {
  const leeftijd = leeftijdTekst(ticket.created_at);
  const fractie =
    ticket.subtask_total ? `${ticket.subtask_done ?? 0}/${ticket.subtask_total}` : null;

  return (
    <Regel
      rand={ticket.priority === "urgent" ? "urgent" : ticket.priority === "high" ? "high" : null}
      kamer={ticket.kamer}
      titel={ticket.title}
      meta={[
        // Op een bord telt "van wie is dit" zwaarder dan op je eigen telefoon:
        // niemand leest hier "van mij", iedereen leest een naam.
        ticket.toegewezen_aan ?? "Vrij",
        ticket.status === "in_progress" ? "In behandeling" : null,
        fractie,
        leeftijd,
      ]}
    />
  );
}

function TaakRegel({ taak }: { taak: BoardTaak }) {
  const fractie = taak.subtask_total ? `${taak.subtask_done ?? 0}/${taak.subtask_total}` : null;
  const kamers = taak.kamers.length > 0 ? taak.kamers.join(", ") : null;

  return (
    <Regel
      rand={taak.priority === "urgent" ? "urgent" : taak.priority === "high" ? "high" : null}
      voorvoegsel={taak.emoji}
      kamer={taak.kamer}
      titel={taak.title}
      meta={["Vandaag", fractie, kamers]}
    />
  );
}
