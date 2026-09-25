import { useEffect, useState } from "react";
import { useDebouncedValue } from "../hooks/useDebouncedValue";

/** Compact min/max length inputs bound to the minLength/maxLength filters (debounced). */
export function LengthInputs({
  min,
  max,
  onChange,
}: {
  min: number | undefined;
  max: number | undefined;
  onChange: (min: number | undefined, max: number | undefined) => void;
}) {
  const [draftMin, setDraftMin] = useState(min === undefined ? "" : String(min));
  const [draftMax, setDraftMax] = useState(max === undefined ? "" : String(max));
  const debouncedMin = useDebouncedValue(draftMin, 400);
  const debouncedMax = useDebouncedValue(draftMax, 400);

  // Follow external changes (URL navigation, filter panel, clear).
  useEffect(() => setDraftMin(min === undefined ? "" : String(min)), [min]);
  useEffect(() => setDraftMax(max === undefined ? "" : String(max)), [max]);

  useEffect(() => {
    const nextMin = debouncedMin === "" ? undefined : Number(debouncedMin);
    const nextMax = debouncedMax === "" ? undefined : Number(debouncedMax);
    if (nextMin !== min || nextMax !== max) onChange(nextMin, nextMax);
    // Only react to the debounced drafts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedMin, debouncedMax]);

  const input = (value: string, set: (value: string) => void, label: string) => (
    <input
      type="number"
      min={1}
      max={63}
      inputMode="numeric"
      aria-label={label}
      placeholder={label === "Minimum length" ? "min" : "max"}
      value={value}
      onChange={(event) => set(event.target.value.replace(/[^0-9]/g, ""))}
      className="w-16 rounded-md border border-slate-300 bg-white px-2 py-1 text-sm focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none"
    />
  );

  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-slate-600">
      Length
      {input(draftMin, setDraftMin, "Minimum length")}
      <span aria-hidden>–</span>
      {input(draftMax, setDraftMax, "Maximum length")}
    </span>
  );
}
