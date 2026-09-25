import { describe, expect, it } from "vitest";
import { registrarSettingsSchema, registrarUrl } from "../../shared/registrar";

describe("registrar links", () => {
  it("defaults to a Namecheap search for the domain", () => {
    expect(registrarUrl({ preset: "namecheap" }, "example.co.uk")).toBe(
      "https://www.namecheap.com/domains/registration/results/?domain=example.co.uk",
    );
    expect(registrarUrl({ preset: "godaddy" }, "example.co.uk")).toBe(
      "https://www.godaddy.com/en-uk/domainsearch/find?domainToCheck=example.co.uk",
    );
  });

  it("supports a custom https template and encodes the domain", () => {
    const custom = { preset: "custom" as const, urlTemplate: "https://reg.example/search?q={domain}" };
    expect(registrarSettingsSchema.parse(custom)).toEqual(custom);
    expect(registrarUrl(custom, "a&b.co.uk")).toBe("https://reg.example/search?q=a%26b.co.uk");
  });

  it("rejects unsafe or incomplete custom templates", () => {
    expect(registrarSettingsSchema.safeParse({ preset: "custom", urlTemplate: "http://x/{domain}" }).success).toBe(false);
    expect(registrarSettingsSchema.safeParse({ preset: "custom", urlTemplate: "https://x/search" }).success).toBe(false);
    expect(registrarSettingsSchema.safeParse({ preset: "custom", urlTemplate: "javascript:alert(1)//{domain}" }).success).toBe(false);
  });
});
