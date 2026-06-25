import { useEffect, useState } from "react";
import {
  knowledgeApi,
  CATEGORY_LABELS,
  type KnowledgeEntry,
  type KnowledgeQuestion,
  type Category,
} from "../api/client";

type Tab = "queue" | "entries";

const EMPTY_FORM = {
  id: null as string | null,
  title: "",
  answer: "",
  keywords: "",
  category: "" as Category | "",
};

export default function KennisbankBeheer() {
  const [tab, setTab] = useState<Tab>("queue");
  const [queue, setQueue] = useState<KnowledgeQuestion[]>([]);
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function loadQueue() {
    knowledgeApi.queue().then((r) => setQueue(r.data)).catch(() => {});
  }
  function loadEntries() {
    knowledgeApi
      .listEntries({ include_unpublished: "true" })
      .then((r) => setEntries(r.data))
      .catch(() => {});
  }

  useEffect(() => {
    loadQueue();
    loadEntries();
  }, []);

  // --- Wachtrij acties ---

  function answerQuestion(q: KnowledgeQuestion) {
    setForm({
      id: null,
      title: q.question_text,
      answer: "",
      keywords: "",
      category: q.category ?? "",
    });
    setError("");
    setShowForm(true);
    // markeer dat dit een wachtrij-antwoord is via een verborgen veld
    setAnsweringQuestionId(q.id);
  }

  async function dismissQuestion(id: string) {
    if (!confirm("Deze vraag afwijzen?")) return;
    await knowledgeApi.dismissQueue(id);
    loadQueue();
  }

  const [answeringQuestionId, setAnsweringQuestionId] = useState<string | null>(null);

  // --- Entry acties ---

  function newEntry() {
    setForm(EMPTY_FORM);
    setAnsweringQuestionId(null);
    setError("");
    setShowForm(true);
  }

  function editEntry(e: KnowledgeEntry) {
    setForm({
      id: e.id,
      title: e.title,
      answer: e.answer,
      keywords: e.keywords ?? "",
      category: e.category ?? "",
    });
    setAnsweringQuestionId(null);
    setError("");
    setShowForm(true);
  }

  async function removeEntry(id: string) {
    if (!confirm("Dit kennis-item verwijderen?")) return;
    await knowledgeApi.removeEntry(id);
    loadEntries();
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.answer.trim()) {
      setError("Titel en antwoord zijn verplicht.");
      return;
    }
    setSaving(true);
    setError("");
    const payload = {
      title: form.title.trim(),
      answer: form.answer.trim(),
      keywords: form.keywords.trim() || null,
      category: form.category || null,
    };
    try {
      if (answeringQuestionId) {
        await knowledgeApi.answerQueue(answeringQuestionId, payload);
        loadQueue();
      } else if (form.id) {
        await knowledgeApi.updateEntry(form.id, payload);
      } else {
        await knowledgeApi.createEntry(payload);
      }
      loadEntries();
      setShowForm(false);
      setForm(EMPTY_FORM);
      setAnsweringQuestionId(null);
    } catch {
      setError("Opslaan mislukt. Probeer opnieuw.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Kennisbank beheer</h1>
        {tab === "entries" && (
          <button
            onClick={newEntry}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700"
          >
            + Nieuw item
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        <TabButton active={tab === "queue"} onClick={() => setTab("queue")}>
          Wachtrij{queue.length > 0 && (
            <span className="ml-1.5 text-xs bg-red-500 text-white rounded-full px-1.5 py-0.5">
              {queue.length}
            </span>
          )}
        </TabButton>
        <TabButton active={tab === "entries"} onClick={() => setTab("entries")}>
          Kennisbank ({entries.length})
        </TabButton>
      </div>

      {/* Wachtrij */}
      {tab === "queue" && (
        <div className="space-y-2">
          {queue.length === 0 ? (
            <p className="text-sm text-gray-400">Geen openstaande vragen 🎉</p>
          ) : (
            queue.map((q) => (
              <div
                key={q.id}
                className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 whitespace-pre-wrap">{q.question_text}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {q.asked_by_name || q.asked_by}
                    {q.category && ` · ${CATEGORY_LABELS[q.category]}`}
                  </p>
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  <button
                    onClick={() => answerQuestion(q)}
                    className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs hover:bg-blue-700"
                  >
                    Beantwoorden
                  </button>
                  <button
                    onClick={() => dismissQuestion(q.id)}
                    className="text-gray-500 px-3 py-1.5 rounded-lg text-xs hover:bg-gray-100"
                  >
                    Afwijzen
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Kennisbank */}
      {tab === "entries" && (
        <div className="space-y-2">
          {entries.length === 0 ? (
            <p className="text-sm text-gray-400">Nog geen kennis-items.</p>
          ) : (
            entries.map((e) => (
              <div
                key={e.id}
                className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {e.category && (
                      <span className="text-[10px] font-medium bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                        {CATEGORY_LABELS[e.category]}
                      </span>
                    )}
                    <span className="font-semibold text-gray-900">{e.title}</span>
                    {!e.is_published && (
                      <span className="text-[10px] font-medium bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
                        concept
                      </span>
                    )}
                    {e.source_ticket_id && (
                      <span className="text-[10px] text-gray-400">uit ticket</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 mt-1 line-clamp-2 whitespace-pre-wrap">{e.answer}</p>
                  <p className="text-xs text-gray-400 mt-1">{e.ask_count}× gevraagd</p>
                </div>
                <div className="flex flex-col gap-1.5 shrink-0">
                  <button
                    onClick={() => editEntry(e)}
                    className="text-blue-600 px-3 py-1.5 rounded-lg text-xs hover:bg-blue-50"
                  >
                    Bewerken
                  </button>
                  <button
                    onClick={() => removeEntry(e.id)}
                    className="text-red-600 px-3 py-1.5 rounded-lg text-xs hover:bg-red-50"
                  >
                    Verwijderen
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Formulier (modal) */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-[60]">
          <form
            onSubmit={save}
            className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5 space-y-3 max-h-[90vh] overflow-y-auto"
          >
            <h2 className="font-bold text-gray-900">
              {answeringQuestionId
                ? "Vraag beantwoorden"
                : form.id
                ? "Item bewerken"
                : "Nieuw kennis-item"}
            </h2>
            <div>
              <label className="text-xs font-medium text-gray-600">Titel / vraag</label>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Antwoord / oplossing</label>
              <textarea
                value={form.answer}
                onChange={(e) => setForm({ ...form, answer: e.target.value })}
                rows={5}
                className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">
                Trefwoorden (optioneel, verbetert zoeken)
              </label>
              <input
                value={form.keywords}
                onChange={(e) => setForm({ ...form, keywords: e.target.value })}
                placeholder="bijv. ontkalken, reset, foutcode"
                className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Afdeling (optioneel)</label>
              <select
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value as Category | "" })}
                className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white mt-1"
              >
                <option value="">Algemeen / alle afdelingen</option>
                {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setAnsweringQuestionId(null);
                }}
                className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100"
              >
                Annuleren
              </button>
              <button
                type="submit"
                disabled={saving}
                className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? "Opslaan..." : "Opslaan"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        active
          ? "border-blue-600 text-blue-600"
          : "border-transparent text-gray-500 hover:text-gray-700"
      }`}
    >
      {children}
    </button>
  );
}
