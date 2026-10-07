/** "Linked to 1 computer · online": a small link to My computers, for My AI and My assistants. */
import { DesktopTowerIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { useT } from "@/i18n";
import { devicesQuery, devicesSummary } from "@/lib/devices";
import { cn } from "@/lib/utils";

export function ComputersLink({ className }: { className?: string }) {
  const t = useT();
  const { data, isError } = useQuery(devicesQuery);
  if (isError || !data) return null;
  const s = devicesSummary(data);
  const label = !s.count ? t("Link a computer")
    : s.count === 1 ? (s.online ? t("Linked to 1 computer · online") : t("Linked to 1 computer · offline"))
    : t("Linked to {n} computers · {online} online", { n: s.count, online: s.online });
  return (
    <Link to="/computers" search={s.count ? {} : { link: 1 }} title={t("My computers")}
      className={cn("inline-flex min-h-9 min-w-0 items-center gap-1.5 rounded-sm px-1 text-[12.5px] text-muted transition-colors hover:text-accent", className)}>
      <span className="relative shrink-0">
        <DesktopTowerIcon size={16} weight="duotone" />
        {s.count ? <span aria-hidden className={cn("absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-surface", s.online ? "bg-ok" : "bg-border")} /> : null}
      </span>
      <span className="truncate">{label}</span>
    </Link>
  );
}
