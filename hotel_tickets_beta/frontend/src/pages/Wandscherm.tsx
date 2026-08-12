import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { boardApi, type Board, type BoardKolom, type BoardTaak, type BoardTicket } from "../api/client";
import { isNieuw, leeftijdBoard } from "../werk";

/**
 * Wandscherm — één scherm aan de muur in de werkplaats of het
 * huishoudkantoor. Read-only: er valt niets af te vinken, dus er staat ook
 * geen knop op. De enige uitzondering is de weg terug naar de app, en die
 * verschijnt pas als er een muis beweegt.
 *
 * Het is Vandaag, maar dan gelezen op vier meter afstand. Daarom hetzelfde
 * leesmodel als de rest van de app (kamer → positie, titel → grootte,
 * prioriteit → kleur, eigendom → woord, bezetting → stip), alleen met alles
 * maal een schaalfactor. Een eigen ontwerp zou betekenen dat een monteur het bord
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
 *   #/wandscherm?sleutel=hbk.…                scherm zonder login (kiosk)
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

function useVensterBreedte(): number {
  const [breedte, setBreedte] = useState(() => window.innerWidth);
  useEffect(() => {
    const meet = () => setBreedte(window.innerWidth);
    window.addEventListener("resize", meet);
    return () => window.removeEventListener("resize", meet);
  }, []);
  return breedte;
}

/**
 * Hoeveel kolommen krijgt één afdeling voor zijn lijsten?
 *
 * Vier kopjes onder elkaar kosten ruimte die anders naar regels ging. Is de
 * afdelingskolom breed genoeg, dan lopen de lijsten naast elkaar door — dan
 * past ongeveer het dubbele aan werk op hetzelfde scherm. Onder die breedte
 * wordt elke titel een woordenslang van drie regels en schiet je er niets mee
 * op.
 */
const MIN_SUBKOLOM = 620;

/**
 * Kolombreedte naar rato van het werk dat erin staat.
 *
 * Bij gelijke kolommen staat de huishouding half leeg terwijl de technische
 * dienst regels moet weglaten — het bord toont dan minder werk dan er ruimte
 * is. De drukste afdeling krijgt daarom de meeste breedte, maar begrensd:
 * een rustige afdeling blijft leesbaar in plaats van een streepje te worden.
 */
