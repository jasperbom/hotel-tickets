import { useEffect, useRef, useState } from "react";
import {
  knowledgeApi,
  CATEGORY_LABELS,
  VISIBILITY_LABELS,
  parseUTC,
  type KnowledgeEntry,
  type KnowledgeQuestion,
  type KnowledgeDocument,
  type KnowledgeAiSettings,
  type KnowledgeSearchResults,
  type KnowledgeDocumentMatch,
  type Category,
  type KnowledgeVisibility,
  type KnowledgeImportResult,
} from "../api/client";

const ALL_VISIBILITIES = Object.keys(VISIBILITY_LABELS) as KnowledgeVisibility[];

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

// Eén gedeelde invul-vorm voor zowel kennis-items als documenten. `body` is het
// antwoord (item) of de inhoud (document). Zo gebruiken beide tabs exact
// hetzelfde formulier; alleen de opslag verschilt onder water.
type KFValue = {
  title: string;
  body: string;
  context: string;
  keywords: string;
  category: Category | "";
  visibility: KnowledgeVisibility;
  folder: string;
};

const EMPTY_KF: KFValue = {
  title: "",
  body: "",
  context: "",
  keywords: "",
  category: "",
  visibility: "all",
  folder: "",
};

// Entry- en document-bewerkstate = de gedeelde vorm + een id.
type EntryForm = KFValue & { id: string | null };
type DocEdit = KFValue & { id: string };

