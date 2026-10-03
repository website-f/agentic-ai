import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";

import { cn } from "@/lib/utils";

/** Search box with a leading icon and a clear button once something is typed. */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search",
  label,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  label?: string;
  className?: string;
}) {
  return (
    <label className={cn("relative block min-w-0 flex-1 basis-56", className)}>
      <span className="sr-only">{label ?? placeholder}</span>
      <MagnifyingGlassIcon size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          "h-10 w-full rounded-sm border border-border bg-surface pr-9 pl-9 text-sm text-fg placeholder:text-muted/80",
          "transition-colors focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none",
          "[&::-webkit-search-cancel-button]:hidden",
        )}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="absolute top-1/2 right-2 grid size-6 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-fg"
        >
          <XIcon size={13} />
        </button>
      ) : null}
    </label>
  );
}
