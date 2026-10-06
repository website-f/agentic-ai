/** P27: the forms this person still has to hand in, on their desk's overview. */
import { NotepadIcon } from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { IconTile } from "@/components/page";
import { CardHeader, Card, ListCard, ListRow } from "@/components/ui/card";
import { Pill } from "@/components/ui/pill";
import { useT } from "@/i18n";
import { formsQuery, needsMe, urgency } from "@/lib/forms";
import { STATE_LABEL, whenText } from "@/pages/forms/words";

export function FormsDue() {
  const t = useT();
  const { data: forms = [] } = useQuery(formsQuery());
  const due = forms.filter(needsMe).sort((a, b) => urgency(a) - urgency(b));
  if (!due.length) return null;
  return (
    <Card data-guide="desk.forms">
      <CardHeader
        title={t("Forms to hand in")}
        icon={<IconTile icon={NotepadIcon} size="sm" tone={due.some((f) => f.state === "late" || f.state === "returned") ? "danger" : "warn"} />}
        actions={<Link to="/forms" className="text-[12.5px] font-medium text-accent hover:underline">{t("All forms")}</Link>}
      />
      <ListCard className="rounded-none border-0">
        {due.slice(0, 5).map((f) => {
          const s = STATE_LABEL[f.state];
          return (
            <ListRow
              key={f.id}
              title={<Link to="/forms" search={{ tab: "todo", form: f.id }} className="hover:text-accent">{f.name}</Link>}
              meta={whenText(t, f)}
              trailing={<Pill tone={s.tone}>{t(s.label)}</Pill>}
            />
          );
        })}
      </ListCard>
    </Card>
  );
}
