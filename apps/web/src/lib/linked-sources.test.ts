import { describe, expect, it } from "vitest";

import { looksLikeLink } from "./linked-sources";

describe("P80 SharePoint links", () => {
  it("takes https SharePoint and OneDrive links", () => {
    for (const u of [
      "https://maju.sharepoint.com/:f:/s/HR/EtAbCdEf?e=xyz",
      " https://maju-my.sharepoint.com/personal/boss/Documents/SOP ",
      "https://onedrive.live.com/?id=ABC",
      "https://1drv.ms/f/s!AbCd",
    ]) expect(looksLikeLink(u)).toBe(true);
  });

  it("refuses anything else before asking the server", () => {
    for (const u of [
      "",
      "http://maju.sharepoint.com/sites/HR",
      "https://evil.com/maju.sharepoint.com",
      "https://maju.sharepoint.com.evil.com/x",
      "https://user:pw@maju.sharepoint.com/x",
      "https://maju.sharepoint.com:8443/x",
      "https://maju.sharepoint.com/a b",
      "javascript:alert(1)",
      "maju.sharepoint.com/sites/HR",
    ]) expect(looksLikeLink(u)).toBe(false);
  });
});
