import { BookOpenTextIcon } from '@phosphor-icons/react';
import { useApp } from '../App';

/**
 * P121: a small "How it works" button for a screen's head (PageHead actions) or a panel, opening that flow in the SOP and
 * workflow guide (#sop/<id>), or an app's flows (#sop/<app id>). Hidden when the person has no guide in their menu.
 * It does not import the guide's text, so a screen stays light.
 */
export function SopHelp({ id, label = 'How it works' }: { id: string; label?: string }) {
  const { go, canOpen } = useApp();
  if (!canOpen?.('sop')) return null;
  return (
    <button type="button" className="btn btn-sm" onClick={() => go({ view: 'sop', tab: id })} title="Open the SOP for this">
      <BookOpenTextIcon size={16} aria-hidden="true" /> <span>{label}</span>
    </button>
  );
}
