import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { api, errorMessage } from "./api";
import { resetLive } from "./live";
import { dropPushOnSignOut } from "./push";
import { resetUserStores } from "./stores";

/** Never let a slow step hold up signing out. */
function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

export function useSignOut() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    // While still signed in: stop this device's notifications, so the next person on it does
    // not get this person's approvals. The server also drops it with the session (push_endpoint).
    const pushEndpoint = await within(dropPushOnSignOut(), 3000, null);
    try {
      await api("/api/auth/logout", "POST", pushEndpoint ? { push_endpoint: pushEndpoint } : {});
    } catch (e) {
      toast.error(errorMessage(e));
    }
    resetLive();
    resetUserStores();
    qc.clear();
    // The session is gone, so unsaved edits could not be saved anyway: do not stop at the guard.
    navigate({ to: "/login", ignoreBlocker: true });
  };
}
