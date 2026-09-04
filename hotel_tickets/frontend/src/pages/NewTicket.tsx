import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Camera, ChevronDown, ChevronUp, X } from "lucide-react";
import { locationApi, ticketApi, userApi, type Category, type Priority, type UserRole } from "../api/client";
import AreaSelector from "../components/AreaSelector";
import MultiAreaSelector from "../components/MultiAreaSelector";
import { AFDELING_LABELS } from "../werk";

/**
 * Melden — drie velden in de volgorde waarin iemand met een telefoon denkt:
 * waar, wat, plaatje. De kamer stond eerder onderaan, ná de subtaken.
 *
 * De kamer begint leeg. Hij werd een tijd vooringevuld met de laatst gebruikte
 * kamer, achter een dichtgeklapte kiezer — en wie snel iets zonder locatie
 * meldde, kreeg ongemerkt de vorige kamer mee. Tickets stonden daardoor op de
 * verkeerde plek. De laatste kamer staat er nog wel, maar als één tikbare
 * suggestie boven de kiezer: je kiest hem bewust of je kiest hem niet.
 *
 * Afdeling en prioriteit staan op één regel achter "Wijzig", met als standaard
 * je eigen afdeling. Toewijzen en subtaken zitten achter diezelfde regel: dat
 * zijn supervisor-velden, geen meld-velden.
 */

const LAATSTE_KAMER = "hts.laatste_kamer";

/** Wat een ander scherm kan meegeven: Kamers stuurt de kamer, de kennisbot
 *  een titel, een logboek zijn object. */
type Prefill = {
  title?: string;
  description?: string;
  objectId?: string;
  /** Vanaf de Kamers-pagina: een expliciete keuze, dus wél vooringevuld. */
  locationId?: string;
};

const PRIORITEITEN: { value: Priority; label: string }[] = [
  { value: "low", label: "Laag" },
  { value: "medium", label: "Normaal" },
  { value: "high", label: "Hoog" },
  { value: "urgent", label: "Urgent" },
];

