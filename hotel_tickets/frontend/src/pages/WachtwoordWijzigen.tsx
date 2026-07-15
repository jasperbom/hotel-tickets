import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../api/client";

const MIN_LENGTH = 8;

export default function WachtwoordWijzigen() {
  const navigate = useNavigate();
  const [current, setCurrent] = useState("");
  const [nieuw, setNieuw] = useState("");
  const [herhaal, setHerhaal] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (nieuw.length < MIN_LENGTH) {
      setError(`Het nieuwe wachtwoord moet minimaal ${MIN_LENGTH} tekens lang zijn`);
      return;
    }
    if (nieuw !== herhaal) {
      setError("De nieuwe wachtwoorden komen niet overeen");
      return;
    }
    setSaving(true);
    try {
      await authApi.changePassword(current, nieuw);
      setDone(true);
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Wachtwoord wijzigen mislukt — probeer het opnieuw");
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="card text-center py-10">
          <p className="text-4xl mb-3">✅</p>
          <h1 className="text-lg font-bold text-gray-900">Wachtwoord gewijzigd</h1>
          <p className="text-sm text-gray-600 mt-2">
            Gebruik voortaan je nieuwe wachtwoord — ook wanneer je in Home Assistant zelf inlogt.
          </p>
          <button onClick={() => navigate("/")} className="btn-primary mt-6">
            Terug naar overzicht
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="text-gray-500 hover:text-gray-700">←</button>
        <h1 className="text-xl font-bold text-gray-900">Wachtwoord wijzigen</h1>
      </div>

      <form onSubmit={submit} className="card space-y-4">
        <p className="text-sm text-gray-600">
          Dit wijzigt het wachtwoord van je Home Assistant-account, dus ook voor
          het inloggen in Home Assistant zelf.
        </p>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Huidig wachtwoord</label>
          <input
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            autoComplete="current-password"
            required
            className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Nieuw wachtwoord</label>
          <input
            type="password"
            value={nieuw}
            onChange={(e) => setNieuw(e.target.value)}
            autoComplete="new-password"
            required
            minLength={MIN_LENGTH}
            className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
          <p className="text-xs text-gray-400 mt-1">Minimaal {MIN_LENGTH} tekens</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Herhaal nieuw wachtwoord</label>
          <input
            type="password"
            value={herhaal}
            onChange={(e) => setHerhaal(e.target.value)}
            autoComplete="new-password"
            required
            className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex flex-wrap gap-2 pt-2">
          <button type="submit" disabled={saving} className="btn-primary flex-1 whitespace-nowrap">
            {saving ? "Wijzigen..." : "Wachtwoord wijzigen"}
          </button>
          <button type="button" onClick={() => navigate(-1)} className="btn-secondary">
            Annuleren
          </button>
        </div>
      </form>
    </div>
  );
}
