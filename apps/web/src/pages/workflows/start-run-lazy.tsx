/** P104: the "Run a workflow" dialog, loaded when it opens. My workspace offers it on every
 * workflow card, and its code (the run view, Markdown, approvals) would otherwise come with
 * the workspace's first screen. */
import { lazy, Suspense, type ComponentProps } from "react";

const StartRunDialog = lazy(() => import("./run").then((m) => ({ default: m.StartRunDialog })));

export function LazyStartRunDialog(props: ComponentProps<typeof StartRunDialog>) {
  return (
    <Suspense fallback={null}>
      <StartRunDialog {...props} />
    </Suspense>
  );
}
