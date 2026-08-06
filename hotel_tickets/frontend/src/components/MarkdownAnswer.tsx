import ReactMarkdown from "react-markdown";
import { knowledgeApi } from "../api/client";

/**
 * Toont het antwoord van een kennis-entry als Markdown. Afbeeldingen die als
 * kale bestandsnaam in de markdown staan (zoals na import herschreven) worden
 * gekoppeld aan de afbeeldings-URL van de entry. Externe URLs (http/https) en
 * data-URI's blijven ongewijzigd.
 */
export default function MarkdownAnswer({
  entryId,
  text,
}: {
  entryId: string;
  text: string;
}) {
  return (
    <div className="prose prose-sm max-w-none text-ink-70 break-words">
      <ReactMarkdown
        components={{
          img: ({ src, alt }) => {
            const raw = typeof src === "string" ? src : "";
            const isExternal = /^(https?:|data:)/i.test(raw);
            const url = isExternal ? raw : knowledgeApi.imageUrl(entryId, raw);
            return (
              <img
                src={url}
                alt={alt ?? ""}
                className="rounded-lg border border-ink-12 my-2 max-h-80"
              />
            );
          },
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-brand underline">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
