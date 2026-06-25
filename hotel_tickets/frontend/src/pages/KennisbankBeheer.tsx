import { useEffect, useRef, useState } from "react";
import {
  knowledgeApi,
  CATEGORY_LABELS,
  parseUTC,
  type KnowledgeEntry,
  type KnowledgeQuestion,
  type KnowledgeDocument,
  type KnowledgeAiSettings,
  type Category,
  type KnowledgeImportResult,
} from "../api/client";

/** Verwijder markdown-afbeeldingen uit een tekst voor een korte preview. */
function stripImages(md: string): string {
  return md.replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim();
}

/** Korte datum+tijd in NL-notatie. */
function fmtWhen(iso: string): string {
  if (!iso) return "";
  try {
    return parseUTC(iso).toLocaleString("nl-NL", {
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

type Tab = "overzicht" | "queue" | "entries" | "documents";

type DocEdit = {
  id: string;
  title: string;
  content: string;
  category: Category | "";
  folder: string;
};

const EMPTY_FORM = {
  id: null as string | null,
  title: "",
  answer: "",
  keywords: "",
  category: "" as Category | "",
  folder: "",
};

const ALL_CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[];

export default function KennisbankBeheer() {
  const [tab, setTab] = useState<Tab>("overzicht");
  const [queue, setQueue] = useState<KnowledgeQuestion[]>([]);
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [formImages, setFormImages] = useState<string[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [uploadingImg, setUploadingImg] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);

  const [deptFilter, setDeptFilter] = useState<Category | "">("");

  // Documenten + AI
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [docCategory, setDocCategory] = useState<Category | "">("");
  const [docFolder, setDocFolder] = useState("");
  const [aiSettings, setAiSettings] = useState<KnowledgeAiSettings | null>(null);
  const [docTitle, setDocTitle] = useState("");
  const [docContent, setDocContent] = useState("");
  const [docSaving, setDocSaving] = useState(false);
  const [docMsg, setDocMsg] = useState("");
  const [cleaning, setCleaning] = useState(false);
  const docInputRef = useRef<HTMLInputElement>(null);

  // Document bewerken (modal)
  const [docEdit, setDocEdit] = useState<DocEdit | null>(null);
  const [docEditSaving, setDocEditSaving] = useState(false);
  const [docEditCleaning, setDocEditCleaning] = useState(false);
  const [docEditError, setDocEditError] = useState("");

  function loadQueue() {
    knowledgeApi.queue().then((r) => setQueue(r.data)).catch(() => {});
  }
  function loadEntries() {
    knowledgeApi
      .listEntries({ include_unpublished: "true" })
      .then((r) => setEntries(r.data))
      .catch(() => {});
  }
  function loadDocuments() {
    knowledgeApi.listDocuments().then((r) => setDocuments(r.data)).catch(() => {});
  }
  function loadAiSettings() {
    knowledgeApi.getAiSettings().then((r) => setAiSettings(r.data)).catch(() => {});
  }

  useEffect(() => {
    loadQueue();
    loadEntries();
    loadDocuments();
    loadAiSettings();
  }, []);

  // --- AI + documenten acties ---

  async function toggleAi(enabled: boolean) {
    const r = await knowledgeApi.updateAiSettings({ enabled });
    setAiSettings(r.data);
  }

  async function savePastedDoc() {
    if (!docTitle.trim() || !docContent.trim()) return;
    setDocSaving(true);
    setDocMsg("");
    try {
      const r = await knowledgeApi.createDocument({
        title: docTitle.trim(),
        content: docContent.trim(),
        category: docCategory || null,
        folder: docFolder.trim() || null,
      });
      setDocMsg(`Toegevoegd: "${r.data.title}" (${r.data.chunk_count} fragmenten)`);
      setDocTitle("");
      setDocContent("");
      loadDocuments();
    } catch {
      setDocMsg("Opslaan mislukt.");
    } finally {
      setDocSaving(false);
    }
  }

  async function uploadDoc(file: File) {
    setDocSaving(true);
    setDocMsg("");
    try {
      const r = await knowledgeApi.uploadDocument(
        file,
        undefined,
        docCategory || null,
        docFolder.trim() || null
      );
      setDocMsg(`Geüpload: "${r.data.title}" (${r.data.chunk_count} fragmenten)`);
      loadDocuments();
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Upload mislukt.";
      setDocMsg(detail);
    } finally {
      setDocSaving(false);
      if (docInputRef.current) docInputRef.current.value = "";
    }
  }

  async function removeDoc(id: string) {
    if (!confirm("Dit document verwijderen?")) return;
    await knowledgeApi.removeDocument(id);
    loadDocuments();
  }

  /** Laat Claude de geplakte tekst herstructureren en vul titel/afdeling/onderwerp voor. */
  async function cleanupNewDoc() {
    if (!docContent.trim()) return;
    setCleaning(true);
    setDocMsg("");
    try {
      const r = await knowledgeApi.aiCleanup(docContent);
      if (r.data.title) setDocTitle(r.data.title);
      if (r.data.category) setDocCategory(r.data.category);
      if (r.data.folder) setDocFolder(r.data.folder);
      if (r.data.content) setDocContent(r.data.content);
      setDocMsg("✨ Netjes gemaakt. Controleer het resultaat en sla op.");
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Opschonen mislukt.";
      setDocMsg(detail);
    } finally {
      setCleaning(false);
    }
  }

  async function openDocEdit(id: string) {
    setDocEditError("");
    try {
      const r = await knowledgeApi.getDocument(id);
      setDocEdit({
        id: r.data.id,
        title: r.data.title,
        content: r.data.content,
        category: r.data.category ?? "",
        folder: r.data.folder ?? "",
      });
    } catch {
      alert("Document kon niet geladen worden.");
    }
  }

  async function cleanupEditDoc() {
    if (!docEdit || !docEdit.content.trim()) return;
    setDocEditCleaning(true);
    setDocEditError("");
    try {
      const r = await knowledgeApi.aiCleanup(docEdit.content);
      setDocEdit((prev) =>
        prev
          ? {
              ...prev,
              title: r.data.title || prev.title,
              content: r.data.content || prev.content,
              category: r.data.category ?? prev.category,
              folder: r.data.folder ?? prev.folder,
            }
          : prev
      );
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Opschonen mislukt.";
      setDocEditError(detail);
    } finally {
      setDocEditCleaning(false);
    }
  }

  async function saveDocEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!docEdit) return;
    if (!docEdit.title.trim() || !docEdit.content.trim()) {
      setDocEditError("Titel en inhoud zijn verplicht.");
      return;
    }
    setDocEditSaving(true);
    setDocEditError("");
    try {
      await knowledgeApi.updateDocument(docEdit.id, {
        title: docEdit.title.trim(),
        content: docEdit.content.trim(),
        category: docEdit.category || null,
        folder: docEdit.folder.trim() || null,
      });
      setDocEdit(null);
      loadDocuments();
    } catch {
      setDocEditError("Opslaan mislukt. Probeer opnieuw.");
    } finally {
      setDocEditSaving(false);
    }
  }

  // --- Wachtrij acties ---

  function answerQuestion(q: KnowledgeQuestion) {
    setForm({
      id: null,
      title: q.question_text,
      answer: q.proposed_answer ?? "", // voorvullen met de oplossing van de medewerker
      keywords: "",
      category: q.category ?? "",
      folder: "",
    });
    setFormImages([]);
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
    setFormImages([]);
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
      folder: e.folder ?? "",
    });
    setFormImages(e.images ?? []);
    setAnsweringQuestionId(null);
    setError("");
    setShowForm(true);
  }

  async function uploadFormImage(file: File) {
    if (!form.id) return;
    setUploadingImg(true);
    try {
      const r = await knowledgeApi.uploadImage(form.id, file);
      const fname = r.data.filename;
      setFormImages((prev) => [...prev, fname]);
      // Voeg de afbeelding toe aan het antwoord (markdown)
      setForm((prev) => ({ ...prev, answer: `${prev.answer}\n\n![](${fname})`.trim() }));
    } catch {
      alert("Uploaden mislukt.");
    } finally {
      setUploadingImg(false);
    }
  }

  async function deleteFormImage(fname: string) {
    if (!form.id) return;
    await knowledgeApi.deleteImage(form.id, fname);
    setFormImages((prev) => prev.filter((f) => f !== fname));
    setForm((prev) => ({
      ...prev,
      answer: prev.answer.replace(new RegExp(`!\\[[^\\]]*\\]\\(${fname}\\)`, "g"), "").trim(),
    }));
  }

  async function handleImport(file: File) {
    setImporting(true);
    setImportMsg("");
    try {
      const r = await knowledgeApi.importFile(file);
      const res: KnowledgeImportResult = r.data;
      setImportMsg(
        `Geïmporteerd: ${res.imported} · overgeslagen (al aanwezig): ${res.skipped} · afbeeldingen: ${res.images}`
      );
      loadEntries();
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Import mislukt.";
      setImportMsg(detail);
    } finally {
      setImporting(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
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
      folder: form.folder.trim() || null,
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
      setFormImages([]);
      setAnsweringQuestionId(null);
    } catch {
      setError("Opslaan mislukt. Probeer opnieuw.");
    } finally {
      setSaving(false);
    }
  }

  const knownFolders = Array.from(
    new Set(
      [...entries, ...documents].map((x) => (x.folder || "").trim()).filter(Boolean)
    )
  ).sort();

  return (
    <div className="space-y-5">
      <datalist id="kb-folders">
        {knownFolders.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-gray-900">Kennisbank beheer</h1>
        {tab === "entries" && (
          <div className="flex items-center gap-2">
            <input
              ref={importInputRef}
              type="file"
              accept=".md,.markdown,.txt,.zip"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleImport(f);
              }}
            />
            <button
              onClick={() => importInputRef.current?.click()}
              disabled={importing}
              className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
            >
              {importing ? "Importeren..." : "Importeren"}
            </button>
            <button
              onClick={newEntry}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700"
            >
              + Nieuw item
            </button>
          </div>
        )}
      </div>

      {tab === "entries" && importMsg && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 text-sm rounded-lg px-4 py-2">
          {importMsg}
        </div>
      )}
      {tab === "entries" && (
        <p className="text-xs text-gray-400 -mt-2">
          Import: een <code>.md</code>-bestand of een <code>.zip</code> (Markdown + afbeeldingen).
          Zet elke vraag als een kop (#, ## of ###) met het antwoord eronder. Duplicaten worden overgeslagen.
        </p>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        <TabButton active={tab === "overzicht"} onClick={() => setTab("overzicht")}>
          Overzicht
        </TabButton>
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
        <TabButton active={tab === "documents"} onClick={() => setTab("documents")}>
          Documenten ({documents.length})
        </TabButton>
      </div>

      {/* AI-schakelaar */}
      {aiSettings && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-800">🤖 AI-modus (Claude)</p>
            {aiSettings.ai_available ? (
              <p className="text-xs text-gray-500 mt-0.5">
                Model: {aiSettings.model}. Met AI aan beantwoordt de bot vragen uit je documenten
                (vrije tekst); zonder AI zoekt hij op trefwoord in de kennis-items.
              </p>
            ) : (
              <p className="text-xs text-amber-700 mt-0.5">
                Geen API-sleutel ingesteld. Stel de Claude API-sleutel in onder
                <strong> Instellingen → AI / Kennisbot</strong> om AI te kunnen gebruiken.
              </p>
            )}
          </div>
          <label className="flex items-center gap-2 shrink-0 cursor-pointer">
            <input
              type="checkbox"
              checked={aiSettings.ai_enabled}
              disabled={!aiSettings.ai_available}
              onChange={(e) => toggleAi(e.target.checked)}
              className="w-4 h-4"
            />
            <span className="text-sm text-gray-700">{aiSettings.ai_enabled ? "Aan" : "Uit"}</span>
          </label>
        </div>
      )}

      {/* Overzicht / dashboard */}
      {tab === "overzicht" && (
        <OverviewTab
          queue={queue}
          entries={entries}
          documents={documents}
          aiSettings={aiSettings}
          onGoto={setTab}
        />
      )}

      {/* Wachtrij — opgesplitst: aangedragen oplossingen vs. open vragen */}
      {tab === "queue" &&
        (() => {
          const proposals = queue.filter((q) => q.proposed_answer);
          const openQuestions = queue.filter((q) => !q.proposed_answer);
          if (queue.length === 0) {
            return <p className="text-sm text-gray-400">Geen openstaande items 🎉</p>;
          }
          return (
            <div className="space-y-6">
              {/* Aangedragen oplossingen (te beoordelen) */}
              {proposals.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    💡 Aangedragen oplossingen
                    <span className="text-xs bg-green-100 text-green-700 rounded-full px-2 py-0.5">
                      {proposals.length}
                    </span>
                  </h3>
                  <p className="text-xs text-gray-500 -mt-1">
                    Een medewerker loste dit zelf op via de chat. Controleer de oplossing en voeg
                    'm toe aan de kennisbank.
                  </p>
                  {proposals.map((q) => (
                    <div
                      key={q.id}
                      className="bg-white rounded-xl shadow-sm border border-green-200 p-4 space-y-2"
                    >
                      <div className="text-xs text-gray-400 flex flex-wrap gap-x-2">
                        <span>🗨️ uit de chat</span>
                        <span>· {q.proposed_by || "onbekend"}</span>
                        {q.category && <span>· {CATEGORY_LABELS[q.category]}</span>}
                        {q.created_at && <span>· {fmtWhen(q.created_at)}</span>}
                      </div>
                      <div>
                        <p className="text-[11px] font-semibold text-gray-400 uppercase">Vraag</p>
                        <p className="text-sm font-medium text-gray-900 whitespace-pre-wrap">
                          {q.question_text}
                        </p>
                      </div>
                      <div className="bg-green-50 border border-green-200 rounded-lg p-2.5">
                        <p className="text-[11px] font-semibold text-green-700 uppercase">
                          Voorgestelde oplossing
                        </p>
                        <p className="text-sm text-gray-700 whitespace-pre-wrap mt-0.5">
                          {q.proposed_answer}
                        </p>
                      </div>
                      {q.conversation && (
                        <details className="text-xs">
                          <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
                            Toon het hele gesprek
                          </summary>
                          <div className="mt-1.5 bg-gray-50 border border-gray-200 rounded-lg p-2.5 max-h-60 overflow-y-auto whitespace-pre-wrap text-gray-600">
                            {q.conversation}
                          </div>
                        </details>
                      )}
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => answerQuestion(q)}
                          className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs hover:bg-blue-700"
                        >
                          Beoordelen & toevoegen
                        </button>
                        <button
                          onClick={() => dismissQuestion(q.id)}
                          className="text-gray-500 px-3 py-1.5 rounded-lg text-xs hover:bg-gray-100"
                        >
                          Afwijzen
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Onbeantwoorde vragen */}
              {openQuestions.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                    ❓ Onbeantwoorde vragen
                    <span className="text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5">
                      {openQuestions.length}
                    </span>
                  </h3>
                  <p className="text-xs text-gray-500 -mt-1">
                    Hier had de bot geen antwoord op. Voeg een antwoord toe zodat het voortaan wél
                    beantwoord wordt.
                  </p>
                  {openQuestions.map((q) => (
                    <div
                      key={q.id}
                      className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-start justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 whitespace-pre-wrap">
                          {q.question_text}
                        </p>
                        <p className="text-xs text-gray-400 mt-1 flex flex-wrap gap-x-2">
                          <span>{q.asked_by_name || q.asked_by}</span>
                          {q.category && <span>· {CATEGORY_LABELS[q.category]}</span>}
                          {q.created_at && <span>· {fmtWhen(q.created_at)}</span>}
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
                  ))}
                </div>
              )}
            </div>
          );
        })()}

      {/* Kennisbank — gegroepeerd per afdeling → onderwerp */}
      {tab === "entries" && (
        <div className="space-y-3">
          {entries.length === 0 ? (
            <p className="text-sm text-gray-400">Nog geen kennis-items.</p>
          ) : (
            <>
              <div className="flex justify-end">
                <DeptFilter value={deptFilter} onChange={setDeptFilter} />
              </div>
              <GroupedSections
                items={entries.filter((e) => !deptFilter || e.category === deptFilter)}
                renderItem={(e) => (
                  <div
                    key={e.id}
                    className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
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
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2 whitespace-pre-wrap">
                        {stripImages(e.answer)}
                      </p>
                      <p className="text-xs text-gray-400 mt-1">
                        {e.ask_count}× gevraagd
                        {e.images.length > 0 &&
                          ` · ${e.images.length} afbeelding${e.images.length > 1 ? "en" : ""}`}
                      </p>
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
                )}
              />
            </>
          )}
        </div>
      )}

      {/* Documenten (RAG-bron voor AI) */}
      {tab === "documents" && (
        <div className="space-y-4">
          <p className="text-xs text-gray-500">
            Documenten zijn vrije tekst die de AI doorzoekt om antwoorden uit te formuleren.
            Plak tekst of upload een bestand (.md, .txt, .pdf of .zip). Werkt alleen als AI aanstaat.
          </p>

          {/* Plakken */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 space-y-2">
            <input
              value={docTitle}
              onChange={(e) => setDocTitle(e.target.value)}
              placeholder="Titel van het document"
              className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
            <textarea
              value={docContent}
              onChange={(e) => setDocContent(e.target.value)}
              placeholder="Plak hier de tekst..."
              rows={5}
              className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none"
            />
            <div className="flex gap-2">
              <select
                value={docCategory}
                onChange={(e) => setDocCategory(e.target.value as Category | "")}
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="">Afdeling (optioneel)</option>
                {ALL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
              <input
                value={docFolder}
                onChange={(e) => setDocFolder(e.target.value)}
                placeholder="Onderwerp / map"
                list="kb-folders"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <p className="text-[11px] text-gray-400">
              Afdeling + onderwerp gelden voor het volgende geplakte of geüploade document.
            </p>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <input
                  ref={docInputRef}
                  type="file"
                  accept=".md,.markdown,.txt,.pdf,.zip"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadDoc(f);
                  }}
                />
                <button
                  onClick={() => docInputRef.current?.click()}
                  disabled={docSaving}
                  className="border border-gray-300 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
                >
                  Bestand uploaden
                </button>
              </div>
              <div className="flex items-center gap-2">
                {aiSettings?.ai_available && (
                  <button
                    onClick={cleanupNewDoc}
                    disabled={cleaning || !docContent.trim()}
                    title="Laat de AI je tekst herschrijven tot een nette pagina en afdeling/onderwerp voorstellen"
                    className="border border-purple-300 text-purple-700 px-4 py-2 rounded-lg text-sm hover:bg-purple-50 disabled:opacity-50"
                  >
                    {cleaning ? "Bezig..." : "✨ Netjes maken"}
                  </button>
                )}
                <button
                  onClick={savePastedDoc}
                  disabled={docSaving || !docTitle.trim() || !docContent.trim()}
                  className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {docSaving ? "Bezig..." : "Tekst opslaan"}
                </button>
              </div>
            </div>
            {aiSettings?.ai_available && (
              <p className="text-[11px] text-gray-400">
                ✨ Netjes maken gebruikt je Claude API-sleutel om ruwe tekst te herschrijven tot een
                overzichtelijke pagina en stelt afdeling + onderwerp voor.
              </p>
            )}
            {docMsg && <p className="text-sm text-blue-700">{docMsg}</p>}
          </div>

          {/* Lijst — gegroepeerd per afdeling → onderwerp */}
          {documents.length === 0 ? (
            <p className="text-sm text-gray-400">Nog geen documenten.</p>
          ) : (
            <>
              <div className="flex justify-end">
                <DeptFilter value={deptFilter} onChange={setDeptFilter} />
              </div>
              <GroupedSections
                items={documents.filter((d) => !deptFilter || d.category === deptFilter)}
                renderItem={(d) => (
                  <div
                    key={d.id}
                    className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-gray-900">{d.title}</p>
                      <p className="text-xs text-gray-400 mt-1">
                        {d.chunk_count} fragment{d.chunk_count === 1 ? "" : "en"}
                        {d.source_filename && ` · ${d.source_filename}`}
                      </p>
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <button
                        onClick={() => openDocEdit(d.id)}
                        className="text-blue-600 px-3 py-1.5 rounded-lg text-xs hover:bg-blue-50"
                      >
                        Bewerken
                      </button>
                      <button
                        onClick={() => removeDoc(d.id)}
                        className="text-red-600 px-3 py-1.5 rounded-lg text-xs hover:bg-red-50"
                      >
                        Verwijderen
                      </button>
                    </div>
                  </div>
                )}
              />
            </>
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
              <p className="text-[11px] text-gray-400 mt-1">
                Markdown ondersteund (koppen, lijsten, **vet**, afbeeldingen).
              </p>
            </div>

            {/* Afbeeldingen — alleen bij een bestaand item */}
            <div>
              <label className="text-xs font-medium text-gray-600">Afbeeldingen</label>
              {!form.id ? (
                <p className="text-[11px] text-gray-400 mt-1">
                  Sla het item eerst op; daarna kun je afbeeldingen toevoegen.
                </p>
              ) : (
                <div className="mt-1 space-y-2">
                  {formImages.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {formImages.map((img) => (
                        <div key={img} className="relative">
                          <img
                            src={knowledgeApi.imageUrl(form.id!, img)}
                            alt=""
                            className="h-16 w-16 object-cover rounded-lg border border-gray-200"
                          />
                          <button
                            type="button"
                            onClick={() => deleteFormImage(img)}
                            className="absolute -top-1.5 -right-1.5 bg-red-500 text-white rounded-full w-5 h-5 text-xs leading-none"
                            title="Verwijderen"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <label className="inline-block">
                    <span className="border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg text-xs hover:bg-gray-50 cursor-pointer inline-block">
                      {uploadingImg ? "Uploaden..." : "+ Afbeelding"}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadFormImage(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              )}
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
                {ALL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Onderwerp / map (optioneel)</label>
              <input
                value={form.folder}
                onChange={(e) => setForm({ ...form, folder: e.target.value })}
                placeholder="bijv. Koffiemachine, Check-in, Wasserij"
                list="kb-folders"
                className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Groepeert items binnen een afdeling. Hergebruik bestaande namen voor overzicht.
              </p>
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => {
                  setShowForm(false);
                  setAnsweringQuestionId(null);
                  setFormImages([]);
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

      {/* Document bewerken (modal) */}
      {docEdit && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-[60]">
          <form
            onSubmit={saveDocEdit}
            className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5 space-y-3 max-h-[90vh] overflow-y-auto"
          >
            <h2 className="font-bold text-gray-900">Document bewerken</h2>
            <div>
              <label className="text-xs font-medium text-gray-600">Titel</label>
              <input
                value={docEdit.title}
                onChange={(e) => setDocEdit({ ...docEdit, title: e.target.value })}
                className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600">Inhoud</label>
              <textarea
                value={docEdit.content}
                onChange={(e) => setDocEdit({ ...docEdit, content: e.target.value })}
                rows={10}
                className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none mt-1 font-mono"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Bij opslaan worden de zoekfragmenten automatisch opnieuw opgebouwd.
              </p>
            </div>
            <div className="flex gap-2">
              <select
                value={docEdit.category}
                onChange={(e) =>
                  setDocEdit({ ...docEdit, category: e.target.value as Category | "" })
                }
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white"
              >
                <option value="">Afdeling (optioneel)</option>
                {ALL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
              <input
                value={docEdit.folder}
                onChange={(e) => setDocEdit({ ...docEdit, folder: e.target.value })}
                placeholder="Onderwerp / map"
                list="kb-folders"
                className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            {docEditError && <p className="text-sm text-red-600">{docEditError}</p>}
            <div className="flex items-center justify-between gap-2 pt-1">
              {aiSettings?.ai_available ? (
                <button
                  type="button"
                  onClick={cleanupEditDoc}
                  disabled={docEditCleaning || !docEdit.content.trim()}
                  className="border border-purple-300 text-purple-700 px-4 py-2 rounded-lg text-sm hover:bg-purple-50 disabled:opacity-50"
                >
                  {docEditCleaning ? "Bezig..." : "✨ Netjes maken"}
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDocEdit(null)}
                  className="px-4 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-100"
                >
                  Annuleren
                </button>
                <button
                  type="submit"
                  disabled={docEditSaving}
                  className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                >
                  {docEditSaving ? "Opslaan..." : "Opslaan"}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

/** Overzicht / dashboard: kerncijfers + verdeling per afdeling. */
function OverviewTab({
  queue,
  entries,
  documents,
  aiSettings,
  onGoto,
}: {
  queue: KnowledgeQuestion[];
  entries: KnowledgeEntry[];
  documents: KnowledgeDocument[];
  aiSettings: KnowledgeAiSettings | null;
  onGoto: (t: Tab) => void;
}) {
  const proposals = queue.filter((q) => q.proposed_answer).length;
  const concepts = entries.filter((e) => !e.is_published).length;
  const totalChunks = documents.reduce((n, d) => n + (d.chunk_count || 0), 0);

  // Verdeling per afdeling (entries + documenten)
  const byDept = new Map<string, { entries: number; documents: number }>();
  const bump = (cat: Category | null, key: "entries" | "documents") => {
    const label = cat ? CATEGORY_LABELS[cat] : "Algemeen";
    const cur = byDept.get(label) ?? { entries: 0, documents: 0 };
    cur[key] += 1;
    byDept.set(label, cur);
  };
  entries.forEach((e) => bump(e.category, "entries"));
  documents.forEach((d) => bump(d.category, "documents"));
  const deptRows = [...byDept.entries()].sort((a, b) => a[0].localeCompare(b[0], "nl"));

  const topAsked = [...entries]
    .filter((e) => e.ask_count > 0)
    .sort((a, b) => b.ask_count - a.ask_count)
    .slice(0, 5);

  return (
    <div className="space-y-5">
      {/* Kerncijfers */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Open in wachtrij"
          value={queue.length}
          hint={proposals > 0 ? `${proposals} aangedragen` : undefined}
          accent={queue.length > 0 ? "amber" : "gray"}
          onClick={() => onGoto("queue")}
        />
        <StatCard
          label="Kennis-items"
          value={entries.length}
          hint={concepts > 0 ? `${concepts} concept` : undefined}
          onClick={() => onGoto("entries")}
        />
        <StatCard
          label="Documenten"
          value={documents.length}
          hint={`${totalChunks} fragmenten`}
          onClick={() => onGoto("documents")}
        />
        <StatCard
          label="AI-modus"
          value={aiSettings?.ai_enabled ? "Aan" : "Uit"}
          hint={
            aiSettings
              ? aiSettings.ai_available
                ? aiSettings.model
                : "geen sleutel"
              : undefined
          }
          accent={aiSettings?.ai_enabled ? "green" : "gray"}
        />
      </div>

      {/* Verdeling per afdeling */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <h3 className="text-sm font-bold text-gray-800 mb-3">Verdeling per afdeling</h3>
        {deptRows.length === 0 ? (
          <p className="text-sm text-gray-400">Nog niets in de kennisbank.</p>
        ) : (
          <div className="space-y-1.5">
            <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 text-[11px] font-semibold text-gray-400 uppercase">
              <span>Afdeling</span>
              <span className="text-right w-16">Items</span>
              <span className="text-right w-20">Documenten</span>
            </div>
            {deptRows.map(([label, c]) => (
              <div
                key={label}
                className="grid grid-cols-[1fr_auto_auto] gap-x-4 text-sm text-gray-700 py-0.5"
              >
                <span className="font-medium">{label}</span>
                <span className="text-right w-16">{c.entries}</span>
                <span className="text-right w-20">{c.documents}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Meest gestelde vragen */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4">
        <h3 className="text-sm font-bold text-gray-800 mb-3">Meest gevraagd</h3>
        {topAsked.length === 0 ? (
          <p className="text-sm text-gray-400">Nog geen vragen beantwoord door de bot.</p>
        ) : (
          <div className="space-y-1.5">
            {topAsked.map((e) => (
              <div key={e.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-gray-700 truncate">{e.title}</span>
                <span className="text-xs text-gray-400 shrink-0">{e.ask_count}×</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  accent = "gray",
  onClick,
}: {
  label: string;
  value: number | string;
  hint?: string;
  accent?: "gray" | "amber" | "green";
  onClick?: () => void;
}) {
  const accentCls =
    accent === "amber"
      ? "text-amber-600"
      : accent === "green"
      ? "text-green-600"
      : "text-gray-900";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`bg-white rounded-xl shadow-sm border border-gray-200 p-4 text-left ${
        onClick ? "hover:border-blue-300 cursor-pointer" : "cursor-default"
      }`}
    >
      <p className="text-xs text-gray-500">{label}</p>
      <p className={`text-2xl font-bold mt-0.5 ${accentCls}`}>{value}</p>
      {hint && <p className="text-[11px] text-gray-400 mt-0.5">{hint}</p>}
    </button>
  );
}

/** Filterbalk per afdeling. */
function DeptFilter({
  value,
  onChange,
}: {
  value: Category | "";
  onChange: (v: Category | "") => void;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Category | "")}
      className="border border-gray-300 rounded-lg px-2 py-1.5 text-sm bg-white"
    >
      <option value="">Alle afdelingen</option>
      {ALL_CATEGORIES.map((c) => (
        <option key={c} value={c}>
          {CATEGORY_LABELS[c]}
        </option>
      ))}
    </select>
  );
}

/** Toont items gegroepeerd op afdeling → onderwerp/map. */
function GroupedSections<T extends { id: string; category: Category | null; folder: string | null }>({
  items,
  renderItem,
}: {
  items: T[];
  renderItem: (it: T) => React.ReactNode;
}) {
  const cats = new Map<string, Map<string, T[]>>();
  for (const it of items) {
    const cat = it.category ? CATEGORY_LABELS[it.category] : "Algemeen";
    const folder = (it.folder || "").trim() || "Overig";
    if (!cats.has(cat)) cats.set(cat, new Map());
    const fm = cats.get(cat)!;
    if (!fm.has(folder)) fm.set(folder, []);
    fm.get(folder)!.push(it);
  }
  const catKeys = [...cats.keys()].sort((a, b) => a.localeCompare(b, "nl"));

  return (
    <div className="space-y-5">
      {catKeys.map((cat) => {
        const folders = cats.get(cat)!;
        const folderKeys = [...folders.keys()].sort((a, b) => a.localeCompare(b, "nl"));
        const total = folderKeys.reduce((n, f) => n + folders.get(f)!.length, 0);
        return (
          <div key={cat} className="space-y-2">
            <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
              {cat}
              <span className="text-xs font-normal bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">
                {total}
              </span>
            </h3>
            {folderKeys.map((f) => (
              <div key={f} className="space-y-2">
                {!(folderKeys.length === 1 && f === "Overig") && (
                  <p className="text-xs font-semibold text-gray-500 ml-0.5">{f}</p>
                )}
                {folders.get(f)!.map(renderItem)}
              </div>
            ))}
          </div>
        );
      })}
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
