/** A translated sentence with styled parts inside it: `<Trans text={t("Cost {cost} so far")}
 * values={{ cost: <b>RM 4</b> }} />`. The whole sentence stays one key, so the Malay word
 * order can differ from the English. */
import { Fragment, type ReactNode } from "react";

export function Trans({ text, values }: { text: string; values: Record<string, ReactNode> }) {
  const parts = text.split(/\{(\w+)\}/g);
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <Fragment key={i}>{p in values ? values[p] : `{${p}}`}</Fragment> : p ? <Fragment key={i}>{p}</Fragment> : null))}
    </>
  );
}
