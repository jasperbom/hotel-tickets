import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { userApi, type UserRole } from "../api/client";

// Persoonlijke pushvoorkeuren die de medewerker zelf mag regelen. Het in-app
// envelopje (Berichten) blijft altijd bestaan; dit schakelt enkel de
// pushmelding op de telefoon in of uit.
type PushPref = "notify_push" | "notify_mention" | "notify_new_ticket" | "notify_direct_message";

const OPTIONS: { field: Exclude<PushPref, "notify_push">; icon: string; label: string; description: string }[] = [
  {
    field: "notify_mention",
    icon: "💬",
    label: "@-vermeldingen",
    description: "Krijg een pushbericht wanneer een collega je met @ noemt in een commentaar.",
  },
  {
    field: "notify_new_ticket",
    icon: "🎫",
    label: "Nieuwe tickets in mijn afdeling",
    description: "Krijg een pushbericht zodra er een nieuw ticket binnenkomt voor jouw afdeling.",
  },
  {
    field: "notify_direct_message",
    icon: "✉️",
    label: "Directe berichten van collega's",
    description: "Krijg een pushbericht bij een nieuw persoonlijk bericht van een collega.",
  },
];

function Toggle({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed ${
        checked ? "bg-blue-600" : "bg-gray-300"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
          checked ? "translate-x-5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

export default function Meldingen() {
  const navigate = useNavigate();
  const [me, setMe] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  useEffect(() => {
    userApi.me()
      .then((r) => setMe(r.data))
      .catch(() => setStatus("error"))
      .finally(() => setLoading(false));
  }, []);

  async function toggle(field: PushPref, value: boolean) {
    if (!me) return;
    const prev = me;
    setMe({ ...me, [field]: value } as UserRole); // optimistisch bijwerken
    setStatus("saving");
    try {
      const r = await userApi.update(me.ha_user_id, { [field]: value } as Partial<UserRole>);
      setMe(r.data);
      setStatus("saved");
    } catch {
      setMe(prev); // terugdraaien bij fout
      setStatus("error");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!me) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="card text-center py-10 text-gray-500">
          Kon je profiel niet laden. Probeer de pagina te vernieuwen.
        </div>
      </div>
    );
  }

  const pushOff = !me.notify_push;

  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-700">←</button>
        <h1 className="text-xl font-bold text-gray-900">Meldingen</h1>
      </div>

      {!me.ha_notify_service && (
        <div className="mb-4 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
          <span>ℹ️</span>
          <p>
            Er is nog geen pushkanaal aan je account gekoppeld, dus je ontvangt nu geen pushberichten op je
            telefoon. Vraag een beheerder om dit in te stellen — je kunt hieronder alvast je voorkeuren kiezen.
          </p>
        </div>
      )}

      {/* Hoofdschakelaar: alle pushberichten aan/uit */}
      <div className="card flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="font-semibold text-gray-900">Pushberichten op mijn telefoon</p>
          <p className="text-sm text-gray-500">
            Zet dit uit om helemaal geen pushberichten meer te ontvangen. Je blijft alles terugzien in de app.
          </p>
        </div>
        <Toggle
          checked={me.notify_push}
          onChange={(v) => toggle("notify_push", v)}
          label="Pushberichten op mijn telefoon"
        />
      </div>

      {/* Waar wil je een pushbericht van krijgen */}
      <div className="card mt-4 space-y-1">
        <p className="text-sm font-medium text-gray-700 mb-2">Waarvan wil je een pushbericht krijgen?</p>
        {OPTIONS.map((opt) => (
          <div
            key={opt.field}
            className={`flex items-center justify-between gap-4 py-3 border-t border-gray-100 first:border-t-0 ${
              pushOff ? "opacity-50" : ""
            }`}
          >
            <div className="min-w-0">
              <p className="font-medium text-gray-900 flex items-center gap-2">
                <span>{opt.icon}</span>
                <span>{opt.label}</span>
              </p>
              <p className="text-sm text-gray-500">{opt.description}</p>
            </div>
            <Toggle
              checked={me[opt.field]}
              disabled={pushOff}
              onChange={(v) => toggle(opt.field, v)}
              label={opt.label}
            />
          </div>
        ))}
      </div>

      <p className="text-xs text-gray-400 mt-3">
        @-vermeldingen en directe berichten blijf je altijd terugzien onder <strong>Berichten</strong> — deze
        instellingen bepalen alleen of je er ook een pushbericht van krijgt.
      </p>

      <div className="h-6 mt-3 text-sm">
        {status === "saving" && <span className="text-gray-400">Opslaan…</span>}
        {status === "saved" && <span className="text-green-600">✓ Opgeslagen</span>}
        {status === "error" && <span className="text-red-600">Opslaan mislukt — probeer het opnieuw.</span>}
      </div>
    </div>
  );
}
