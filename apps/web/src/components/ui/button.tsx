import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { Children, type ButtonHTMLAttributes, type ReactNode } from "react";

import { cn } from "@/lib/utils";

const button = cva(
  // P96: never wider than its row (a long label ends in "..." instead of running off a phone
  // screen), and `hit` gives small buttons a finger-sized (44 px) touch area on touch screens.
  "hit inline-flex max-w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-sm font-medium " +
    "transition-[background-color,color,box-shadow,transform] duration-150 select-none " +
    "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg hover:brightness-110 shadow-[var(--shadow-soft)]",
        secondary: "bg-surface-2 text-fg hover:bg-border/60",
        outline: "border border-border bg-surface text-fg hover:bg-surface-2",
        ghost: "text-muted hover:bg-surface-2 hover:text-fg",
        danger: "bg-danger text-white hover:brightness-110",
      },
      size: {
        sm: "h-8 px-3 text-[13px]",
        md: "h-10 px-4 text-sm",
        lg: "h-11 px-5 text-[15px]",
        icon: "size-10",
        "icon-sm": "size-8",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

/** Text runs inside a button become one span that can shrink and end in "..." (an icon stays
 * whole). The span inherits the button's white-space, so a button made to wrap still wraps.
 * Whitespace-only runs stay as they are: flex ignores them. */
export function buttonLabel(children: ReactNode): ReactNode {
  const parts = Children.toArray(children);
  if (!parts.some((c) => typeof c === "string" || typeof c === "number")) return children;
  const out: ReactNode[] = [];
  let run = "";
  const flush = () => {
    if (run.trim()) out.push(<span key={`t${out.length}`} className="min-w-0 overflow-hidden text-ellipsis">{run.trim()}</span>);
    run = "";
  };
  for (const c of parts) {
    if (typeof c === "string" || typeof c === "number") run += String(c);
    else {
      flush();
      out.push(c);
    }
  }
  flush();
  return out;
}

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof button> {
  asChild?: boolean;
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild,
  loading,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const classes = cn(button({ variant, size }), className);
  if (asChild) {
    // Slot merges props onto exactly one child element, so pass children through untouched.
    return (
      <Slot.Root className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading ? (
        <span
          aria-hidden
          className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
        />
      ) : null}
      {buttonLabel(children)}
    </button>
  );
}
