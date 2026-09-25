import { useEffect, useState } from "react";
import { SEARCH_MODES, type SearchMode } from "../../shared/filters";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

const MODE_LABELS: Record<SearchMode, string> = {
  partial: "Contains",
  exact: "Exact",
  starts: "Starts with",
  ends: "Ends with",
};

/** Debounced server-side search input (300 ms). */
export function SearchBox({
  value,
  mode,
  onChange,
}: {
  value: string;
  mode: SearchMode;
  onChange: (value: string, mode: SearchMode) => void;
}) {
  const [text, setText] = useState(value);
  const debounced = useDebouncedValue(text, 300);

  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (debounced.trim() !== value) onChange(debounced.trim(), mode);
    // Only react to the debounced text.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <div className="flex min-w-64 flex-1 items-stretch">
      <input
        type="search"
        className="input rounded-r-none"
        placeholder="Search domains…"
        aria-label="Search domains"
        value={text}
        maxLength={63}
        onChange={(event) => setText(event.target.value)}
      />
      <select
        aria-label="Search mode"
        className="rounded-r-md border border-l-0 border-slate-300 bg-white px-2 text-sm text-slate-700"
        value={mode}
        onChange={(event) => onChange(text.trim(), event.target.value as SearchMode)}
      >
        {SEARCH_MODES.map((option) => (
          <option key={option} value={option}>
            {MODE_LABELS[option]}
          </option>
        ))}
      </select>
    </div>
  );
}
