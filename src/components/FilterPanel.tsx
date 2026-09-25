import { useEffect, useState, type ReactNode } from "react";
import {
  activeFilterCount,
  DOMAIN_STATUSES,
  domainFilterSchema,
  RESEARCH_STATES,
  USER_STATUSES,
  type DomainFilter,
} from "../../shared/filters";
import { Button } from "./ui";

type NumericKey = {
  [K in keyof DomainFilter]-?: NonNullable<DomainFilter[K]> extends number ? K : never;
}[keyof DomainFilter];
type TextKey = "contains" | "excludes" | "startsWith" | "endsWith";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</legend>
      <div className="grid grid-cols-2 gap-2">{children}</div>
    </fieldset>
  );
}

const RESEARCH_LABELS: Record<string, string> = {
  completed: "Researched",
  none: "Not researched",
  failed: "Research failed",
  pending: "Research pending",
};

const TRI_STATE = [
  { value: "", label: "Any" },
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

/**
 * Server-side filter editor. Edits a local draft and applies on submit so
 * typing into number fields does not fire a query per keystroke.
 */
export function FilterPanel({ filter, onApply }: { filter: DomainFilter; onApply: (filter: DomainFilter) => void }) {
  const [draft, setDraft] = useState<DomainFilter>(filter);
  useEffect(() => setDraft(filter), [filter]);

  const set = (patch: Partial<DomainFilter>) => setDraft((current) => ({ ...current, ...patch }));

  const numberInput = (key: NumericKey, label: string, placeholder?: string) => (
    <label className="min-w-0">
      <span className="label">{label}</span>
      <input
        className="input"
        type="number"
        min={0}
        inputMode="numeric"
        placeholder={placeholder}
        value={draft[key] ?? ""}
        onChange={(event) => set({ [key]: event.target.value === "" ? undefined : Number(event.target.value) })}
      />
    </label>
  );

  const textInput = (key: TextKey, label: string) => (
    <label className="min-w-0">
      <span className="label">{label}</span>
      <input className="input" value={draft[key] ?? ""} onChange={(event) => set({ [key]: event.target.value || undefined })} />
    </label>
  );

  const triState = (key: "hasNumbers" | "hasHyphen", label: string) => (
    <label className="min-w-0">
      <span className="label">{label}</span>
      <select
        className="input"
        value={draft[key] === undefined ? "" : String(draft[key])}
        onChange={(event) => set({ [key]: event.target.value === "" ? undefined : event.target.value === "true" })}
      >
        {TRI_STATE.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );

  const apply = () => {
    const parsed = domainFilterSchema.safeParse(
      Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== undefined && value !== "")),
    );
    onApply(parsed.success ? parsed.data : {});
  };

  return (
    <form
      className="grid gap-5 border-b border-slate-100 bg-slate-50/60 p-4 md:grid-cols-2 xl:grid-cols-4"
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      <Section title="Domain">
        {numberInput("minLength", "Min length")}
        {numberInput("maxLength", "Max length")}
        {textInput("contains", "Contains")}
        {textInput("excludes", "Excludes")}
        {textInput("startsWith", "Starts with")}
        {textInput("endsWith", "Ends with")}
        {triState("hasNumbers", "Has numbers")}
        {triState("hasHyphen", "Has hyphen")}
        {numberInput("maxHyphens", "Max hyphens")}
        {numberInput("maxNumbers", "Max numbers")}
        <label className="col-span-2">
          <span className="label">Words (heuristic)</span>
          <select
            className="input"
            value={draft.words ?? ""}
            onChange={(event) => set({ words: event.target.value === "" ? undefined : Number(event.target.value) })}
          >
            <option value="">Any</option>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n} word{n === 1 ? "" : "s"}
              </option>
            ))}
          </select>
        </label>
      </Section>

      <Section title="Drop">
        <label className="col-span-2">
          <span className="label">Drop date</span>
          <div className="flex gap-1">
            <input
              className="input"
              type="date"
              value={draft.dropDate && /^\d/.test(draft.dropDate) ? draft.dropDate : ""}
              onChange={(event) => set({ dropDate: event.target.value || undefined })}
            />
            {(["today", "tomorrow"] as const).map((value) => (
              <Button key={value} size="sm" variant={draft.dropDate === value ? "primary" : "secondary"} onClick={() => set({ dropDate: draft.dropDate === value ? undefined : value })}>
                {value}
              </Button>
            ))}
          </div>
        </label>
        <label>
          <span className="label">From</span>
          <input className="input" type="date" value={draft.dropFrom ?? ""} onChange={(event) => set({ dropFrom: event.target.value || undefined })} />
        </label>
        <label>
          <span className="label">To</span>
          <input className="input" type="date" value={draft.dropTo ?? ""} onChange={(event) => set({ dropTo: event.target.value || undefined })} />
        </label>
        <label className="col-span-2">
          <span className="label">Domain status</span>
          <select className="input" value={draft.domainStatus ?? ""} onChange={(event) => set({ domainStatus: (event.target.value || undefined) as DomainFilter["domainStatus"] })}>
            <option value="">Any</option>
            {DOMAIN_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
      </Section>

      <Section title="SEO (latest research)">
        {numberInput("minBacklinks", "Min backlinks")}
        {numberInput("maxBacklinks", "Max backlinks")}
        {numberInput("minReferringDomains", "Min ref. domains")}
        {numberInput("maxReferringDomains", "Max ref. domains")}
        {numberInput("minOrganicTraffic", "Min traffic")}
        {numberInput("maxOrganicTraffic", "Max traffic")}
        {numberInput("minOrganicKeywords", "Min keywords")}
        {numberInput("maxOrganicKeywords", "Max keywords")}
        {numberInput("minScore", "Min research score")}
      </Section>

      <Section title="Research & status">
        <label className="col-span-2">
          <span className="label">Research</span>
          <select className="input" value={draft.research ?? ""} onChange={(event) => set({ research: (event.target.value || undefined) as DomainFilter["research"] })}>
            <option value="">Any</option>
            {RESEARCH_STATES.map((state) => (
              <option key={state} value={state}>
                {RESEARCH_LABELS[state]}
              </option>
            ))}
          </select>
        </label>
        <div className="col-span-2">{numberInput("researchOlderThanDays", "Research older than (days)")}</div>
        <label className="col-span-2">
          <span className="label">My status</span>
          <select className="input" value={draft.userStatus ?? ""} onChange={(event) => set({ userStatus: (event.target.value || undefined) as DomainFilter["userStatus"] })}>
            <option value="">Any</option>
            {USER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label className="col-span-2 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={draft.hideIgnored === true} onChange={(event) => set({ hideIgnored: event.target.checked || undefined })} />
          Hide ignored domains
        </label>
      </Section>

      <div className="flex gap-2 md:col-span-2 xl:col-span-4">
        <Button type="submit" variant="primary">
          Apply filters
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            const cleared: DomainFilter = draft.q ? { q: draft.q, searchMode: draft.searchMode } : {};
            setDraft(cleared);
            onApply(cleared);
          }}
        >
          Clear all
        </Button>
        <span className="self-center text-xs text-slate-500">{activeFilterCount(draft)} conditions</span>
      </div>
    </form>
  );
}
