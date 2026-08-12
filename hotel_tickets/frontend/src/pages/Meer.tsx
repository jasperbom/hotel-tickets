import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { clearSessionToken, hasSessionToken, sessionsApi, type UserRole } from "../api/client";
import { AFDELING_LABELS } from "../werk";
import { useOngelezen } from "../ongelezen";

/**
 * Meer — alles wat niet dagelijks is, in drie groepen op één scherm.
 *
 * Berichten staat bovenaan omdat het het enige is met een teller. Wachtwoord,
 * apparaten en instellingen zitten achter de eerste regel van Account: dat zijn
 * dingen die je twee keer per jaar doet en die eerder vijf plekken in de
 * navigatie kostten.
 */

export default function Meer({
  gebruiker, modules, magRapportage, kanInstellingen,
}: {
  gebruiker: UserRole | null;
  /** Module-ids die deze medewerker mag zien — de gereedschapskast. */
  modules: string[];
  magRapportage: boolean;
  kanInstellingen: boolean;
}) {
  const navigate = useNavigate();
  const ongelezen = useOngelezen();
  const [accountOpen, setAccountOpen] = useState(false);

  async function uitloggen() {
    try {
      await sessionsApi.logout();
    } catch {
      /* negeren — lokaal token wordt hoe dan ook gewist */
    }
    clearSessionToken();
    window.location.hash = "#/login";
    window.location.reload();
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="grid gap-2">
        <Regel label="Berichten" badge={ongelezen} onClick={() => navigate("/berichten")} />
        <Regel label="Logboeken" onClick={() => navigate("/logboeken")} />
        <Regel label="Herhalende taken" onClick={() => navigate("/recurring")} />
        {magRapportage && <Regel label="Rapportage" onClick={() => navigate("/reports")} />}
        {magRapportage && <Regel label="Wandscherm" onClick={() => navigate("/wandscherm")} />}
      </div>

      <section>
        <SectieKop>Andere modules</SectieKop>
        <div className="grid gap-2">
          {modules.includes("zwembaden") && <Regel label="Zwembaden" onClick={() => navigate("/pools")} />}
          {modules.includes("fietsen") && <Regel label="Fietsen" onClick={() => navigate("/bikes")} />}
          {modules.includes("kennis") && <Regel label="Kennisbot" merk="Beta" onClick={() => navigate("/kennis")} />}
        </div>
      </section>

      <section>
        <SectieKop>Account</SectieKop>
        <div className="grid gap-2">
          <Regel
            label={gebruiker?.display_name ?? "Mijn account"}
            bijschrift={gebruiker?.department ? AFDELING_LABELS[gebruiker.department] : undefined}
            open={accountOpen}
            onClick={() => setAccountOpen(!accountOpen)}
          />
          {accountOpen && (
            <div className="grid gap-2 pl-4">
              <Regel label="Wachtwoord wijzigen" onClick={() => navigate("/wachtwoord")} />
              {hasSessionToken() && <Regel label="Apparaten" onClick={() => navigate("/apparaten")} />}
              {kanInstellingen && <Regel label="Instellingen" onClick={() => navigate("/instellingen")} />}
            </div>
          )}
          <Regel label="Meldingen" onClick={() => navigate("/meldingen")} />
          {hasSessionToken() && <Regel label="Uitloggen" onClick={uitloggen} />}
        </div>
      </section>
    </div>
  );
}

function SectieKop({ children }: { children: React.ReactNode }) {
  return <p className="mb-2.5 font-mono text-xs uppercase tracking-[0.14em] text-ink-45">{children}</p>;
}

function Regel({
  label, bijschrift, badge, merk, open, onClick,
}: {
  label: string;
  bijschrift?: string;
  badge?: number;
  merk?: string;
  open?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 w-full min-h-[3.5rem] px-4 rounded-[10px] border border-ink-12
                 bg-paper-raised text-left hover:bg-ink-6 transition-colors"
    >
      <span className="text-body text-ink">{label}</span>
      {merk && (
        <span className="text-[0.6875rem] font-bold uppercase tracking-wide bg-ink-6 text-ink-70 px-1.5 py-0.5 rounded">
          {merk}
        </span>
      )}
      {bijschrift && <span className="meta">{bijschrift}</span>}
      <span className="ml-auto flex items-center gap-2 shrink-0">
        {badge ? (
          <span className="min-w-[1.375rem] h-[1.375rem] px-1.5 rounded-full bg-ink text-paper text-meta font-semibold inline-flex items-center justify-center">
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
        {open === undefined ? (
          <ChevronRight size={18} className="text-ink-25" aria-hidden="true" />
        ) : open ? (
          <ChevronUp size={18} className="text-ink-25" aria-hidden="true" />
        ) : (
          <ChevronDown size={18} className="text-ink-25" aria-hidden="true" />
        )}
      </span>
    </button>
  );
}
