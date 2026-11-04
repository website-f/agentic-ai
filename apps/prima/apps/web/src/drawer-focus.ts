/** Bounded focus lifecycle, not a complete focus trap or accessibility certification. */
const stack: HTMLElement[] = [];
const top = () => stack.filter(el => el.isConnected).at(-1);
export function activateDrawer(dialog: HTMLElement, close: () => void, doc: Document = document) {
  const previous = doc.activeElement as HTMLElement | null;
  const nested = stack.findIndex(el => dialog.contains(el));
  if (nested < 0) stack.push(dialog); else stack.splice(nested, 0, dialog);
  if (top() === dialog) dialog.focus({ preventScroll: true });
  const onKey = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || top() !== dialog) return;
    event.preventDefault(); event.stopPropagation(); close();
  };
  doc.addEventListener('keydown', onKey);
  return () => {
    doc.removeEventListener('keydown', onKey);
    const wasTop = stack.at(-1) === dialog; // React may detach the node before passive cleanup.
    const active = doc.activeElement;
    const index = stack.indexOf(dialog); if (index >= 0) stack.splice(index, 1);
    // Never steal focus that the user/application deliberately moved elsewhere.
    if (!wasTop || (active && active !== doc.body && !dialog.contains(active))) return;
    const remaining = top();
    if (previous?.isConnected && (!remaining || remaining.contains(previous))) previous.focus({ preventScroll: true });
    else remaining?.focus({ preventScroll: true });
  };
}
