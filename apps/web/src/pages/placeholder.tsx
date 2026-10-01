import { CompassIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";

import { EmptyState, Page, PageHeader } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/ui/pill";
import type { NavItem } from "@/nav";

/** Designed holding page for sections that ship in a later phase. */
export function PlaceholderPage({ item }: { item: NavItem }) {
  return (
    <Page>
      <PageHeader title={item.label} actions={item.phase ? <Pill tone="accent">Arrives in {item.phase}</Pill> : null} />
      <EmptyState
        icon={item.icon}
        title={`${item.label} is on the roadmap`}
        body={item.blurb}
        action={
          <Button variant="outline" asChild>
            <Link to="/">Back to Command center</Link>
          </Button>
        }
      />
    </Page>
  );
}

export function NotFoundPage() {
  return (
    <Page>
      <EmptyState
        icon={CompassIcon}
        title="This page does not exist"
        body="The link may be old, or the page may have moved."
        action={
          <Button asChild>
            <Link to="/">Go to Command center</Link>
          </Button>
        }
      />
    </Page>
  );
}