function kolomGewichten(kolommen: BoardKolom[]): number[] {
  const werk = kolommen.map((k) => Math.max(1, k.taken.length + k.tickets.length));
  const gemiddeld = werk.reduce((a, b) => a + b, 0) / werk.length;
  return werk.map((n) => Math.min(2, Math.max(0.65, n / gemiddeld)));
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
  // Kioskcode: een scherm dat niet kan inloggen (Chromecast, TV-stick, tablet
  // die niemand meer aanraakt). Zie Instellingen → Wandschermen.
  const sleutel = params.get("sleutel") ?? undefined;
  const schaal = leesSchaal(params.get("schaal"));

  const [board, setBoard] = useState<Board | null>(null);
  const [fout, setFout] = useState(false);
  const [afgewezen, setAfgewezen] = useState(false);
  const [laatstGelukt, setLaatstGelukt] = useState<Date | null>(null);
  const nu = useKlok();
  const vensterBreedte = useVensterBreedte();
  const uitwegZichtbaar = useBeweging();
  const navigate = useNavigate();
  useSchermWakker();

  const laden = useCallback(async () => {
    try {
      const r = await boardApi.get(afdeling, sleutel);
      setBoard(r.data);
      setLaatstGelukt(new Date());
      setFout(false);
      setAfgewezen(false);
    } catch (err) {
      // Bij een storing blijft het laatste bord staan — een leeg bord aan de
      // muur leest als "niets te doen", en dat is een gevaarlijker leugen dan
      // een bord dat een paar minuten oud is. De koptekst zegt hoe oud.
      setFout(true);
      // Een geweigerde kioskcode is geen storing die overwaait: dan moet er
      // iemand naar Instellingen. Blijven pogen heeft geen zin, dus zeg het.
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 401 || status === 403) setAfgewezen(true);
    }
  }, [afdeling, sleutel]);

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
  const enkel = kolommen.length === 1;
  // Drie afdelingen naast elkaar vraagt om een breed scherm; anders twee.
  const perRij = enkel ? 1 : Math.min(kolommen.length, vensterBreedte < 1400 ? 2 : 3);
  // Ongelijke breedtes alleen als alle afdelingen op één rij staan; over twee
  // rijen zouden de kolommen niet meer onder elkaar uitlijnen.
  const gewichten = kolommen.length === perRij ? kolomGewichten(kolommen) : null;
  const somGewicht = gewichten ? gewichten.reduce((a, b) => a + b, 0) : perRij;
  const kolomStijl = gewichten
    ? { gridTemplateColumns: gewichten.map((g) => `${g}fr`).join(" ") }
    : { gridTemplateColumns: `repeat(${perRij}, minmax(0, 1fr))` };

  // 1,5em padding links en rechts, 2em tussen de afdelingen — bij een
  // grondmaat van ruwweg 22 px.
  const beschikbaar = vensterBreedte - 66 - 44 * (perRij - 1);
  const kolomBreedte = (i: number) =>
    beschikbaar * ((gewichten ? gewichten[i] : 1) / somGewicht);

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
        afgewezen={afgewezen}
        bezig={board === null && !fout}
      />

      <main
        // auto-rows-fr: zonder vaste rijhoogte groeit de rij mee met zijn
        // inhoud, en dan bijt het inkorten zichzelf in de staart — elke regel
        // die eraf gaat maakt de kolom lager, waardoor er weer een regel af
        // moet. Het bord stopte dan halverwege met een half leeg scherm.
        className="flex-1 min-h-0 grid auto-rows-fr items-stretch gap-x-[2em] gap-y-[1.5em] p-[1.5em]"
        style={kolomStijl}
      >
        {board === null && !fout && (
          <p className="col-span-full text-[1.5em] text-ink-45">Bord wordt geladen…</p>
        )}
        {board === null && fout && (
          <p className="col-span-full text-[1.5em] text-ink-45">
            {afgewezen
              ? "Dit scherm mag het bord niet lezen. Maak een nieuwe kioskcode aan bij Instellingen → Wandschermen."
              : "Geen verbinding met de app."}
          </p>
        )}
        {board !== null && kolommen.length === 0 && (
          <p className="col-span-full text-[1.5em] text-ink-45">
            {alle.length === 0 ? "Geen afdelingen gekozen." : "Niets open."}
          </p>
        )}
        {kolommen.map((k, i) => (
          <Kolom
            key={k.afdeling}
            kolom={k}
            // Twee lijstkolommen naast elkaar zodra deze afdeling daar breed
            // genoeg voor is — dat scheelt vier kopjes aan verticale ruimte.
            tweekoloms={kolomBreedte(i) >= MIN_SUBKOLOM * 2}
            toonLabel={!enkel}
          />
        ))}
      </main>

      {/* Een kioskscherm heeft geen app om naar terug te gaan: daar zou de
          knop alleen maar op de loginpagina uitkomen. */}
      {uitwegZichtbaar && !sleutel && (
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
  nu, kolommen, laatstGelukt, fout, afgewezen, bezig,
}: {
  nu: Date;
  kolommen: BoardKolom[];
  laatstGelukt: Date | null;
  fout: boolean;
  afgewezen: boolean;
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
        {kolommen.length > 0 && <Teller aantal={open} label="open" />}
        {urgent > 0 && <Teller aantal={urgent} label="urgent" kleur="text-urgent" />}
        {klaar > 0 && <Teller aantal={klaar} label="vandaag klaar" kleur="text-done" />}
      </div>

      <div className="ml-auto flex items-baseline gap-[0.8em]">
        {afgewezen ? (
          <span className="text-[1em] font-semibold text-urgent">
            Kioskcode ingetrokken
          </span>
        ) : verouderd && (
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

/**
 * De vier lijsten op het bord, in vaste volgorde.
 *
 * Eén regel staat in precies één lijst: urgent gaat vóór nieuw, nieuw vóór de
 * rest. Zonder die volgorde zou een urgente melding van vanochtend twee keer
 * op het bord staan, en dan telt niemand het bord meer na.
 */
type Sectie = { id: string; titel: string; regels: React.ReactNode[] };

function secties(kolom: BoardKolom): Sectie[] {
  const urgent = kolom.tickets.filter((t) => t.priority === "urgent" || t.priority === "high");
  const rest = kolom.tickets.filter((t) => t.priority !== "urgent" && t.priority !== "high");
  const nieuw = rest.filter((t) => isNieuw(t.created_at));
  const overig = rest.filter((t) => !isNieuw(t.created_at));

  const ticket = (t: BoardTicket) => <TicketRegel key={t.id} ticket={t} />;

  return [
    {
      id: "herhalend",
      titel: "Herhalende taken",
      regels: kolom.taken.map((t) => <TaakRegel key={`taak-${t.id}`} taak={t} />),
    },
    { id: "urgent", titel: "Urgent", regels: urgent.map(ticket) },
    { id: "overig", titel: "Andere taken", regels: overig.map(ticket) },
    { id: "nieuw", titel: "Nieuw — afgelopen 24 uur", regels: nieuw.map(ticket) },
  ];
}

function Kolom({
  kolom, tweekoloms, toonLabel,
}: {
  kolom: BoardKolom;
  /** Eén afdeling op het bord: de lijsten in twee kolommen naast elkaar. */
  tweekoloms: boolean;
  toonLabel: boolean;
}) {
  const alle = secties(kolom).filter((sec) => sec.regels.length > 0);
  const restIndex = Math.max(0, alle.findIndex((sec) => sec.id === "overig"));
  const { lijstRef, limieten } = usePassendeSecties(kolom, alle);
  const leeg = alle.length === 0;

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

      {leeg ? (
        <p className="text-[1.3em] text-ink-45 py-[0.5em]">Niets open.</p>
      ) : (
        <div
          ref={lijstRef}
          className={`flex-1 min-h-0 overflow-hidden ${tweekoloms ? "columns-2 gap-x-[2em]" : ""}`}
        >
          {alle.map((sec, i) => {
            const limiet = limieten[i] ?? sec.regels.length;
            const verborgen = sec.regels.length - limiet
              // Wat de server al inkortte hoort bij de lijst die de bovengrens
              // van 30 raakte: normaal "Andere taken", maar bij dertig urgente
              // meldingen bestaat die lijst niet en zou het getal verdwijnen.
              + (i === restIndex ? kolom.verborgen : 0);
            return (
              <div key={sec.id} className="break-inside-avoid-column mb-[0.9em] last:mb-0">
                <h3 className="flex items-baseline gap-[0.5em] mb-[0.15em]">
                  <span className="text-[0.95em] font-semibold uppercase tracking-[0.08em] text-ink-45">
                    {sec.titel}
                  </span>
                  <span className="text-[0.95em] text-ink-25 tabular-nums">{sec.regels.length}</span>
                </h3>
                {sec.regels.slice(0, limiet)}
                {verborgen > 0 && (
                  <p className="text-[0.95em] text-ink-45 pt-[0.3em]">
                    + nog {verborgen} {verborgen === 1 ? "regel" : "regels"}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

/**
 * Hoeveel regels past elke lijst?
 *
 * Een bord aan de muur scrollt niet, dus alles wat eronder valt is onzichtbaar
 * — en onzichtbaar werk op een werkbord is erger dan geen bord. Daarom knippen
 * we bewust af en zetten we per lijst hoeveel er nog is.
 *
 * Het inkorten gaat om beurten bij de langste lijst, niet onderaan het bord:
 * anders zou "Nieuw" als laatste lijst compleet verdwijnen zodra de technische
 * dienst een drukke week heeft, en dat is precies de lijst waar iemand op kijkt.
 * Elke niet-lege lijst houdt daarom minstens één regel.
 *
 * De aantallen worden niet berekend maar uitgeprobeerd: rijen zijn niet even
 * hoog (een lange titel loopt over twee regels) en de lettergrootte hangt aan
 * de schermbreedte. Tijdens het inkorten is de overloop al weggeknipt door
 * overflow-hidden, dus je ziet er niets van.
 */
function usePassendeSecties(kolom: BoardKolom, lijsten: Sectie[]) {
  const lijstRef = useRef<HTMLDivElement>(null);
  const vol = lijsten.map((sec) => sec.regels.length);
  const [limieten, setLimieten] = useState<number[]>(vol);

  // Opnieuw vanaf alles beginnen zodra de inhoud of het venster verandert —
  // anders blijft een bord dat ooit vol stond te weinig regels tonen.
  const vorm = vol.join(",");
  useLayoutEffect(() => setLimieten(vol.slice()), [kolom, vorm]);
  useEffect(() => {
    const opnieuw = () => setLimieten(vol.slice());
    window.addEventListener("resize", opnieuw);
    return () => window.removeEventListener("resize", opnieuw);
  }, [vorm]);

  useLayoutEffect(() => {
    const el = lijstRef.current;
    if (!el) return;
    // +1 px speling: sub-pixelafronding maakte anders altijd één regel weg.
    if (el.scrollHeight <= el.clientHeight + 1) return;

    // Haal er één af bij de langste lijst die er nog eentje kan missen.
    let langste = -1;
    limieten.forEach((n, i) => {
      if (n > 1 && (langste === -1 || n > limieten[langste])) langste = i;
    });
    if (langste === -1) return;
    const volgende = limieten.slice();
    volgende[langste] -= 1;
    setLimieten(volgende);
  });

  return { lijstRef, limieten };
}

/**
 * Dezelfde anatomie als WorkRow, alleen in em zodat de schaal alles meeneemt.
 *
 * De metaregel is op het bord bewust minder stil dan in de app. Op je telefoon
 * open je een ticket om te zien hoe het ervoor staat; vanaf vier meter is deze
 * regel het enige wat je krijgt. Daarom staan urgentie, eigenaar en status er
 * in kleur en vet tussen het grijs — niet als versiering, maar omdat dat de
 * drie dingen zijn waarop iemand vanaf de deur beslist of hij gaat lopen.
 *
 * Die delen staan niet achter elkaar met puntjes ertussen, maar verdeeld over
 * de hele breedte van de regel. Een woordenrij moet je van links naar rechts
 * lezen; kolommen scan je van boven naar beneden. De naam staat op elke regel
 * op ongeveer dezelfde plek, dus wie zoekt "is er nog iets vrij?" kijkt één
 * keer omlaag in plaats van vijf regels uit elkaar te pluizen. Een deel dat er
 * niet is laat zijn kolom leeg in plaats van de rest op te schuiven — anders
 * schuift de uitlijning per regel weer weg.
 */
/**
 * Staat de kamer leeg?
 *
 * Dezelfde taal als WorkRow in de app: gevuld = bezet, open ring = vrij,
 * niets = geen keycard-sensor. Op het bord hoort dit op de eerste regel,
 * direct achter het kamernummer, want het is geen eigenschap van het werk
 * maar van de kamer — en het is de laatste vraag vóór je gaat lopen.
 *
 * Bewust dezelfde vorm als in de app en niet het woord "vrij": dat woord staat
 * op de metaregel al voor een ticket dat niemand heeft opgepakt, en twee keer
 * "vrij" op één regel met twee betekenissen is erger dan een stip die je één
 * keer moet leren. Wel groter dan in de app — een stip van acht pixels bestaat
 * niet meer op vier meter afstand.
 */
function BezetStip({ bezet }: { bezet: boolean | null | undefined }) {
  if (bezet === null || bezet === undefined) return null;
  return (
    <span
      title={bezet ? "Kamer is bezet" : "Kamer is vrij"}
      className={`w-[0.8em] h-[0.8em] rounded-full shrink-0 -translate-y-[0.1em] ${
        bezet ? "bg-ink" : "border-[0.22em] border-ink"
      }`}
    />
  );
}

type MetaDeel = {
  tekst: string;
  klasse?: string;
  /**
   * Mag over meerdere regels: voor een deel dat geen woord maar een lijst is
   * (de kamers van een herhaaltaak). Zo'n lijst kan langer zijn dan de kolom
   * breed is, en dan houdt "nooit smaller dan de inhoud" op te werken: hij
   * zou tot de rand doorlopen en daar afgesneden worden. Afbreken kost een
   * regel hoogte en bewaart alle kamernummers.
   */
  wikkel?: boolean;
} | null;

/**
 * Breedteverhouding van de metakolommen. De meta-array van een regel loopt
 * hiermee in de pas: even lang, dezelfde volgorde, `null` waar de kolom leeg
 * blijft. Niet gelijk verdeeld — "In behandeling" heeft meer nodig dan
 * "Spoed", en een kolom die te krap is kapt af terwijl de buurman leeg staat.
 *
 * Het is een verdeling van de vrije ruimte, geen keurslijf: een kolom wordt
 * nooit smaller dan wat erin staat (`min-width: max-content`). Een lange naam
 * duwt zijn buren dus een stukje op in plaats van "Marieke van Don…" te
 * worden — op een bord is het afgekapte deel meestal net het stuk dat je
 * zocht. Dat kost een beetje uitlijning op de regels waar het niet past, en
 * dat is de goedkoopste van de twee.
 */
//                       urgentie eigenaar status voortgang leeftijd
const TICKET_KOLOMMEN = [0.7,     1.25,    1.15,  0.55,     0.85];
//                     voortgang kamers
const TAAK_KOLOMMEN = [0.5,      1.5];

function Regel({
  rand, kamer, bezet, titel, meta, kolommen, voorvoegsel,
}: {
  rand: "urgent" | "high" | null;
  kamer?: string | null;
  /** Keycard van die kamer: true = bezet, false = vrij, null = geen sensor. */
  bezet?: boolean | null;
  titel: string;
  meta: MetaDeel[];
  /** Breedteverhouding per metakolom, even lang als `meta`. */
  kolommen: number[];
  voorvoegsel?: string | null;
}) {
  const randKlasse =
    rand === "urgent" ? "border-l-[0.25em] border-l-urgent pl-[0.6em]"
    : rand === "high" ? "border-l-[0.25em] border-l-high pl-[0.6em]"
    : "pl-[0.85em]";

  return (
    <div className={`break-inside-avoid py-[0.45em] border-b border-ink-6 ${randKlasse}`}>
      <div className="flex items-baseline gap-[0.4em]">
        {voorvoegsel && <span className="text-[1.3em] leading-tight shrink-0">{voorvoegsel}</span>}
        {kamer && (
          <span className="text-[1.3em] font-bold leading-tight shrink-0 max-w-[45%] truncate">
            {kamer}
          </span>
        )}
        {kamer && <BezetStip bezet={bezet} />}
        <span className="text-[1.3em] leading-tight line-clamp-2">{titel}</span>
      </div>
      {meta.some(Boolean) && (
        // flex-wrap is de noodklep: past de regel echt niet meer op één lijn
        // (smalle kolom, lange naam), dan valt het laatste deel eronder in
        // plaats van weg te lopen achter de rand van het bord.
        <div className="flex flex-wrap items-baseline gap-x-[0.5em] mt-[0.2em] text-[1em] text-ink-45">
          {meta.map((d, i) => (
            <span
              key={i}
              // De laatste kolom rechts uitgelijnd, zodat de regel net zo vlak
              // eindigt als hij begint — anders bungelt de leeftijd ergens in
              // het midden en oogt het bord scheef.
              className={`${d?.wikkel ? "min-w-0" : "truncate"} ${
                i === meta.length - 1 ? "text-right" : ""} ${d?.klasse ?? ""}`}
              // Basis 0 + groeifactor: de vrije ruimte wordt over de kolommen
              // verdeeld in plaats van achter het laatste woord te blijven
              // liggen. min-width houdt de inhoud heel (zie boven).
              style={{ flex: `${kolommen[i] ?? 1} 1 0%`, minWidth: d?.wikkel ? 0 : "max-content" }}
            >
              {d?.tekst}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function TicketRegel({ ticket }: { ticket: BoardTicket }) {
  const fractie =
    ticket.subtask_total ? `${ticket.subtask_done ?? 0}/${ticket.subtask_total}` : null;

  return (
    <Regel
      rand={ticket.priority === "urgent" ? "urgent" : ticket.priority === "high" ? "high" : null}
      kamer={ticket.kamer}
      bezet={ticket.kamer_bezet}
      titel={ticket.title}
      kolommen={TICKET_KOLOMMEN}
      meta={[
        // Urgentie eerst: in de lijst "Urgent" staan spoed en hoog door elkaar,
        // en dat verschil bepaalt of iemand nu loopt of straks.
        ticket.priority === "urgent" ? { tekst: "Spoed", klasse: "font-semibold text-urgent" }
        : ticket.priority === "high" ? { tekst: "Hoog", klasse: "font-semibold text-high" }
        : null,
        // Op een bord telt "van wie is dit" zwaarder dan op je eigen telefoon:
        // niemand leest hier "van mij", iedereen leest een naam. Een naam krijgt
        // daarom nadruk; "Vrij" is de afwezigheid daarvan en blijft grijs.
        ticket.toegewezen_aan
          ? { tekst: ticket.toegewezen_aan, klasse: "font-semibold text-ink" }
          : { tekst: "Vrij" },
        ticket.status === "in_progress"
          ? { tekst: "In behandeling", klasse: "font-semibold text-brand" }
          : null,
        fractie ? { tekst: fractie } : null,
        { tekst: leeftijdBoard(ticket.created_at) },
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
      bezet={taak.kamer_bezet}
      titel={taak.title}
      kolommen={TAAK_KOLOMMEN}
      meta={[
        fractie ? { tekst: fractie } : null,
        kamers ? { tekst: kamers, wikkel: true } : null,
      ]}
    />
  );
}
