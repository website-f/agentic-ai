import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

const FRONT = /^---\n[\s\S]*?\n---\n?/;
const LINK = /\[\[([^\]|#\n]+)(?:#[^\]|\n]*)?(?:\|([^\]\n]*))?\]\]/g;

export function stripFrontmatter(body: string): string {
  return body.replace(FRONT, "");
}

/** Lower-case file name without .md: what a [[link]] resolves by (same rule as the API). */
export function linkName(target: string): string {
  return target.trim().split("/").pop()!.replace(/\.md$/i, "").toLowerCase();
}

/** Markdown with Obsidian-style [[links]]. Raw HTML is never rendered. */
export function WikiMarkdown({
  body,
  resolve,
  onOpen,
  title,
  className,
}: {
  body: string;
  /** [[name]] -> the page it points to, or null when no such page exists yet. */
  resolve: (name: string) => { path: string; title: string } | null;
  onOpen: (path: string | null, name: string) => void;
  /** The page title already shown above: a leading "# <title>" line is not repeated. */
  title?: string;
  className?: string;
}) {
  const t = useT();
  let text = stripFrontmatter(body);
  const first = /^\s*#\s+(.+)\n?/.exec(text);
  if (title && first?.[1]?.trim() === title.trim()) text = text.slice(first[0].length);
  // [[target|alias]] -> [alias](#wiki/target); the link renderer below turns it into a button.
  const md = text.replace(LINK, (_m, target: string, alias?: string) => {
    // Obsidian shows the alias if given; otherwise we show the page's title, not its file name.
    const label = (alias ?? resolve(linkName(target))?.title ?? target).trim().replace(/[[\]]/g, "");
    return `[${label}](#wiki/${encodeURIComponent(target.trim())})`;
  });
  return (
    <div className={cn("md text-[14px] leading-relaxed", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            if (href?.startsWith("#wiki/")) {
              const name = linkName(decodeURIComponent(href.slice(6)));
              const path = resolve(name)?.path ?? null;
              return (
                <button
                  type="button"
                  onClick={() => onOpen(path, name)}
                  title={path ?? t("No page called “{name}” yet", { name })}
                  className={cn(
                    "underline underline-offset-2",
                    path ? "text-accent" : "text-muted decoration-dashed",
                  )}
                >
                  {children}
                </button>
              );
            }
            return (
              <a href={href} target="_blank" rel="noreferrer noopener" className="text-accent underline underline-offset-2">
                {children}
              </a>
            );
          },
        }}
      >
        {md}
      </ReactMarkdown>
    </div>
  );
}
