import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { sessionsApi, parseUTC, type Session } from "../api/client";

function timeAgo(iso: string): string {
  const secs = Math.max(0, Math.floor((Date.now() - parseUTC(iso).getTime()) / 1000));
  if (secs < 60) return "zojuist";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins} min geleden`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} uur geleden`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "gisteren" : `${days} dagen geleden`;
}

function deviceEmoji(device: string): string {
  const d = device.toLowerCase();
  if (d.includes("iphone") || d.includes("ipad") || d.includes("android") || d.includes("toestel"))
    return "📱";
  if (d.includes("mac") || d.includes("windows") || d.includes("linux") || d.includes("pc"))
    return "💻";
  return "🖥️";
}

export default function Apparaten() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const r = await sessionsApi.list();
      setSessions(r.data);
    } catch {
      setError("Kan de apparaten nu niet laden — probeer het later opnieuw.");
      setSessions([]);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function revoke(id: string) {
    setBusy(id);
    setError("");
    try {
      await sessionsApi.revoke(id);
      setSessions((prev) => (prev ?? []).filter((s) => s.id !== id));
    } catch {
      setError("Uitloggen mislukt — probeer het opnieuw.");
    } finally {
      setBusy(null);
    }
  }

  async function revokeOthers() {
    const others = (sessions ?? []).filter((s) => !s.current);
    setBusy("others");
    setError("");
    try {
      await Promise.all(others.map((s) => sessionsApi.revoke(s.id)));
    } catch {
      setError("Niet alle apparaten konden worden uitgelogd — probeer het opnieuw.");
    } finally {
      await load();
      setBusy(null);
    }
  }

  const others = (sessions ?? []).filter((s) => !s.current);

  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-700">
          ←
        </button>
        <h1 className="text-xl font-bold text-gray-900">Actieve apparaten</h1>
      </div>

      <div className="card space-y-4">
        <p className="text-sm text-gray-600">
          Dit zijn de apparaten waarop je nu bent ingelogd. Zolang je de app blijft gebruiken, blijf
          je op deze apparaten ingelogd. Herken je er één niet? Log het dan uit — dat apparaat moet
          daarna opnieuw inloggen.
        </p>

        {sessions === null ? (
          <p className="text-sm text-gray-400">Laden…</p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-gray-500">
            Geen actieve apparaten gevonden. Sessiebeheer geldt alleen wanneer je via de aparte
            loginpagina bent ingelogd (niet via Home Assistant zelf).
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {sessions.map((s) => (
              <div key={s.id} className="py-3 flex items-center gap-3">
                <span className="text-2xl shrink-0">{deviceEmoji(s.device)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {s.device}
                    {s.current && (
                      <span className="ml-2 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                        Dit apparaat
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500 truncate">
                    Laatst actief {timeAgo(s.last_seen_at)}
                    {s.ip ? ` · ${s.ip}` : ""}
                  </p>
                </div>
                {s.current ? (
                  <span className="text-xs text-gray-400 shrink-0">actief</span>
                ) : (
                  <button
                    onClick={() => revoke(s.id)}
                    disabled={busy === s.id}
                    className="text-sm text-red-600 hover:underline shrink-0 disabled:opacity-50"
                  >
                    {busy === s.id ? "Uitloggen…" : "Uitloggen"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        {others.length > 0 && (
          <button
            onClick={revokeOthers}
            disabled={busy === "others"}
            className="btn-secondary w-full disabled:opacity-50"
          >
            {busy === "others" ? "Bezig…" : `Alle andere apparaten uitloggen (${others.length})`}
          </button>
        )}
      </div>
    </div>
  );
}
