import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { format } from "date-fns";
import { nl } from "date-fns/locale";
import { ChevronLeft, Printer } from "lucide-react";
import {
  locationApi, logbookApi, parseUTC, userApi,
  type LogEntry, type LogObject, type UserRole,
} from "../api/client";
import { AFDELING_LABELS, herhaalKort } from "../werk";
import { laatsteTekst } from "./Logboeken";

/**
 * Het objectdetail — dít is het boek.
 *
 * Dezelfde anatomie als het ticketdetail: naam groot, één metaregel,
 * geschiedenis in de vorm van het verloop, vaste acties onderin. Controles,
 * storingen en losse registraties staan door elkaar in één chronologie.
 *
 * Er is geen bewerk- of verwijderknop op een registratie. Fout gemaakt? Een
 * nieuwe regel: "correctie op 3 juli". Dat is wat het boek geloofwaardig maakt
 * tegenover een inspecteur.
 */

const TYPE_LABELS: Record<string, string> = {
  installatie: "Installatie",
  apparaat: "Apparaat",
  gereedschap: "Gereedschap",
};

const REGEL_LABELS: Record<string, string> = {
  controle: "Controle uitgevoerd",
  storing: "Storing verholpen",
  registratie: "Registratie",
  correctie: "Correctie",
};

