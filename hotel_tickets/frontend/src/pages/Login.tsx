import { useEffect, useState } from "react";
import { authApi, brandingApi, setSessionToken } from "../api/client";

/**
 * Standalone loginpagina voor toegang buiten HA ingress om (LAN).
 * Personeel logt in met hun Home Assistant gebruikersnaam en wachtwoord;
 * de backend verifieert dit via de Supervisor auth-API en geeft een
 * sessietoken terug.
 */
export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [logo, setLogo] = useState<string | null>(null);

  useEffect(() => {
    brandingApi.get().then((r) => {
      if (r.data.brand_logo) setLogo(r.data.brand_logo);
    }).catch(() => {});
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setError(null);
    setLoading(true);
    try {
      const r = await authApi.login(username.trim(), password);
      setSessionToken(r.data.token);
      // Volledige herlaad zodat de app opnieuw opstart met de sessie
      window.location.hash = "#/";
      window.location.reload();
    } catch (err: any) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : "Inloggen mislukt — probeer het opnieuw");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl shadow-lg p-8 space-y-6">
          <div className="text-center space-y-2">
            {logo ? (
              <img src={logo} alt="Logo" className="h-16 mx-auto object-contain" />
            ) : (
              <div className="text-4xl">🎫</div>
            )}
            <h1 className="text-xl font-bold text-gray-800">Hotel Tickets</h1>
            <p className="text-sm text-gray-500">Log in met je Home Assistant account</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-username" className="block text-sm font-medium text-gray-700 mb-1">
                Gebruikersnaam
              </label>
              <input
                id="login-username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-gray-700 mb-1">
                Wachtwoord
              </label>
              <input
                id="login-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Inloggen..." : "Inloggen"}
            </button>
          </form>

          <p className="text-xs text-gray-400 text-center">
            Alleen bereikbaar op het bedrijfsnetwerk
          </p>
        </div>
      </div>
    </div>
  );
}
