import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

type HNode = { type: string; tagName?: string; properties?: Record<string, unknown>; children?: HNode[]; value?: string };

const kids = (n: HNode, tag: string) => (n.children ?? []).filter((c) => c.tagName === tag);
const text = (n: HNode): string => (n.type === "text" ? (n.value ?? "") : (n.children ?? []).map(text).join(""));

/**
 * Gives every table cell a `data-label` with its column header, so a narrow container (a phone,
 * a side sheet) can show a wide table as stacked label/value cards instead of scrolling sideways.
 */
function labelTableCells() {
  return (tree: HNode) => {
    const walk = (n: HNode) => {
      if (n.tagName === "table") {
        const headRow = kids(n, "thead").flatMap((h) => kids(h, "tr"))[0];
        const labels = headRow ? kids(headRow, "th").map((th) => text(th).trim()) : [];
        for (const tr of kids(n, "tbody").flatMap((b) => kids(b, "tr"))) {
          kids(tr, "td").forEach((td, i) => {
            if (labels[i]) td.properties = { ...td.properties, dataLabel: labels[i] };
          });
        }
        return;
      }
      n.children?.forEach(walk);
    };
    walk(tree);
  };
}

/** Agent output and SOPs. Raw HTML is not rendered (react-markdown default), links open in a new tab. */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("md min-w-0 text-[14px] leading-relaxed break-words [&>*:first-child]:mt-0!", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[labelTableCells]}
        components={{
          a: ({ href, children: c }) => (
            <a href={href} target="_blank" rel="noreferrer noopener" className="text-accent underline underline-offset-2 [overflow-wrap:anywhere]">
              {c}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
