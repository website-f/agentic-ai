import { describe, expect, it } from "vitest";

import { translate } from "@/i18n";
import { MS } from "@/i18n/ms";

import { guideSteps, STEP_MARKS } from "./page-tip-marks";
import { PAGE_TIPS } from "./page-tips";

const allSteps = new Set(Object.values(PAGE_TIPS).flatMap((e) => Object.values(e).flatMap((tip) => tip?.steps ?? [])));

describe("P79 where each guide step is on its page", () => {
  it("names only steps that are in the guide", () => {
    expect(Object.keys(STEP_MARKS).filter((s) => !allSteps.has(s))).toEqual([]);
  });

  it("names each element in words the Malay page also shows", () => {
    const missing = Object.values(STEP_MARKS)
      .flat()
      .filter((l) => !(l in MS) && !(l.split("|")[0]! in MS));
    expect(missing).toEqual([]);
  });

  it("gives the tour each step in the person's language with its names", () => {
    const [step, names] = Object.entries(STEP_MARKS).find(([, l]) => l.length) ?? [];
    if (!step || !names) return;
    const tip = { what: "", steps: [step] };
    expect(guideSteps(tip, (s) => translate("ms", s))).toEqual([{ text: translate("ms", step), labels: names.map((l) => translate("ms", l)) }]);
    expect(guideSteps({ what: "", steps: ["zz no marks"] }, (s) => s)).toEqual([{ text: "zz no marks" }]);
  });
});
