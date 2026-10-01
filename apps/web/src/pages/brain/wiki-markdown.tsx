import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

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
  className,
}: {
  body: string;
  resolve: (name: string) => string | null;
  onOpen: (path: string | null, name: string) => void;
  className?: string;
}) {
  // [[target|alias]] -> [alias](#wiki/target); the link renderer below turns it into a button.
  const md = stripFrontmatter(body).replace(LINK, (_m, target: string, alias?: string) => {
    const label = (alias ?? target).trim().replace(/[[\]]/g, "");
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
              const path = resolve(name);
              return (
                <button
                  type="button"
                  onClick={() => onOpen(path, name)}
                  title={path ?? `No page called “${name}” yet`}
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
