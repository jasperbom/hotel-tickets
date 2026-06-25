import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { knowledgeApi, type ChatTurn } from "../api/client";

interface ChatMessage {
  role: "user" | "bot";
  content: string;
  kind?: "answer" | "no_answer";
  question?: string; // originele vraag (voor 'maak ticket')
  questionId?: string; // id van de gelogde vraag (voor 'oplossing aandragen')
}

const WELCOME =
  "Hoi! Ik ben Jaisper, de kennisbot. Stel je vraag of beschrijf waar je tegenaan " +
  "loopt, dan help ik je stap voor stap op basis van onze eigen kennis.";

export default function KennisBot() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  // Als gezet: het volgende bericht is de oplossing voor deze vraag-id
  const [solutionFor, setSolutionFor] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Houd de berichtenlijst onderaan wanneer er een bericht bijkomt. We scrollen
  // alléén de lijst zelf — een scrollIntoView() zou op iOS de hele webview
  // kunnen verschuiven en het invoerveld omhoog laten springen.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  // Op iOS schuift het virtuele toetsenbord de layout-viewport niet in (anders dan
  // Android met interactive-widget=resizes-content): 100dvh blijft de volledige
  // hoogte en het toetsenbord dekt content af. Daardoor scrolt de webview de hele
  // pagina omhoog (de bovenkant/navigatie verdwijnt) en springt de layout.
  //
  // Oplossing: zolang deze pagina open is, zetten we de hele app-shell vast op de
  // hoogte van de zichtbare zone (visualViewport). Via de body-class `kb-fit`
  // wordt de app-root op `--app-vh` gepind (zie index.css). Zo krimpt de hele
  // pagina mee wanneer het toetsenbord opent: de navigatie blijft bovenaan staan
  // en de invoerbalk zakt netjes tot vlak boven het toetsenbord.
  useEffect(() => {
    const isTouch = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
    if (!isTouch) return;
    const vv = window.visualViewport;
    const root = document.documentElement;
    document.body.classList.add("kb-fit");
    let raf = 0;
    const update = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const h = vv ? vv.height : window.innerHeight;
        root.style.setProperty("--app-vh", `${Math.round(h)}px`);
        // Houd de layout-viewport bovenaan gepind zodat iOS de navigatie niet
        // alsnog wegscrollt bij het focussen van het invoerveld.
        window.scrollTo(0, 0);
        const el = listRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    };
    update();
    if (vv) {
      vv.addEventListener("resize", update);
      vv.addEventListener("scroll", update);
    }
    return () => {
      document.body.classList.remove("kb-fit");
      root.style.removeProperty("--app-vh");
      if (vv) {
        vv.removeEventListener("resize", update);
        vv.removeEventListener("scroll", update);
      }
      cancelAnimationFrame(raf);
    };
  }, []);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;

    // ── Oplossing-modus: medewerker beschrijft hoe hij/zij het oploste ──
    if (solutionFor) {
      setMessages((prev) => [...prev, { role: "user", content: text }]);
      setInput("");
      setSending(true);
      const qid = solutionFor;
      setSolutionFor(null);
      // Stuur het gesprek mee zodat het beheer de context van de vraag ziet
      const convo: ChatTurn[] = [
        ...messages
          .slice(-10)
          .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content }) as ChatTurn),
        { role: "user", content: text },
      ];
      try {
        const res = await knowledgeApi.submitSolution(qid, text, convo);
        const content =
          res.data.status === "already_known"
            ? "Bedankt! Dit staat eigenlijk al in onze kennis, dus ik hoef het niet apart " +
              "door te geven. 👍"
            : "Bedankt! Ik heb je oplossing klaargezet voor het beheer om aan de kennisbank " +
              "toe te voegen. Zo kan ik anderen hier voortaan direct mee helpen. 🙌";
        setMessages((prev) => [...prev, { role: "bot", content }]);
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "bot", content: "Het opslaan van de oplossing ging mis. Probeer het zo nog eens." },
        ]);
      } finally {
        setSending(false);
        taRef.current?.focus();
      }
      return;
    }

    // ── Normale vraag ──
    const userMsg: ChatMessage = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);

    const history: ChatTurn[] = messages
      .slice(-10)
      .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content }));

    try {
      const res = await knowledgeApi.ask(text, null, history);
      const d = res.data;
      let botMsg: ChatMessage;
      if (d.answered) {
        const content = d.ai_answer || d.entries.map((e) => e.answer).join("\n\n") || "—";
        botMsg = { role: "bot", content, kind: "answer", question: text, questionId: d.question_id };
      } else {
        botMsg = {
          role: "bot",
          kind: "no_answer",
          question: text,
          questionId: d.question_id,
          content:
            "Daar heb ik helaas geen antwoord op gevonden in onze kennisbank. Ik heb je vraag " +
            "doorgegeven aan het beheer. Heb je het zelf opgelost? Dan voeg ik de oplossing " +
            "graag toe zodat ik anderen er voortaan mee kan helpen.",
        };
      }
      setMessages((prev) => [...prev, botMsg]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "bot", content: "Er ging iets mis. Probeer het zo nog eens." },
      ]);
    } finally {
      setSending(false);
      taRef.current?.focus();
    }
  }

  function startSolution(questionId?: string) {
    if (!questionId) return;
    setSolutionFor(questionId);
    setMessages((prev) => [
      ...prev,
      {
        role: "bot",
        content:
          "Top dat je het zelf hebt opgelost! Wat was de oplossing? Beschrijf kort wat je hebt " +
          "gedaan, dan zet ik het klaar voor het beheer.",
      },
    ]);
    setTimeout(() => taRef.current?.focus(), 0);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  function makeTicket(question?: string) {
    navigate("/tickets/new", { state: { title: question ?? "" } });
  }

  return (
    <div
      data-no-kb-scroll
      className="flex flex-col max-w-2xl mx-auto"
      style={{ height: "calc(var(--app-vh, 100dvh) - 7rem)" }}
    >
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          Jaisper
          <span className="text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
            Beta
          </span>
        </h1>
      </div>

      {/* Gespreksvenster */}
      <div ref={listRef} className="flex-1 overflow-y-auto space-y-3 pr-1">
        <BotBubble>
          <p className="text-sm text-gray-700">{WELCOME}</p>
        </BotBubble>

        {messages.map((m, i) =>
          m.role === "user" ? (
            <div key={i} className="flex justify-end">
              <div className="bg-blue-600 text-white rounded-2xl rounded-br-sm px-4 py-2 max-w-[85%] whitespace-pre-wrap text-sm">
                {m.content}
              </div>
            </div>
          ) : (
            <BotBubble key={i}>
              {m.kind === "no_answer" ? (
                <div className="space-y-2">
                  <p className="text-sm text-gray-700">{m.content}</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => startSolution(m.questionId)}
                      className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs hover:bg-blue-700"
                    >
                      Ik heb het zelf opgelost
                    </button>
                    <button
                      onClick={() => makeTicket(m.question)}
                      className="border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg text-xs hover:bg-gray-50"
                    >
                      Maak hier een ticket van
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="prose prose-sm max-w-none text-gray-700 break-words">
                    <ReactMarkdown>{m.content}</ReactMarkdown>
                  </div>
                  {m.kind === "answer" && m.questionId && (
                    <button
                      onClick={() => startSolution(m.questionId)}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Ik loste het anders op
                    </button>
                  )}
                </div>
              )}
            </BotBubble>
          )
        )}

        {sending && (
          <BotBubble>
            <div className="flex gap-1 py-1">
              <Dot /> <Dot /> <Dot />
            </div>
          </BotBubble>
        )}
      </div>

      {/* Invoer */}
      <div className="shrink-0 pt-3">
        {solutionFor && (
          <div className="flex items-center justify-between text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 mb-2">
            <span>Je beschrijft nu de oplossing voor het beheer.</span>
            <button onClick={() => setSolutionFor(null)} className="underline">
              Annuleren
            </button>
          </div>
        )}
        <div className="flex items-end gap-2 bg-white rounded-2xl border border-gray-300 p-2 shadow-sm">
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={solutionFor ? "Beschrijf de oplossing..." : "Stel je vraag..."}
            rows={1}
            className="flex-1 resize-none border-0 focus:ring-0 focus:outline-none text-sm px-2 py-1.5 max-h-32"
          />
          <button
            onClick={send}
            disabled={sending || !input.trim()}
            className="bg-blue-600 text-white rounded-xl px-4 py-2 text-sm hover:bg-blue-700 disabled:opacity-40 shrink-0"
          >
            Stuur
          </button>
        </div>
        <p className="text-[11px] text-gray-400 text-center mt-1.5">
          Jaisper antwoordt alleen op basis van onze eigen kennis.
        </p>
      </div>
    </div>
  );
}

function BotBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-start">
      <div className="flex gap-2 max-w-[90%]">
        <div className="shrink-0 w-7 h-7 rounded-full bg-amber-100 flex items-center justify-center text-sm">
          🤖
        </div>
        <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-4 py-2.5 shadow-sm">
          {children}
        </div>
      </div>
    </div>
  );
}

function Dot() {
  return <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" />;
}
