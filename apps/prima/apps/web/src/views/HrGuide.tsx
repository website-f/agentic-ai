import { useState } from "react";
import { hrGuideCardsFor, type User } from "@prima/core";
import { useApp } from "../App";
import { useLang } from "../i18n";

/**
 * HR task guide cards (review, 2 Nov 2026): read-only help, Bahasa Melayu first with English. The cards and who sees them
 * come from packages/core/src/hr-guide-cards.ts, the same mapping Arisha reads; the server's permissions still decide
 * every action. The staff side (Clock) shows the staff tasks; the HR screen shows the rest.
 */
const STAFF_VIEWS = new Set(["mine", "clock"]);

export function HrGuide({ staffSide = false }: { staffSide?: boolean }) {
  const { me } = useApp();
  const { lang } = useLang();
  const [open, setOpen] = useState<string | null>(null);
  const cards = hrGuideCardsFor(me.user as unknown as User).filter((c) => STAFF_VIEWS.has(c.screen.view ?? "") === staffSide);
  if (!cards.length) return null;
  const en = lang === "en";
  const t = (x: { bm: string; en: string }) =>
    en ? (
      x.en
    ) : (
      <>
        {x.bm}
        <span className="muted small" style={{ display: "block" }}>
          {x.en}
        </span>
      </>
    );
  const row = (bm: string, eng: string, body: React.ReactNode) => (
    <div>
      <strong>{en ? eng : bm}:</strong> {body}
    </div>
  );
  return (
    <section className="panel" aria-label="HR guide">
      <div className="panel-head">
        <div>
          <h2>{en ? "How to do it" : "Panduan langkah demi langkah"}</h2>
          <div className="muted small">{en ? "Help only: it does not save or approve anything." : "Panduan sahaja: ia tidak menyimpan atau meluluskan apa-apa."}</div>
        </div>
      </div>
      <div className="list">
        {cards.map((c) => (
          <div key={c.id} className="list-item" style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}>
            <button className="link-button" aria-expanded={open === c.id} onClick={() => setOpen(open === c.id ? null : c.id)} style={{ textAlign: "left" }}>
              <span style={{ fontWeight: 600 }}>{en ? c.title.en : c.title.bm}</span>
              {c.status !== "ready" && <span className="muted small"> · {en ? "partly built" : "sebahagian dibina"}</span>}
            </button>
            {open === c.id && (
              <div className="small" style={{ display: "grid", gap: 6 }}>
                <div>{t(c.purpose)}</div>
                {row("Siapa", "Who", t(c.who))}
                {row("Di mana", "Where", <>{c.screen.name} → {t(c.screen.action)}</>)}
                {!!c.fields?.length && (
                  <div>
                    <strong>{en ? "What to enter" : "Apa yang perlu diisi"}:</strong>
                    <ul style={{ margin: "4px 0 0 18px" }}>
                      {c.fields.map((x) => (
                        <li key={x.key}>
                          {x.label} {x.required ? "" : en ? "(optional)" : "(pilihan)"} · <span className="muted">{en ? x.format.en : x.format.bm}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {row(
                  "Dokumen dan siapa ditanya",
                  "Documents and whom to ask",
                  c.sources.map((s, i) => (
                    <div key={i}>
                      {t(s.what)}
                      {s.askDesk && <span className="muted"> ({en ? "ask" : "tanya"}: {s.askDesk === "hr" ? "HR" : s.askDesk === "it" ? "IT" : s.askDesk === "chief_of_staff" ? "Chief of Staff office" : s.askDesk === "company_office" ? (en ? "the company office" : "pejabat syarikat") : s.askDesk})</span>}
                    </div>
                  )),
                )}
                {row("Diisi sekali sahaja", "Entered once", t(c.enteredOnce))}
                {row("Simpan", "Save", t(c.steps.save))}
                {row("Semakan", "Review", t(c.steps.review))}
                {row("Jika dipulangkan", "If returned", t(c.steps.returned))}
                {row("Selesai", "Done", t(c.steps.done))}
                {row("Jika ada masalah", "If it goes wrong", t(c.steps.recover))}
                {c.notVerified.length > 0 &&
                  row(
                    "Belum dibina atau belum disahkan",
                    "Not built or not verified",
                    c.notVerified.map((n, i) => <div key={i}>{t(n)}</div>),
                  )}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
