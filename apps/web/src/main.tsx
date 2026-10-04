import "./styles.css";

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Toaster } from "sonner";

import { ApiError } from "@/lib/api";
import { useTheme } from "@/lib/stores";
import { makeRouter } from "@/router";

// Session ended or a password change became mandatory while the app was open:
// send the person to the right screen instead of showing a broken page.
function handleAuthError(error: unknown) {
  if (!(error instanceof ApiError)) return;
  const path = window.location.pathname;
  if (error.status === 401 && !["/login", "/setup"].includes(path)) {
    queryClient.clear();
    router.navigate({ to: "/login", search: { next: path } });
  } else if (error.code === "password_change_required" && path !== "/change-password") {
    router.navigate({ to: "/change-password" });
  }
}

const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleAuthError }),
  mutationCache: new MutationCache({ onError: handleAuthError }),
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: (count, error) => !(error instanceof ApiError && error.status < 500 && error.status !== 0) && count < 2,
    },
  },
});

const router = makeRouter(queryClient);

function ThemedToaster() {
  const pref = useTheme((s) => s.pref);
  return (
    <Toaster
      theme={pref}
      position="top-center"
      toastOptions={{
        classNames: {
          toast: "!bg-surface !text-fg !border-border !rounded-[var(--radius-md)] !shadow-[var(--shadow-pop)]",
          description: "!text-muted",
        },
      }}
    />
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <ThemedToaster />
    </QueryClientProvider>
  </StrictMode>,
);

if (import.meta.env.PROD) {
  import("virtual:pwa-register").then(({ registerSW }) =>
    registerSW({
      immediate: true,
      // A tab left open never navigates, so it would keep the old app forever. Look for a
      // new version every 15 minutes and whenever the tab comes back; autoUpdate reloads
      // the page once the new version has taken over.
      onRegisteredSW(_url, reg) {
        if (!reg) return;
        const check = () => {
          if (navigator.onLine) reg.update().catch(() => {});
        };
        setInterval(check, 15 * 60 * 1000);
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") check();
        });
        window.addEventListener("focus", check);
      },
    }),
  );
}
