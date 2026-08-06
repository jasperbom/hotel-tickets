import { useRef, useState, type ReactNode } from "react";

export interface MentionUser {
  ha_user_id: string;
  display_name: string;
}

/**
 * Textarea met @-autocomplete: typ "@" gevolgd door (een deel van) de naam
 * van een collega en kies uit de lijst. De gekozen naam wordt als
 * "@Volledige Naam" in de tekst gezet — de backend herkent die mentions.
 */
export function MentionTextarea({
  value,
  onChange,
  users,
  placeholder,
  rows = 2,
  className = "",
  autoFocus,
  resizable = false,
}: {
  value: string;
  onChange: (value: string) => void;
  users: MentionUser[];
  placeholder?: string;
  rows?: number;
  className?: string;
  autoFocus?: boolean;
  /** Toon een sleep-greep waarmee de hoogte handmatig aangepast kan worden
   *  (werkt ook met touch, handig op mobiel waar het vak vaak te klein is). */
  resizable?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<string | null>(null);
  const [queryStart, setQueryStart] = useState(0); // positie van de "@"
  const [highlighted, setHighlighted] = useState(0);
  const [height, setHeight] = useState<number | null>(null);
  const dragStart = useRef<{ y: number; h: number } | null>(null);

  function startResize(e: React.PointerEvent<HTMLDivElement>) {
    const el = textareaRef.current;
    if (!el) return;
    e.preventDefault();
    dragStart.current = { y: e.clientY, h: el.offsetHeight };
    e.currentTarget.setPointerCapture(e.pointerId);
  }
  function moveResize(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragStart.current) return;
    const next = dragStart.current.h + (e.clientY - dragStart.current.y);
    setHeight(Math.max(56, Math.min(600, next)));
  }
  function endResize(e: React.PointerEvent<HTMLDivElement>) {
    dragStart.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  const suggestions =
    query === null
      ? []
      : users
          .filter((u) => {
            const q = query.toLowerCase();
            if (!q) return true;
            const name = u.display_name.toLowerCase();
            return name.startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q));
          })
          .slice(0, 6);

  function updateQuery(text: string, caret: number) {
    // Zoek een "@" vóór de cursor met daarna alleen naam-tekens (max 30)
    const before = text.slice(0, caret);
    const match = before.match(/@([\p{L}\p{N}]{0,30})$/u);
    if (match && (match.index === 0 || /[\s([{.,;:!?]/.test(before[match.index! - 1]))) {
      setQuery(match[1]);
      setQueryStart(match.index!);
      setHighlighted(0);
    } else {
      setQuery(null);
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    onChange(e.target.value);
    updateQuery(e.target.value, e.target.selectionStart ?? e.target.value.length);
  }

  function insertMention(user: MentionUser) {
    const caret = textareaRef.current?.selectionStart ?? value.length;
    const inserted = `@${user.display_name} `;
    const newValue = value.slice(0, queryStart) + inserted + value.slice(caret);
    onChange(newValue);
    setQuery(null);
    // Cursor achter de ingevoegde naam zetten
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        const pos = queryStart + inserted.length;
        el.setSelectionRange(pos, pos);
      }
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (query === null || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => (h + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => (h - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      insertMention(suggestions[Math.min(highlighted, suggestions.length - 1)]);
    } else if (e.key === "Escape") {
      setQuery(null);
    }
  }

  return (
    <div className="relative flex-1 min-w-0">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onClick={(e) => updateQuery(value, (e.target as HTMLTextAreaElement).selectionStart ?? 0)}
        onBlur={() => setTimeout(() => setQuery(null), 150)}
        placeholder={placeholder}
        rows={rows}
        autoFocus={autoFocus}
        className={className}
        style={height !== null ? { height } : undefined}
      />
      {resizable && (
        <div
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Sleep om het vak groter of kleiner te maken"
          title="Sleep om het vak groter of kleiner te maken"
          className="mt-0.5 h-5 flex items-center justify-center cursor-ns-resize touch-none select-none"
        >
          <span className="h-1 w-10 rounded-full bg-ink-25 hover:bg-gray-400 transition-colors" />
        </div>
      )}
      {query !== null && suggestions.length > 0 && (
        <div className="absolute bottom-full left-0 mb-1 w-full max-w-xs bg-paper-raised border border-ink-12 rounded-xl shadow-lg z-20 py-1 overflow-hidden">
          {suggestions.map((u, i) => (
            <button
              key={u.ha_user_id}
              type="button"
              // onMouseDown i.p.v. onClick zodat de blur van de textarea de
              // dropdown niet sluit vóór de klik verwerkt is
              onMouseDown={(e) => { e.preventDefault(); insertMention(u); }}
              onMouseEnter={() => setHighlighted(i)}
              className={`flex items-center gap-2 w-full px-3 py-2 text-sm text-left ${
                i === highlighted ? "bg-ink-6 text-brand" : "text-ink-70"
              }`}
            >
              <span className="w-6 h-6 rounded-full bg-ink-6 text-brand text-xs font-bold flex items-center justify-center shrink-0">
                {u.display_name.charAt(0).toUpperCase()}
              </span>
              <span className="truncate">{u.display_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Render commentaartekst waarbij @-mentions van bekende collega's
 * gemarkeerd worden weergegeven.
 */
export function renderWithMentions(body: string, userNames: string[]): ReactNode {
  const names = userNames.filter(Boolean).sort((a, b) => b.length - a.length);
  if (names.length === 0) return body;
  const escaped = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const regex = new RegExp(`@(${escaped.join("|")})(?![\\p{L}\\p{N}])`, "giu");
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(body)) !== null) {
    if (m.index > last) parts.push(body.slice(last, m.index));
    parts.push(
      <span key={key++} className="text-brand bg-ink-6 font-semibold rounded px-0.5">
        {m[0]}
      </span>
    );
    last = m.index + m[0].length;
  }
  if (last < body.length) parts.push(body.slice(last));
  return parts;
}