export default function Melden() {
  const navigate = useNavigate();
  const location = useLocation();
  // Optionele voorvulling, bijv. vanuit de Kennisbot ("Maak hier een ticket van")
  const prefill = (location.state as Prefill | null) ?? null;
  const laatsteKamer = localStorage.getItem(LAATSTE_KAMER) || null;

  const [form, setForm] = useState({
    title: prefill?.title ?? "",
    description: prefill?.description ?? "",
    category: "technical" as Category,
    priority: "medium" as Priority,
    location_id: prefill?.locationId ?? null,
    assigned_to: null as string | null,
    // Storing gemeld vanaf een logboek: het ticket telt mee in dat boek.
    object_id: prefill?.objectId ?? null,
  });
  const [users, setUsers] = useState<UserRole[]>([]);
  const [kamerNamen, setKamerNamen] = useState<Record<string, string>>({});
  const [afdelingGekozen, setAfdelingGekozen] = useState(false);
  const [multiRoom, setMultiRoom] = useState(false);
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
  // Open, tenzij de kamer al gekozen is (vanaf Kamers).
  const [kamerOpen, setKamerOpen] = useState(!prefill?.locationId);
  const [meerOpen, setMeerOpen] = useState(false);
  const [subtaskLabels, setSubtaskLabels] = useState<string[]>([]);
  const [newSubtask, setNewSubtask] = useState("");
  const [fotos, setFotos] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    userApi.list().then((r) => setUsers(r.data)).catch(() => {});
    locationApi.list()
      .then((r) => setKamerNamen(Object.fromEntries(r.data.map((l) => [l.id, l.name]))))
      .catch(() => {});
    userApi.me()
      .then((r) => {
        const eigen = r.data.department;
        if (eigen && !afdelingGekozen) setForm((f) => ({ ...f, category: eigen }));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addSubtask() {
    if (!newSubtask.trim()) return;
    setSubtaskLabels((prev) => [...prev, newSubtask.trim()]);
    setNewSubtask("");
  }

  function removeSubtask(idx: number) {
    setSubtaskLabels((prev) => prev.filter((_, i) => i !== idx));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) return;
    setSaving(true);
    setError("");
    try {
      const kamers = multiRoom && selectedRooms.length > 0 ? selectedRooms : [form.location_id];
      for (const roomId of kamers) {
        const r = await ticketApi.create({ ...form, location_id: roomId, subtask_labels: subtaskLabels.length ? subtaskLabels : undefined });
        // Foto's kunnen pas mee als het ticket bestaat.
        for (const f of fotos) {
          await ticketApi.uploadPhoto(r.data.id, f).catch(() => {});
        }
      }
      if (!multiRoom && form.location_id) localStorage.setItem(LAATSTE_KAMER, form.location_id);
      navigate("/tickets");
    } catch {
      setError("Melden mislukt. Probeer het opnieuw.");
      setSaving(false);
    }
  }

  const sortedUsers = [...users].sort((a, b) => a.display_name.localeCompare(b.display_name));
  const afdelingUsers = sortedUsers.filter((u) => u.department === form.category);
  const overigeUsers = sortedUsers.filter((u) => u.department !== form.category);

  const kamerLabel = multiRoom
    ? `${selectedRooms.length} kamers`
    : form.location_id
      ? (kamerNamen[form.location_id] ?? form.location_id)
      : "Geen kamer";

  const aantal = multiRoom ? selectedRooms.length : 0;
  const knopLabel = saving ? "Bezig…" : aantal > 1 ? `${aantal} meldingen maken` : "Melden";

  return (
    <div className="max-w-lg pb-32">
      <div className="flex items-center gap-1 -mt-2 mb-4">
        <button onClick={() => navigate(-1)} aria-label="Sluiten" className="tap -ml-2 text-ink-45 hover:text-ink">
          <X size={22} aria-hidden="true" />
        </button>
        <span className="meta">Melden</span>
      </div>

      <form onSubmit={submit} className="space-y-5">
        {/* 1 — Waar */}
        <section>
          <p className="mb-2.5 font-mono text-xs uppercase tracking-[0.14em] text-ink-45">Waar</p>
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-[1.4375rem] font-bold text-ink">{kamerLabel}</span>
            <button
              type="button"
              onClick={() => setKamerOpen(!kamerOpen)}
              className="tap px-2 -mx-2 text-meta text-ink-70 underline underline-offset-2"
            >
              Wijzig
            </button>
          </div>
          <p className="meta mt-1">
            <button
              type="button"
              onClick={() => { setMultiRoom(!multiRoom); setKamerOpen(true); }}
              className="underline underline-offset-2"
            >
              {multiRoom ? "één kamer kiezen" : "of kies meerdere kamers"}
            </button>
          </p>
          {/* De vorige kamer als suggestie: één tik, maar nooit ongemerkt. */}
          {laatsteKamer && !multiRoom && form.location_id !== laatsteKamer && (
            <button
              type="button"
              onClick={() => { setForm({ ...form, location_id: laatsteKamer }); setKamerOpen(false); }}
              className="chip mt-3"
            >
              Laatst: {kamerNamen[laatsteKamer] ?? laatsteKamer}
            </button>
          )}
          {kamerOpen && (
            <div className="mt-3">
              {multiRoom ? (
                <MultiAreaSelector value={selectedRooms} onChange={setSelectedRooms} />
              ) : (
                <AreaSelector value={form.location_id} onChange={(id) => setForm({ ...form, location_id: id })} />
              )}
            </div>
          )}
        </section>

        {/* 2 — Wat is er */}
        <section className="pt-5 border-t border-ink-12">
          <p className="mb-2.5 font-mono text-xs uppercase tracking-[0.14em] text-ink-45">Wat is er</p>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Bijv. kraan lekt"
            required
            className="w-full h-tapLg rounded-[10px] border border-ink-12 px-3 text-body bg-paper-raised
                       focus:outline-none focus:ring-2 focus:ring-brand"
          />
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="Meer details (optioneel)"
            rows={2}
            className="mt-2 w-full rounded-[10px] border border-ink-12 px-3 py-2 text-body bg-paper-raised resize-none
                       focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </section>

        {/* 3 — Foto */}
        <section className="pt-5 border-t border-ink-12">
          <div className="flex flex-wrap gap-2">
            {fotos.map((f, i) => (
              <div key={i} className="relative w-[5.5rem] h-[5.5rem] rounded-[10px] overflow-hidden border border-ink-12">
                <img src={URL.createObjectURL(f)} alt="" className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => setFotos((p) => p.filter((_, j) => j !== i))}
                  aria-label="Foto verwijderen"
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-ink/70 text-paper flex items-center justify-center"
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-[5.5rem] h-[5.5rem] rounded-[10px] border border-dashed border-ink-12 flex flex-col items-center justify-center gap-1 text-ink-45 hover:bg-ink-6"
            >
              <Camera size={22} aria-hidden="true" />
              <span className="text-[0.6875rem] font-medium">Foto maken</span>
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            onChange={(e) => { setFotos((p) => [...p, ...Array.from(e.target.files ?? [])]); e.target.value = ""; }}
            className="hidden"
          />
        </section>

        {/* 4 — Alles wat een supervisor invult, achter één regel */}
        <section className="pt-5 border-t border-ink-12">
          <button
            type="button"
            onClick={() => setMeerOpen(!meerOpen)}
            className="flex items-center gap-2 w-full min-h-tap text-left"
          >
            <span className="text-body text-ink">
              {AFDELING_LABELS[form.category]} · {PRIORITEITEN.find((p) => p.value === form.priority)?.label}
            </span>
            <span className="ml-auto flex items-center gap-1 meta">
              Wijzig
              {meerOpen ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
            </span>
          </button>

          {meerOpen && (
            <div className="mt-3 space-y-4">
              <div>
                <label className="meta block mb-1">Afdeling</label>
                <select
                  value={form.category}
                  onChange={(e) => { setAfdelingGekozen(true); setForm({ ...form, category: e.target.value as Category }); }}
                  className="w-full h-tap rounded-[10px] border border-ink-12 px-3 text-body bg-paper-raised"
                >
                  {(Object.keys(AFDELING_LABELS) as Category[]).map((c) => (
                    <option key={c} value={c}>{AFDELING_LABELS[c]}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="meta block mb-1">Prioriteit</label>
                <div className="flex gap-2 flex-wrap">
                  {PRIORITEITEN.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      onClick={() => setForm({ ...form, priority: p.value })}
                      aria-pressed={form.priority === p.value}
                      className={`chip ${form.priority === p.value ? "chip-aan" : ""}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="meta block mb-1">Toewijzen aan</label>
                <select
                  value={form.assigned_to ?? ""}
                  onChange={(e) => setForm({ ...form, assigned_to: e.target.value || null })}
                  className="w-full h-tap rounded-[10px] border border-ink-12 px-3 text-body bg-paper-raised"
                >
                  <option value="">Niemand</option>
                  {afdelingUsers.length > 0 && (
                    <optgroup label="Gekozen afdeling">
                      {afdelingUsers.map((u) => (
                        <option key={u.ha_user_id} value={u.ha_user_id}>{u.display_name}</option>
                      ))}
                    </optgroup>
                  )}
                  {overigeUsers.length > 0 && (
                    <optgroup label="Overige medewerkers">
                      {overigeUsers.map((u) => (
                        <option key={u.ha_user_id} value={u.ha_user_id}>{u.display_name}</option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>

              <div>
                <label className="meta block mb-1">Subtaken</label>
                {subtaskLabels.length > 0 && (
                  <ul className="space-y-1.5 mb-2">
                    {subtaskLabels.map((label, idx) => (
                      <li key={idx} className="flex items-center gap-2">
                        <span className="flex-1 min-h-tap flex items-center rounded-[10px] border border-ink-12 bg-paper-raised px-3 text-body">
                          {label}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeSubtask(idx)}
                          aria-label="Subtaak verwijderen"
                          className="tap text-ink-45 hover:text-urgent"
                        >
                          <X size={18} aria-hidden="true" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newSubtask}
                    onChange={(e) => setNewSubtask(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addSubtask())}
                    placeholder="Bijv. vloer dweilen"
                    className="flex-1 min-w-0 h-tap rounded-[10px] border border-ink-12 px-3 text-body bg-paper-raised"
                  />
                  <button
                    type="button"
                    onClick={addSubtask}
                    className="shrink-0 h-tap px-4 rounded-[10px] border border-ink text-ink text-meta font-semibold"
                  >
                    Toevoegen
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>

        {error && <p className="text-meta text-urgent">{error}</p>}

        {/* Primaire actie, vastgeplakt onderin */}
        <div
          className="fixed left-0 right-0 z-30 border-t border-ink-12 bg-paper/95 backdrop-blur px-4 py-2.5 md:left-[calc(4rem+220px)]"
          style={{ bottom: "var(--onderbalk)" }}
        >
          <div className="max-w-lg">
            <button
              type="submit"
              disabled={saving || !form.title.trim()}
              className="w-full h-[3.25rem] rounded-[10px] bg-ink text-paper text-body font-semibold disabled:opacity-50"
            >
              {knopLabel}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
