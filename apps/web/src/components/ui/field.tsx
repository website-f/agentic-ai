import { Label } from "radix-ui";
import { useId, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-sm border border-border bg-surface px-3 text-sm text-fg",
        "placeholder:text-muted/80 transition-colors",
        "focus-visible:border-accent focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-accent/20",
        "aria-[invalid=true]:border-danger aria-[invalid=true]:ring-danger/15",
        "disabled:opacity-60",
        className,
      )}
      {...props}
    />
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  error?: string;
}

/** Label above, hint optional, error below. Never placeholder-as-label. */
export function Field({ label, hint, error, id, className, ...props }: FieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label.Root htmlFor={inputId} className="text-[13px] font-medium text-fg">
        {label}
      </Label.Root>
      <Input id={inputId} aria-invalid={!!error} aria-describedby={describedBy} {...props} />
      {error ? (
        <p id={`${inputId}-error`} className="text-[12.5px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="text-[12.5px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="rounded-sm border border-danger/30 bg-danger/8 px-3 py-2 text-[13px] text-danger"
    >
      {message}
    </div>
  );
}

interface TextareaFieldProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  hint?: ReactNode;
  error?: string;
}

export function TextareaField({ label, hint, error, id, className, ...props }: TextareaFieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label.Root htmlFor={inputId} className="text-[13px] font-medium text-fg">
        {label}
      </Label.Root>
      <textarea
        id={inputId}
        aria-invalid={!!error}
        className={cn(
          "min-h-24 w-full rounded-sm border border-border bg-surface px-3 py-2 text-[13.5px] leading-relaxed text-fg",
          "placeholder:text-muted/80 focus-visible:border-accent focus-visible:ring-3 focus-visible:ring-accent/20 focus-visible:outline-none",
          "aria-[invalid=true]:border-danger",
        )}
        {...props}
      />
      {error ? <p className="text-[12.5px] text-danger">{error}</p> : hint ? <p className="text-[12.5px] text-muted">{hint}</p> : null}
    </div>
  );
}
