/** P57: an erase in progress, then the certificate of deletion. Needs no session (the erase
 * signs everyone out): /erased?id=&token= carries the access token the start answered with. */
import { CheckCircleIcon, CircleIcon, DownloadSimpleIcon, SpinnerGapIcon } from "@phosphor-icons/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { LanguageSwitch } from "@/components/language-switch";
import { Wordmark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { FormError } from "@/components/ui/field";
import { useT } from "@/i18n";
import { api, errorMessage } from "@/lib/api";
import { type ErasureOut, ERASE_STEPS } from "@/lib/erase";
import { cn } from "@/lib/utils";

function readParams(): { id: string; token: string } {
  const p = new URLSearchParams(window.location.search);
  let id = p.get("id") ?? "";
  let token = p.get("token") ?? "";
  if (!id || !token) {
    try {
      const saved = JSON.parse(localStorage.getItem("agentic.erasure") ?? "{}") as { id?: string; token?: string };
      id = id || saved.id || "";
      token = token || saved.token || "";
    } catch {
      /* nothing saved */
    }
  }
  return { id, token };
}

export function ErasedPage() {
  const t = useT();
  const { id, token } = readParams();
  const q = useQuery({
    queryKey: ["erasure", id],
    enabled: !!id && !!token,
    queryFn: () => api<ErasureOut>(`/api/erasure/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`),
    refetchInterval: (query) => (query.state.data?.status === "erasing" || !query.state.data ? 2000 : false),
  });
  const retry = useMutation({
    mutationFn: () => api<ErasureOut>(`/api/erasure/${encodeURIComponent(id)}/retry`, "POST", { token }),
    onSuccess: () => q.refetch(),
  });
  const r = q.data;
  const at = r ? ERASE_STEPS.findIndex((s) => s.key === r.step) : -1;
  const done = r?.status === "done";
  const cert = (fmt: "pdf" | "json") => `/api/erasure/${encodeURIComponent(id)}/certificate.${fmt}?token=${encodeURIComponent(token)}`;
  return (
    <div className="min-h-dvh bg-bg px-4 py-8 sm:py-14">
      <div className="mx-auto grid max-w-xl gap-6">
        <div className="flex items-center justify-between gap-3">
          <Wordmark />
          <LanguageSwitch />
        </div>
        <Card>
          <CardBody className="grid gap-5">
            <div className="min-w-0">
              <h1 className="text-[19px] font-semibold break-words">
                {done ? t("{name} was erased", { name: r?.workspace_name ?? "" }) : t("Erasing {name}", { name: r?.workspace_name ?? "" })}
              </h1>
              <p className="mt-1 text-[13px] text-muted">
                {done
                  ? t("Download the certificate of deletion now and keep it: it is the proof for your client. This page stops working once you leave it without the link.")
                  : t("Keep this page open. Everyone was signed out; the erase goes on without you.")}
              </p>
            </div>
            {!id || !token ? <FormError message={t("This link is incomplete. Open the link from the erase again.")} /> : null}
            {q.error ? <FormError message={errorMessage(q.error)} /> : null}
            {r ? (
              <ol className="grid gap-2">
                {ERASE_STEPS.map((s, i) => {
                  const finished = done || i < at;
                  const current = !done && i === at && r.status === "erasing";
                  return (
                    <li key={s.key} className={cn("flex items-center gap-2.5 text-[13.5px]", !finished && !current && "text-muted")}>
                      {finished ? (
                        <CheckCircleIcon size={18} weight="fill" className="shrink-0 text-ok" />
                      ) : current ? (
                        <SpinnerGapIcon size={18} className="shrink-0 animate-spin text-accent" />
                      ) : (
                        <CircleIcon size={18} className="shrink-0" />
                      )}
                      <span className="min-w-0">{t(s.label)}</span>
                    </li>
                  );
                })}
              </ol>
            ) : null}
            {r?.status === "failed" ? (
              <div className="grid gap-2">
                <FormError message={t("The erase stopped part-way: {why}", { why: r.error ?? "" })} />
                <div>
                  <Button variant="danger" loading={retry.isPending} onClick={() => retry.mutate()}>{t("Try the erase again")}</Button>
                </div>
                <FormError message={retry.error ? errorMessage(retry.error) : null} />
              </div>
            ) : null}
            {done ? (
              <div className="grid gap-3">
                <div className="flex flex-wrap gap-2">
                  <Button asChild>
                    <a href={cert("pdf")}><DownloadSimpleIcon size={16} /> {t("Certificate (PDF)")}</a>
                  </Button>
                  <Button asChild variant="outline">
                    <a href={cert("json")}><DownloadSimpleIcon size={16} /> {t("Certificate (JSON)")}</a>
                  </Button>
                </div>
                {r?.certificate_sha256 ? (
                  <p className="font-mono text-[11.5px] break-all text-muted">SHA-256 {r.certificate_sha256}</p>
                ) : null}
                <p className="text-[12.5px] text-muted">
                  {t("Accounts that belonged only to this workspace were closed. If you also belong to another workspace, sign in again to reach it.")}
                </p>
                <div>
                  <Button asChild variant="outline">
                    <Link to="/login">{t("Sign in")}</Link>
                  </Button>
                </div>
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