export default function LogboekObject() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [obj, setObj] = useState<LogObject | null>(null);
  const [regels, setRegels] = useState<LogEntry[]>([]);
  const [users, setUsers] = useState<Record<string, string>>({});
  const [locaties, setLocaties] = useState<Record<string, string>>({});
  const [mij, setMij] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [nieuw, setNieuw] = useState<{ open: boolean; body: string; value: string; corrects: string | null }>({
    open: false, body: "", value: "", corrects: null,
  });
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  const laden = useCallback(async () => {
    if (!id) return;
    const o = await logbookApi.getObject(id);
    setObj(o.data);
    const [e, u, locs, me] = await Promise.allSettled([
      logbookApi.entries(id),
      userApi.list(),
      locationApi.list(),
      userApi.me(),
    ]);
    if (e.status === "fulfilled") setRegels(e.value.data);
    if (u.status === "fulfilled") setUsers(Object.fromEntries(u.value.data.map((x) => [x.ha_user_id, x.display_name])));
    if (locs.status === "fulfilled") setLocaties(Object.fromEntries(locs.value.data.map((l) => [l.id, l.name])));
    if (me.status === "fulfilled") setMij(me.value.data);
  }, [id]);

  useEffect(() => {
    laden().finally(() => setLoading(false));
  }, [laden]);

  const naam = (uid: string) => (uid === "system" ? "Home Assistant" : users[uid] ?? uid);

  const magSchrijven =
    !obj ? false
    : mij?.role === "admin" || mij?.role === "supervisor" ? true
    : !obj.department ? true
    : (mij?.departments ?? (mij?.department ? [mij.department] : [])).includes(obj.department);

  async function voegToe() {
    if (!id || !nieuw.body.trim()) return;
    setBezig(true);
    setFout(null);
    try {
      await logbookApi.addEntry(id, {
        type: nieuw.corrects ? "correctie" : "registratie",
        body: nieuw.body.trim(),
        value: nieuw.value.trim() || undefined,
        corrects_id: nieuw.corrects ?? undefined,
      });
      setNieuw({ open: false, body: "", value: "", corrects: null });
      await laden();
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      setFout(typeof detail === "string" ? detail : "Toevoegen mislukt");
    } finally {
      setBezig(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
      </div>
    );
  }
  if (!obj) return <p className="meta">Object niet gevonden.</p>;

  const metaregel = [
    obj.location_id ? (locaties[obj.location_id] ?? obj.location_id) : null,
    TYPE_LABELS[obj.type],
    herhaalKort(obj.schedule ?? undefined),
    obj.department ? AFDELING_LABELS[obj.department] : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="max-w-2xl pb-40">
      <div className="flex items-center gap-1 -mt-2 mb-3 print:hidden">
        <button onClick={() => navigate("/logboeken")} aria-label="Terug" className="tap -ml-2 text-ink-45 hover:text-ink">
          <ChevronLeft size={24} aria-hidden="true" />
        </button>
        <span className="meta">Logboek</span>
        <button
          onClick={() => window.print()}
          title="Afdrukken of als PDF opslaan"
          className="ml-auto tap px-2 text-ink-45 hover:text-ink"
        >
          <Printer size={20} aria-hidden="true" />
        </button>
      </div>

      {obj.overdue && (
        <p className="mb-4 rounded-[10px] bg-urgent-soft px-4 py-3 text-meta text-urgent font-medium">
          {obj.open_tickets} openstaand{obj.open_tickets === 1 ? " punt" : "e punten"} — staat op Vandaag.
        </p>
      )}

      <h1 className="text-3xl font-bold text-ink leading-tight">{obj.name}</h1>
      <p className="meta mt-1.5">{metaregel}</p>
      {obj.serial && <p className="meta">Serienummer {obj.serial}</p>}
      {obj.description && <p className="mt-3 text-body text-ink-70 whitespace-pre-wrap">{obj.description}</p>}

      <section className="mt-5 pt-5 border-t border-ink-12">
        <p className="mb-3 font-mono text-xs uppercase tracking-[0.14em] text-ink-45">
          Geschiedenis
          <span className="ml-2 normal-case tracking-normal font-sans">{laatsteTekst(obj)}</span>
        </p>

        {regels.length === 0 ? (
          <p className="meta">Nog geen regels in dit boek.</p>
        ) : (
          <ol className="space-y-3">
            {regels.map((r) => {
              const gecorrigeerd = regels.some((x) => x.corrects_id === r.id);
              return (
                <li key={r.id} className="flex gap-3">
                  <span className="meta shrink-0 tabular-nums w-[4.5rem]">
                    {format(parseUTC(r.created_at), "d MMM", { locale: nl })}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-meta text-ink-70">
                      {REGEL_LABELS[r.type]} · {naam(r.actor_id)}
                      {gecorrigeerd && <span className="text-high"> · later gecorrigeerd</span>}
                    </span>
                    {r.body && <span className="block text-body text-ink">{r.body}</span>}
                    {r.value && <span className="block meta">Waarde: {r.value}</span>}
                    {r.corrects_id && (
                      <span className="block meta">
                        Corrigeert de regel van{" "}
                        {(() => {
                          const oud = regels.find((x) => x.id === r.corrects_id);
                          return oud ? format(parseUTC(oud.created_at), "d MMMM yyyy", { locale: nl }) : "eerder";
                        })()}
                      </span>
                    )}
                  </span>
                  {magSchrijven && !r.corrects_id && (
                    <button
                      onClick={() => setNieuw({ open: true, body: "", value: "", corrects: r.id })}
                      className="meta shrink-0 hover:text-ink print:hidden"
                      title="Een regel is onwisbaar; een fout zet je recht met een correctie"
                    >
                      corrigeer
                    </button>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {nieuw.open && (
        <section className="mt-5 pt-5 border-t border-ink-12 space-y-2 print:hidden">
          <p className="text-sm font-medium text-ink">
            {nieuw.corrects ? "Correctie toevoegen" : "Registratie toevoegen"}
          </p>
          <textarea
            autoFocus
            rows={3}
            value={nieuw.body}
            onChange={(e) => setNieuw({ ...nieuw, body: e.target.value })}
            placeholder={nieuw.corrects ? "Wat klopte er niet, en wat is het wel?" : "Wat is er gedaan of vastgesteld?"}
            className="w-full rounded-[10px] border border-ink-12 px-3 py-2 text-body resize-none focus:outline-none focus:ring-2 focus:ring-brand"
          />
          <input
            value={nieuw.value}
            onChange={(e) => setNieuw({ ...nieuw, value: e.target.value })}
            placeholder="Meetwaarde (optioneel), bijv. accuspanning 13,6 V"
            className="w-full h-tap rounded-[10px] border border-ink-12 px-3 text-body focus:outline-none focus:ring-2 focus:ring-brand"
          />
          {fout && <p className="text-meta text-urgent">{fout}</p>}
          <div className="flex gap-2">
            <button
              onClick={voegToe}
              disabled={bezig || !nieuw.body.trim()}
              className="h-tapLg px-4 rounded-[10px] bg-ink text-paper text-meta font-semibold disabled:opacity-50"
            >
              {bezig ? "Bezig…" : "Vastleggen"}
            </button>
            <button
              onClick={() => { setNieuw({ open: false, body: "", value: "", corrects: null }); setFout(null); }}
              className="h-tapLg px-4 rounded-[10px] border border-ink-12 text-ink-70 text-meta font-semibold"
            >
              Annuleren
            </button>
          </div>
          <p className="meta">
            Regels in dit boek zijn onwisbaar. Een fout zet je recht met een correctie, niet met een wijziging.
          </p>
        </section>
      )}

      {/* Vaste acties onderin, net als op het ticketdetail */}
      {!nieuw.open && (
        <div
          className="fixed left-0 right-0 z-30 border-t border-ink-12 bg-paper/95 backdrop-blur px-4 py-2.5 md:left-[calc(4rem+220px)] print:hidden"
          style={{ bottom: "calc(3.5rem + env(safe-area-inset-bottom, 0px))" }}
        >
          <div className="max-w-2xl flex gap-2">
            {magSchrijven && (
              <button
                onClick={() => setNieuw({ open: true, body: "", value: "", corrects: null })}
                className="flex-1 h-[3.25rem] rounded-[10px] bg-ink text-paper text-body font-semibold"
              >
                Registratie toevoegen
              </button>
            )}
            <button
              onClick={() => navigate("/tickets/new", { state: { objectId: obj.id, title: `${obj.name}: ` } })}
              className="flex-1 h-[3.25rem] rounded-[10px] border border-ink text-ink text-body font-semibold"
            >
              Storing melden
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
