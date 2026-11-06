/**
 * P73: the floating feedback button in the office, on every signed-in page while the developer
 * has feedback switched on (Feedbacks page). Mounted once at the root (router.tsx), so it is also
 * over full-screen pages. The button itself is core.tsx; Prima gets the same button from the
 * stand-alone widget (feedback-widget/).
 */
import { useQuery } from "@tanstack/react-query";
import { useRouterState } from "@tanstack/react-router";

import { useT } from "@/i18n";
import { feedbackConfigQuery } from "@/lib/feedback";
import { meQuery } from "@/lib/queries";
import type { Me } from "@/lib/types";
import { navItemFor } from "@/nav";

import { Feedback, type FeedbackPage } from "./core";
import { RulesPanel } from "./rules-panel";

// Pages without the button: signing in, and the client presentation.
const NO_BUTTON = ["/login", "/setup", "/change-password", "/two-step-setup", "/present", "/erased"];

function pageInfo(path: string, t: (s: string) => string): FeedbackPage {
  const item = navItemFor(path);
  return { path, title: item ? t(item.label) : document.title.slice(0, 200) };
}

export function FeedbackHost() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const hidden = NO_BUTTON.some((p) => path === p || path.startsWith(`${p}/`));
  const me = useQuery({ ...meQuery, enabled: !hidden });
  const signedIn = !!me.data && !me.data.user.must_change_password && !me.data.user.two_factor_setup_required;
  const cfg = useQuery({ ...feedbackConfigQuery, enabled: signedIn && !hidden });
  if (hidden || !signedIn || !cfg.data?.enabled || !me.data) return null;
  return <OfficeFeedback me={me.data} path={path} />;
}

function OfficeFeedback({ me, path }: { me: Me; path: string }) {
  const t = useT();
  return (
    <Feedback
      page={() => pageInfo(path, t)}
      rules={({ rules, onClose, onTour }) => <RulesPanel me={me} path={path} rules={rules} onClose={onClose} onTour={onTour} />}
    />
  );
}
