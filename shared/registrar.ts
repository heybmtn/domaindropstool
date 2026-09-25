import { z } from "zod";

/**
 * Registrar used for "check availability" links. Clicking a domain opens the
 * registrar's search page for it in a new tab.
 */
export const REGISTRAR_PRESETS = {
  namecheap: {
    label: "Namecheap",
    urlTemplate: "https://www.namecheap.com/domains/registration/results/?domain={domain}",
  },
  godaddy: {
    label: "GoDaddy",
    urlTemplate: "https://www.godaddy.com/en-uk/domainsearch/find?domainToCheck={domain}",
  },
} as const;

export type RegistrarPreset = keyof typeof REGISTRAR_PRESETS | "custom";

export const registrarSettingsSchema = z
  .object({
    preset: z.enum(["namecheap", "godaddy", "custom"]),
    /** Used when preset is "custom": an https URL containing {domain}. */
    urlTemplate: z.string().trim().max(500).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.preset !== "custom") return;
    const template = value.urlTemplate ?? "";
    if (!template.startsWith("https://") || !template.includes("{domain}")) {
      ctx.addIssue({
        code: "custom",
        path: ["urlTemplate"],
        message: "Custom registrar URL must start with https:// and contain {domain}.",
      });
    }
  });

export type RegistrarSettings = z.infer<typeof registrarSettingsSchema>;

export const DEFAULT_REGISTRAR: RegistrarSettings = { preset: "namecheap" };

export function registrarTemplate(settings: RegistrarSettings): string {
  if (settings.preset === "custom" && settings.urlTemplate) return settings.urlTemplate;
  const preset = settings.preset === "custom" ? "namecheap" : settings.preset;
  return REGISTRAR_PRESETS[preset].urlTemplate;
}

export function registrarLabel(settings: RegistrarSettings): string {
  if (settings.preset === "custom") return "registrar";
  return REGISTRAR_PRESETS[settings.preset].label;
}

/** Builds the availability-search URL for a domain (the domain is URL-encoded). */
export function registrarUrl(settings: RegistrarSettings, domain: string): string {
  return registrarTemplate(settings).replaceAll("{domain}", encodeURIComponent(domain));
}
