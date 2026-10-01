import { Label, Switch as S } from "radix-ui";
import { useId, type ReactNode } from "react";

interface SwitchFieldProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  hint?: ReactNode;
  disabled?: boolean;
}

export function SwitchField({ checked, onCheckedChange, label, hint, disabled }: SwitchFieldProps) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="grid gap-0.5">
        <Label.Root htmlFor={id} className="text-[13.5px] font-medium">
          {label}
        </Label.Root>
        {hint ? <p className="text-[12.5px] text-muted">{hint}</p> : null}
      </div>
      <S.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        className="relative mt-0.5 h-6 w-10 shrink-0 rounded-full bg-border transition-colors data-[state=checked]:bg-accent disabled:opacity-50"
      >
        <S.Thumb className="block size-5 translate-x-0.5 rounded-full bg-white shadow-sm transition-transform duration-200 data-[state=checked]:translate-x-[18px]" />
      </S.Root>
    </div>
  );
}
