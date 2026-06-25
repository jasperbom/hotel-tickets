import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  knowledgeApi,
  CATEGORY_LABELS,
  type KnowledgeEntry,
  type Category,
} from "../api/client";

export default function KennisBot() {
  const navigate = useNavigate();
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [asked, setAsked] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [results, setResults] = useState<KnowledgeEntry[]>([]);
  const [lastQuestion, setLastQuestion] = useState("");

  // Bladeren door de kennisbank
  const [browse, setBrowse] = useState<KnowledgeEntry[]>([]);
  const [browseFilter, setBrowseFilter] = useState<Category | "">("");

  function loadBrowse() {
    const params: Record<string, string> = {};
    if (browseFilter) params.category = browseFilter;
    knowledgeApi.listEntries(params).then((r) => setBrowse(r.data)).catch(() => {});
  }

  useEffect(loadBrowse, [browseFilter]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setAsking(true);
    setAsked(false);
    try {
      const res = await knowledgeApi.ask(question.trim());
      setResults(res.data.entries);
      setAnswered(res.data.answered);
      setLastQuestion(question.trim());
      setAsked(true);
    } catch {
      setAnswered(false);
      setResults([]);
      setAsked(true);
    } finally {
      setAsking(false);
    }
  }

  function makeTicket() {
    navigate("/tickets/new", { state: { title: lastQuestion } });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Kennisbot</h1>
        <p className="text-sm text-gray-500 mt-1">
          Loop je ergens tegenaan? Stel je vraag — je krijgt antwoord uit onze eigen kennisbank.
        </p>
      </div>

      <form onSubmit={submit} className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 space-y-3">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Bijv. 'De koffiemachine geeft foutcode E5' of 'Hoe reset ik de sauna?'"
          rows={3}
          className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={asking || !question.trim()}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {asking ? "Zoeken..." : "Vraag stellen"}
          </button>
        </div>
      </form>

      {/* Resultaat */}
      {asked && answered && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-700">
            {results.length === 1 ? "Gevonden antwoord" : "Mogelijke antwoorden"}
          </h2>
          {results.map((e) => (
            <EntryCard key={e.id} entry={e} />
          ))}
        </div>
      )}

      {asked && !answered && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
          <div className="flex items-start gap-3">
            <span className="text-2xl">🤔</span>
            <div>
              <p className="font-semibold text-amber-900">Hier heb ik nog geen antwoord op</p>
              <p className="text-sm text-amber-800 mt-1">
                Je vraag is doorgestuurd naar het beheer. Zodra iemand een antwoord toevoegt,
                kan de bot 'm voortaan beantwoorden.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={makeTicket}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700"
            >
              Maak hier een ticket van
            </button>
          </div>
        </div>
      )}

      {/* Bladeren */}
      <div className="pt-2">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Kennisbank</h2>
          <select
            value={browseFilter}
            onChange={(e) => setBrowseFilter(e.target.value as Category | "")}
            className="border border-gray-300 rounded-lg px-2 py-1 text-sm bg-white"
          >
            <option value="">Alle afdelingen</option>
            {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        {browse.length === 0 ? (
          <p className="text-sm text-gray-400">Nog geen kennis-items.</p>
        ) : (
          <div className="space-y-2">
            {browse.map((e) => (
              <EntryCard key={e.id} entry={e} collapsible />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EntryCard({ entry, collapsible }: { entry: KnowledgeEntry; collapsible?: boolean }) {
  const [open, setOpen] = useState(!collapsible);
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
      <button
        onClick={() => collapsible && setOpen(!open)}
        className={`flex items-start justify-between w-full text-left ${collapsible ? "" : "cursor-default"}`}
      >
        <div className="flex items-center gap-2">
          {entry.category && (
            <span className="text-[10px] font-medium bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
              {CATEGORY_LABELS[entry.category]}
            </span>
          )}
          <span className="font-semibold text-gray-900">{entry.title}</span>
        </div>
        {collapsible && <span className="text-gray-400 ml-2">{open ? "−" : "+"}</span>}
      </button>
      {open && (
        <p className="text-sm text-gray-700 mt-2 whitespace-pre-wrap">{entry.answer}</p>
      )}
    </div>
  );
}
