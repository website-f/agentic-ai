/** P81: how to switch the camera or location back on, for this phone and browser first, the others folded away. */
import { useMemo } from 'react';
import { detectPlatform, permissionHelp, type PermKind } from './checkin-permissions';

export function PermissionHelp({ kind, compact }: { kind: PermKind; compact?: boolean }) {
  const help = useMemo(() => permissionHelp(kind, detectPlatform(navigator.userAgent, navigator.maxTouchPoints ?? 0)), [kind]);
  return (
    <div className="ci-help" data-compact={compact ? '' : undefined}>
      {help.inAppNote && (
        <p className="notice small" data-tone="warn">
          {help.inAppNote}
        </p>
      )}
      <p className="ci-help-title">{help.mine.title}</p>
      <ol className="ci-help-steps">
        {help.mine.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <details className="ci-help-more">
        <summary>Another phone or browser?</summary>
        {help.others.map((g) => (
          <div key={g.id} className="ci-help-other">
            <p className="ci-help-title">{g.title}</p>
            <ol className="ci-help-steps">
              {g.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </div>
        ))}
      </details>
    </div>
  );
}
