import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

import { api, errorMessage } from "./api";

export function useSignOut() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return async () => {
    try {
      await api("/api/auth/logout", "POST");
    } catch (e) {
      toast.error(errorMessage(e));
    }
    qc.clear();
    navigate({ to: "/login" });
  };
}
