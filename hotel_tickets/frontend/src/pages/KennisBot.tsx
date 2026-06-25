import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { knowledgeApi, type ChatTurn } from "../api/client";

interface ChatMessage {
  role: "user" | "bot";
  content: string;
  kind?: "answer" | "no_answer";
  question?: string; // originele vraag (voor 'maak ticket')
}

const WELCOME =
  "Hoi! Ik ben de kennisbot. Stel je vraag of beschrijf waar je tegenaan loopt, " +
  "dan help ik je stap voor stap op basis van onze eigen kennis.";

export default function KennisBot() {
  const navigate = useNavigate();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Scroll mee naar beneden bij nieuwe berichten
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function send() {
    const q = input.trim();
    if (!q || sending) return;
    const userMsg: ChatMessage = { role: "user", content: q };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setSending(true);

    // Bouw geschiedenis uit de vorige berichten (max 10 beurten)
    const history: ChatTurn[] = messages
      .slice(-10)
      .map((m) => ({ role: m.role === "user" ? "user" : "assistant", content: m.content }));

    try {
      const res = await knowledgeApi.ask(q, null, history);
      const d = res.data;
      let botMsg: ChatMessage;
      if (d.answered) {
        const content =
          d.ai_answer || d.entries.map((e) => e.answer).join("\n\n") || "—";
        botMsg = { role: "bot", content, kind: "answer" };
      } else {
        botMsg = {
          role: "bot",
          kind: "no_answer",
          question: q,
          content:
            "Daar heb ik helaas geen antwoord op gevonden in onze kennisbank. " +
            "Ik heb je vraag doorgegeven aan het beheer, zodat dit later beantwoord kan worden.",
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
    <div className="flex flex-col h-[calc(100dvh-7rem)] max-w-2xl mx-auto">
      <div className="flex items-center gap-2 mb-3 shrink-0">
        <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
          Kennisbot
          <span className="text-[10px] font-bold uppercase tracking-wide bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
            Beta
          </span>
        </h1>
      </div>

      {/* Gespreksvenster */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {/* Welkomstbericht */}
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
                  <button
                    onClick={() => makeTicket(m.question)}
                    className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs hover:bg-blue-700"
                  >
                    Maak hier een ticket van
                  </button>
                </div>
              ) : (
                <div className="prose prose-sm max-w-none text-gray-700 break-words">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
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

        <div ref={scrollRef} />
      </div>

      {/* Invoer */}
      <div className="shrink-0 pt-3">
        <div className="flex items-end gap-2 bg-white rounded-2xl border border-gray-300 p-2 shadow-sm">
          <textarea
            ref={taRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Stel je vraag..."
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
          De bot antwoordt alleen op basis van onze eigen kennis.
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
