import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Markdown } from "./markdown";

describe("Markdown tables", () => {
  it("labels every body cell with its column header (for stacked cards in narrow panels)", () => {
    const { container } = render(<Markdown>{"| Campaign | Spend **MYR** |\n| --- | --- |\n| Raya | 1,200 |\n| Merdeka | 900 |"}</Markdown>);
    const cells = [...container.querySelectorAll("tbody td")].map((td) => td.getAttribute("data-label"));
    expect(cells).toEqual(["Campaign", "Spend MYR", "Campaign", "Spend MYR"]);
  });
});