const EMPTY_FORM: EntryForm = { ...EMPTY_KF, id: null };

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
  const [entryCleaning, setEntryCleaning] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);

  const [deptFilter, setDeptFilter] = useState<Category | "">("");

  // Zoeken door alle kennis
  const [searchQ, setSearchQ] = useState("");
  const [searchResults, setSearchResults] = useState<KnowledgeSearchResults | null>(null);
  const [searching, setSearching] = useState(false);
  const searchActive = searchQ.trim().length > 0;

  // Documenten + AI — nieuw document via dezelfde modal als kennis-items
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [aiSettings, setAiSettings] = useState<KnowledgeAiSettings | null>(null);
  const [showDocForm, setShowDocForm] = useState(false);
  const [docForm, setDocForm] = useState<KFValue>(EMPTY_KF);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docSaving, setDocSaving] = useState(false);
  const [docMsg, setDocMsg] = useState("");
  const [docError, setDocError] = useState("");
  const [cleaning, setCleaning] = useState(false);

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

  // Zoeken (gedebounced) door entries + documenten
  useEffect(() => {
    const term = searchQ.trim();
    if (!term) {
      setSearchResults(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      knowledgeApi
        .searchBeheer(term)
        .then((r) => setSearchResults(r.data))
        .catch(() => setSearchResults({ entries: [], documents: [] }))
        .finally(() => setSearching(false));
    }, 300);
    return () => clearTimeout(t);
  }, [searchQ]);

  // --- AI + documenten acties ---

  async function toggleAi(enabled: boolean) {
    const r = await knowledgeApi.updateAiSettings({ enabled });
    setAiSettings(r.data);
  }

  /** Zet een gekozen bestand klaar (nog niet opslaan). Vul de titel voor uit de
   * bestandsnaam als die nog leeg is. */
  function pickFile(file: File) {
    setDocFile(file);
    setDocError("");
    setDocForm((f) => (f.title.trim() ? f : { ...f, title: file.name.replace(/\.[^.]+$/, "") }));
  }

  function openDocForm() {
    setDocForm(EMPTY_KF);
    setDocFile(null);
    setDocError("");
    setDocMsg("");
    setShowDocForm(true);
  }

  function closeDocForm() {
    setShowDocForm(false);
    setDocForm(EMPTY_KF);
    setDocFile(null);
  }

  /** Eén opslag-actie: een klaargezet bestand wordt geüpload, anders wordt de
   * geplakte tekst opgeslagen. In beide gevallen gaan alle velden mee. */
  async function saveDoc(e: React.FormEvent) {
    e.preventDefault();
    const v = docForm;
    const canUpload = !!docFile;
    const canPaste = !!v.title.trim() && !!v.body.trim();
    if (!canUpload && !canPaste) {
      setDocError("Geef een titel en inhoud op, of kies een bestand.");
      return;
    }
    setDocSaving(true);
    setDocError("");
    setDocMsg("");
    try {
      let r;
      if (docFile) {
        r = await knowledgeApi.uploadDocument(
          docFile,
          v.title.trim() || undefined,
          v.category || null,
          v.folder.trim() || null,
          v.context.trim() || null,
          v.visibility,
          v.keywords.trim() || null
        );
      } else {
        r = await knowledgeApi.createDocument({
          title: v.title.trim(),
          content: v.body.trim(),
          context: v.context.trim() || null,
          keywords: v.keywords.trim() || null,
          category: v.category || null,
          visibility: v.visibility,
          folder: v.folder.trim() || null,
        });
      }
      setDocMsg(`Opgeslagen: "${r.data.title}" (${r.data.chunk_count} fragmenten)`);
      closeDocForm();
      loadDocuments();
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? "Opslaan mislukt.";
      setDocError(detail);
    } finally {
      setDocSaving(false);
    }
  }

  async function removeDoc(id: string) {
    if (!confirm("Dit document verwijderen?")) return;
    await knowledgeApi.removeDocument(id);
    loadDocuments();
  }

  /** Laat Claude de tekst van het nieuwe document herstructureren en titel/afdeling/onderwerp voorstellen. */
  async function cleanupNewDoc() {
    if (!docForm.body.trim()) return;
    setCleaning(true);
    setDocError("");
    try {
      const r = await knowledgeApi.aiCleanup(docForm.body);
      setDocForm((f) => ({
        ...f,
        title: r.data.title || f.title,
        category: (r.data.category as Category) || f.category,
        folder: r.data.folder || f.folder,
        body: r.data.content || f.body,
      }));
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Opschonen mislukt.";
      setDocError(detail);
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
        body: r.data.content,
        context: r.data.context ?? "",
        keywords: r.data.keywords ?? "",
        category: r.data.category ?? "",
        visibility: r.data.visibility ?? "all",
        folder: r.data.folder ?? "",
      });
    } catch {
      alert("Document kon niet geladen worden.");
    }
  }

  async function cleanupEditDoc() {
    if (!docEdit || !docEdit.body.trim()) return;
    setDocEditCleaning(true);
    setDocEditError("");
    try {
      const r = await knowledgeApi.aiCleanup(docEdit.body);
      setDocEdit((prev) =>
        prev
          ? {
              ...prev,
              title: r.data.title || prev.title,
              body: r.data.content || prev.body,
              category: (r.data.category as Category) ?? prev.category,
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
    if (!docEdit.title.trim() || !docEdit.body.trim()) {
      setDocEditError("Titel en inhoud zijn verplicht.");
      return;
    }
    setDocEditSaving(true);
    setDocEditError("");
    try {
      await knowledgeApi.updateDocument(docEdit.id, {
        title: docEdit.title.trim(),
        content: docEdit.body.trim(),
        context: docEdit.context.trim() || null,
        keywords: docEdit.keywords.trim() || null,
        category: docEdit.category || null,
        visibility: docEdit.visibility,
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

  /** Laat Claude het huidige kennis-item (titel + inhoud) herschrijven tot nette
   * tekst en afdeling/onderwerp voorstellen. Werkt voor nieuwe én bestaande items. */
  async function cleanupEntryForm() {
    const raw = `${form.title}\n\n${form.body}`.trim();
    if (!raw) return;
    setEntryCleaning(true);
    setError("");
    try {
      const r = await knowledgeApi.aiCleanup(raw);
      setForm((prev) => ({
        ...prev,
        title: r.data.title || prev.title,
        body: r.data.content || prev.body,
        category: (r.data.category as Category) || prev.category,
        folder: r.data.folder || prev.folder,
      }));
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ??
        "Opschonen mislukt.";
      setError(detail);
    } finally {
      setEntryCleaning(false);
    }
  }

  // --- Wachtrij acties ---

  function answerQuestion(q: KnowledgeQuestion) {
    setForm({
      ...EMPTY_FORM,
      title: q.question_text,
      body: q.proposed_answer ?? "", // voorvullen met de oplossing van de medewerker
      category: q.category ?? "",
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
      body: e.answer,
      keywords: e.keywords ?? "",
      context: e.context ?? "",
      category: e.category ?? "",
      visibility: e.visibility ?? "all",
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
      setForm((prev) => ({ ...prev, body: `${prev.body}\n\n![](${fname})`.trim() }));
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
      body: prev.body.replace(new RegExp(`!\\[[^\\]]*\\]\\(${fname}\\)`, "g"), "").trim(),
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
    if (!form.title.trim() || !form.body.trim()) {
      setError("Titel en inhoud zijn verplicht.");
      return;
    }
    setSaving(true);
    setError("");
    const payload = {
      title: form.title.trim(),
      answer: form.body.trim(),
      keywords: form.keywords.trim() || null,
      context: form.context.trim() || null,
      category: form.category || null,
      visibility: form.visibility,
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
        {tab === "documents" && (
          <button
            onClick={openDocForm}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700"
          >
            + Nieuw document
          </button>
        )}
      </div>

      {/* Zoeken door alle kennis */}
      <div className="relative">
        <input
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          placeholder="🔍 Zoek in alle kennis (items + documenten)…"
          className="block w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm"
        />
        {searchActive && (
          <button
            type="button"
            onClick={() => setSearchQ("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xl leading-none"
            title="Zoekopdracht wissen"
          >
            ×
          </button>
        )}
      </div>

      {searchActive ? (
        <SearchResultsPanel
          results={searchResults}
          loading={searching}
          onEditEntry={editEntry}
          onEditDoc={openDocEdit}
        />
      ) : (
      <>
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
                        {e.visibility !== "all" && (
                          <span className="text-[10px] font-medium bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                            {VISIBILITY_LABELS[e.visibility]}
                          </span>
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
            Voeg er een toe via <strong>+ Nieuw document</strong> — plak tekst óf kies een bestand
            (.md, .txt, .pdf of .zip). Werkt alleen als AI aanstaat.
          </p>
          {docMsg && <p className="text-sm text-blue-700">{docMsg}</p>}

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
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-gray-900">{d.title}</p>
                        {d.visibility !== "all" && (
                          <span className="text-[10px] font-medium bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                            {VISIBILITY_LABELS[d.visibility]}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-1">
                        {d.chunk_count} fragment{d.chunk_count === 1 ? "" : "en"}
                        {d.source_filename && ` · ${d.source_filename}`}
                        {d.context && " · 📝 context"}
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
      </>
      )}

      {/* Item-formulier (modal) — gedeeld component */}
      {showForm && (
        <KnowledgeFormModal
          heading={
            answeringQuestionId ? "Vraag beantwoorden" : form.id ? "Item bewerken" : "Nieuw kennis-item"
          }
          onSubmit={save}
          onCancel={() => {
            setShowForm(false);
            setAnsweringQuestionId(null);
            setFormImages([]);
          }}
          saving={saving}
          error={error}
        >
          <KnowledgeForm
            value={form}
            onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
            aiAvailable={aiSettings?.ai_available}
            onCleanup={cleanupEntryForm}
            cleaning={entryCleaning}
            images={formImages}
            onUploadImage={uploadFormImage}
            onDeleteImage={deleteFormImage}
            imageUrlFor={(name) => knowledgeApi.imageUrl(form.id!, name)}
            imagesHint={form.id ? undefined : "Sla het item eerst op; daarna kun je afbeeldingen toevoegen."}
            uploadingImg={uploadingImg}
          />
        </KnowledgeFormModal>
      )}

      {/* Nieuw document (modal) — zelfde gedeelde component */}
      {showDocForm && (
        <KnowledgeFormModal
          heading="Nieuw document"
          onSubmit={saveDoc}
          onCancel={closeDocForm}
          saving={docSaving}
          error={docError}
        >
          <KnowledgeForm
            value={docForm}
            onChange={(patch) => setDocForm((f) => ({ ...f, ...patch }))}
            aiAvailable={aiSettings?.ai_available}
            onCleanup={cleanupNewDoc}
            cleaning={cleaning}
            file={docFile}
            onPickFile={pickFile}
            onClearFile={() => setDocFile(null)}
          />
        </KnowledgeFormModal>
      )}

      {/* Document bewerken (modal) — zelfde gedeelde component */}
      {docEdit && (
        <KnowledgeFormModal
          heading="Document bewerken"
          onSubmit={saveDocEdit}
          onCancel={() => setDocEdit(null)}
          saving={docEditSaving}
          error={docEditError}
        >
          <KnowledgeForm
            value={docEdit}
            onChange={(patch) => setDocEdit((d) => (d ? { ...d, ...patch } : d))}
            aiAvailable={aiSettings?.ai_available}
            onCleanup={cleanupEditDoc}
            cleaning={docEditCleaning}
          />
        </KnowledgeFormModal>
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

/** Zoekresultaten door alle kennis (items + documenten). */
function SearchResultsPanel({
  results,
  loading,
  onEditEntry,
  onEditDoc,
}: {
  results: KnowledgeSearchResults | null;
  loading: boolean;
  onEditEntry: (e: KnowledgeEntry) => void;
  onEditDoc: (id: string) => void;
}) {
  if (loading && !results) {
    return <p className="text-sm text-gray-400">Zoeken…</p>;
  }
  if (!results) return null;

  const total = results.entries.length + results.documents.length;
  if (total === 0) {
    return (
      <p className="text-sm text-gray-400">
        Niets gevonden. Er is hier nog niets over bekend — voeg het toe via{" "}
        <strong>Kennisbank</strong> of <strong>Documenten</strong>.
      </p>
    );
  }

  function meta(category: Category | null, folder: string | null) {
    const parts: string[] = [];
    if (category) parts.push(CATEGORY_LABELS[category]);
    if (folder) parts.push(folder);
    return parts.join(" · ");
  }

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-500">
        {total} resulta{total === 1 ? "at" : "ten"} gevonden.
      </p>

      {results.entries.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
            Kennis-items
            <span className="text-xs font-normal bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">
              {results.entries.length}
            </span>
          </h3>
          {results.entries.map((e) => (
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
                </div>
                {meta(e.category, e.folder) && (
                  <p className="text-[11px] text-gray-400 mt-0.5">{meta(e.category, e.folder)}</p>
                )}
                <p className="text-sm text-gray-600 mt-1 line-clamp-2 whitespace-pre-wrap">
                  {stripImages(e.answer)}
                </p>
              </div>
              <button
                onClick={() => onEditEntry(e)}
                className="text-blue-600 px-3 py-1.5 rounded-lg text-xs hover:bg-blue-50 shrink-0"
              >
                Bewerken
              </button>
            </div>
          ))}
        </div>
      )}

      {results.documents.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-bold text-gray-800 flex items-center gap-2">
            Documenten
            <span className="text-xs font-normal bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">
              {results.documents.length}
            </span>
          </h3>
          {results.documents.map((d: KnowledgeDocumentMatch) => (
            <div
              key={d.id}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex items-start justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="font-semibold text-gray-900">{d.title}</p>
                {meta(d.category, d.folder) && (
                  <p className="text-[11px] text-gray-400 mt-0.5">{meta(d.category, d.folder)}</p>
                )}
                {d.snippet && (
                  <p className="text-sm text-gray-600 mt-1 line-clamp-3 whitespace-pre-wrap">
                    {d.snippet}
                  </p>
                )}
              </div>
              <button
                onClick={() => onEditDoc(d.id)}
                className="text-blue-600 px-3 py-1.5 rounded-lg text-xs hover:bg-blue-50 shrink-0"
              >
                Bewerken
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
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

/**
 * Eén gedeeld invul-formulier voor zowel kennis-items als documenten. Toont
 * overal exact dezelfde velden; alleen de type-eigen extra's (afbeeldingen bij
 * items, bestand-upload bij documenten) verschijnen waar ze logisch zijn.
 */
function KnowledgeForm({
  value,
  onChange,
  bodyLabel = "Informatie / inhoud",
  aiAvailable,
  onCleanup,
  cleaning,
  file,
  onPickFile,
  onClearFile,
  images,
  onUploadImage,
  onDeleteImage,
  imageUrlFor,
  imagesHint,
  uploadingImg,
}: {
  value: KFValue;
  onChange: (patch: Partial<KFValue>) => void;
  bodyLabel?: string;
  aiAvailable?: boolean;
  onCleanup?: () => void;
  cleaning?: boolean;
  file?: File | null;
  onPickFile?: (f: File) => void;
  onClearFile?: () => void;
  images?: string[];
  onUploadImage?: (f: File) => void;
  onDeleteImage?: (name: string) => void;
  imageUrlFor?: (name: string) => string;
  imagesHint?: string;
  uploadingImg?: boolean;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const allowFile = !!onPickFile;
  const showImages = imagesHint != null || !!onUploadImage;
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs font-medium text-gray-600">Titel / onderwerp</label>
        <input
          value={value.title}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="bijv. een vraag, of gewoon een onderwerp"
          className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-gray-600">{bodyLabel}</label>
        {file ? (
          <div className="mt-1 flex items-center justify-between gap-2 border border-gray-200 bg-gray-50 rounded-lg px-3 py-2">
            <span className="text-sm text-gray-700 truncate">📄 {file.name}</span>
            {onClearFile && (
              <button
                type="button"
                onClick={onClearFile}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none shrink-0"
                title="Bestand verwijderen"
              >
                ×
              </button>
            )}
          </div>
        ) : (
          <textarea
            value={value.body}
            onChange={(e) => onChange({ body: e.target.value })}
            rows={5}
            placeholder="Vrije tekst — een vraag/antwoord óf gewoon informatie."
            className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none mt-1"
          />
        )}
        {(allowFile || (aiAvailable && onCleanup)) && (
          <div className="flex items-center justify-between gap-2 mt-1.5">
            <div>
              {allowFile && !file && (
                <>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".md,.markdown,.txt,.pdf,.zip"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f && onPickFile) onPickFile(f);
                      e.target.value = "";
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg text-xs hover:bg-gray-50"
                  >
                    Bestand kiezen
                  </button>
                </>
              )}
            </div>
            {aiAvailable && onCleanup && !file && (
              <button
                type="button"
                onClick={onCleanup}
                disabled={cleaning || !value.body.trim()}
                title="Laat de AI dit herschrijven tot nette tekst en afdeling/onderwerp voorstellen"
                className="border border-purple-300 text-purple-700 px-3 py-1.5 rounded-lg text-xs hover:bg-purple-50 disabled:opacity-50"
              >
                {cleaning ? "Bezig..." : "✨ Netjes maken"}
              </button>
            )}
          </div>
        )}
        <p className="text-[11px] text-gray-400 mt-1">
          {file
            ? "De tekst wordt automatisch uit het bestand gehaald."
            : "Markdown ondersteund (koppen, lijsten, **vet**, afbeeldingen)."}
        </p>
      </div>

      <div>
        <label className="text-xs font-medium text-gray-600">Context / toelichting (optioneel)</label>
        <textarea
          value={value.context}
          onChange={(e) => onChange({ context: e.target.value })}
          rows={2}
          placeholder="bijv. waar dit over gaat of hoe het gelezen moet worden"
          className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none mt-1"
        />
      </div>

      <div>
        <label className="text-xs font-medium text-gray-600">Trefwoorden (optioneel, verbetert zoeken)</label>
        <input
          value={value.keywords}
          onChange={(e) => onChange({ keywords: e.target.value })}
          placeholder="bijv. ontkalken, reset, foutcode"
          className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1"
        />
      </div>

      {showImages && (
        <div>
          <label className="text-xs font-medium text-gray-600">Afbeeldingen</label>
          {imagesHint ? (
            <p className="text-[11px] text-gray-400 mt-1">{imagesHint}</p>
          ) : (
            <div className="mt-1 space-y-2">
              {!!images?.length && (
                <div className="flex flex-wrap gap-2">
                  {images.map((img) => (
                    <div key={img} className="relative">
                      <img
                        src={imageUrlFor ? imageUrlFor(img) : ""}
                        alt=""
                        className="h-16 w-16 object-cover rounded-lg border border-gray-200"
                      />
                      <button
                        type="button"
                        onClick={() => onDeleteImage?.(img)}
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
                    if (f) onUploadImage?.(f);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          )}
        </div>
      )}

      <div>
        <label className="text-xs font-medium text-gray-600">Afdeling (optioneel)</label>
        <select
          value={value.category}
          onChange={(e) => onChange({ category: e.target.value as Category | "" })}
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
        <label className="text-xs font-medium text-gray-600">Zichtbaar voor</label>
        <select
          value={value.visibility}
          onChange={(e) => onChange({ visibility: e.target.value as KnowledgeVisibility })}
          className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white mt-1"
        >
          {ALL_VISIBILITIES.map((v) => (
            <option key={v} value={v}>
              {VISIBILITY_LABELS[v]}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-gray-400 mt-1">
          Bepaalt wie dit ziet én via de kennisbot te horen krijgt. "Alleen afdeling" gebruikt de
          afdeling hierboven. Admin & supervisor zien (vrijwel) alles.
        </p>
      </div>

      <div>
        <label className="text-xs font-medium text-gray-600">Onderwerp / map (optioneel)</label>
        <input
          value={value.folder}
          onChange={(e) => onChange({ folder: e.target.value })}
          placeholder="bijv. Koffiemachine, Check-in, Wasserij"
          list="kb-folders"
          className="block w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mt-1"
        />
      </div>
    </div>
  );
}

/** Modal-omhulsel rond het gedeelde formulier: kop, privacy-melding, knoppen. */
function KnowledgeFormModal({
  heading,
  onSubmit,
  onCancel,
  saving,
  error,
  children,
}: {
  heading: string;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  saving: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-[60]">
      <form
        onSubmit={onSubmit}
        className="bg-white rounded-xl shadow-xl w-full max-w-lg p-5 space-y-3 max-h-[90vh] overflow-y-auto"
      >
        <h2 className="font-bold text-gray-900">{heading}</h2>
        <PrivacyNotice />
        {children}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onCancel}
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
  );
}

/** Waarschuwing tegen het opslaan van gevoelige gegevens — overal hetzelfde. */
function PrivacyNotice() {
  return (
    <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
      <span aria-hidden>⚠️</span>
      <span>
        Zet hier <strong>geen persoonsgegevens, gebruikersnamen of wachtwoorden</strong> in — de
        kennisbank is leesbaar voor medewerkers en wordt door de kennisbot gebruikt.
      </span>
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
