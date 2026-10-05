import { CompassIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import { useT } from "@/i18n";
import type { NavItem } from "@/nav";

/** Designed holding page for sections that ship in a later phase. */
export function PlaceholderPage({ item }: { item: NavItem }) {
  const t = useT();
  return (
    <Page>
      <PageHeader title={t(item.label)} actions={item.phase ? <Pill tone="accent">{t("Arrives in {phase}", { phase: item.phase })}</Pill> : null} />
      <EmptyState
        icon={item.icon}
        title={t("{page} is on the roadmap", { page: t(item.label) })}
        body={t(item.blurb)}
        action={
          <Button variant="outline" asChild>
            <Link to="/">{t("Back to Command center")}</Link>
          </Button>
        }
      />
    </Page>
  );
}

export function NotFoundPage() {
  const t = useT();
  return (
    <Page>
      <EmptyState
        icon={CompassIcon}
        title={t("This page does not exist")}
        body={t("The link may be old, or the page may have moved.")}
        action={
          <Button asChild>
            <Link to="/">{t("Go to Command center")}</Link>
          </Button>
        }
      />
    </Page>
  );
}
