import { CaretDownIcon, CheckIcon } from "@phosphor-icons/react";
import { Select as S } from "radix-ui";

import { cn } from "@/lib/utils";

interface Option {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: Option[];
  label?: string;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
  placeholder?: string;
}

export function Select({ value, onValueChange, options, label, disabled, size = "md", className, placeholder }: SelectProps) {
  return (
    <S.Root value={value} onValueChange={onValueChange} disabled={disabled}>
      <S.Trigger
        aria-label={label}
        className={cn(
          "inline-flex max-w-full min-w-0 items-center justify-between gap-2 rounded-sm border border-border bg-surface px-3 text-fg",
          "hover:bg-surface-2 data-[disabled]:opacity-60",
          size === "sm" ? "h-8 text-[13px]" : "h-10 text-sm",
          className,
        )}
      >
        {/* A long value truncates instead of widening the trigger (and its form) past the screen. */}
        <span className="min-w-0 truncate text-left">
          <S.Value placeholder={placeholder} />
        </span>
        <S.Icon className="shrink-0 text-muted">
          <CaretDownIcon size={14} />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        {/* Popper content is not sized by Radix: cap it to the room between the trigger and the
            screen edge (both ways), so a long list scrolls inside the viewport instead of running
            off-screen where it cannot be reached (the page behind is scroll-locked). */}
        <S.Content
          position="popper"
          sideOffset={6}
          className={cn(
            "z-50 max-h-[var(--radix-select-content-available-height)] max-w-[var(--radix-select-content-available-width)] min-w-[var(--radix-select-trigger-width)]",
            "overflow-hidden rounded-[var(--radius-md)] border border-border bg-surface shadow-[var(--shadow-pop)]",
          )}
        >
          {/* Radix hides the viewport's scrollbar (it expects scroll buttons, which loop React 19 into
              "maximum update depth" on touch): bring back the app's thin scrollbar so more is visible. */}
          <S.Viewport className="min-h-0 touch-pan-y overscroll-contain p-1 [scrollbar-width:thin]! [&::-webkit-scrollbar]:block!">
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex min-w-0 cursor-default flex-col rounded-sm py-2 pr-8 pl-2.5 text-[13.5px] outline-none select-none data-[highlighted]:bg-surface-2 data-[disabled]:opacity-50"
              >
                <S.ItemText className="truncate">{o.label}</S.ItemText>
                {o.hint ? <span className="line-clamp-2 text-[12px] break-words text-muted">{o.hint}</span> : null}
                <S.ItemIndicator className="absolute top-2.5 right-2.5 text-accent">
                  <CheckIcon size={14} weight="bold" />
                </S.ItemIndicator>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
