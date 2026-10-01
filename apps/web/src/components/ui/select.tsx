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
          "inline-flex items-center justify-between gap-2 rounded-sm border border-border bg-surface px-3 text-fg",
          "hover:bg-surface-2 data-[disabled]:opacity-60",
          size === "sm" ? "h-8 text-[13px]" : "h-10 text-sm",
          className,
        )}
      >
        <S.Value placeholder={placeholder} />
        <S.Icon className="text-muted">
          <CaretDownIcon size={14} />
        </S.Icon>
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={6}
          className="z-50 min-w-[var(--radix-select-trigger-width)] rounded-[var(--radius-md)] border border-border bg-surface p-1 shadow-[var(--shadow-pop)]"
        >
          <S.Viewport>
            {options.map((o) => (
              <S.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex cursor-default flex-col rounded-sm py-2 pr-8 pl-2.5 text-[13.5px] outline-none select-none data-[highlighted]:bg-surface-2 data-[disabled]:opacity-50"
              >
                <S.ItemText>{o.label}</S.ItemText>
                {o.hint ? <span className="text-[12px] text-muted">{o.hint}</span> : null}
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
