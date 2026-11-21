import { describe, expect, it } from "vitest";

import { domainOf, isConsumerDomain, kindOfEmail } from "./mail-kind";

describe("work or personal (P122)", () => {
  it("free mail is always personal", () => {
    for (const d of ["outlook.com", "hotmail.com", "hotmail.co.uk", "live.com.my", "msn.com", "gmail.com", "yahoo.com.my"]) {
      expect(isConsumerDomain(d)).toBe(true);
    }
    expect(isConsumerDomain("maju.com.my")).toBe(false);
    expect(kindOfEmail("me@gmail.com", ["gmail.com"])).toBe("personal");
  });

  it("an address on a company domain is work", () => {
    expect(kindOfEmail("Tender@Maju.com.my", ["maju.com.my"])).toBe("work");
    expect(kindOfEmail("me@other.com.my", ["maju.com.my"])).toBe("personal");
    expect(domainOf("a@B.example.")).toBe("b.example");
    expect(domainOf("nothing")).toBe("");
  });
});
