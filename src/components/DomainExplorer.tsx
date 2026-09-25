import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import type { DomainRow, Paginated } from "../../shared/api";
import { activeFilterCount, filterToSearchParams, USER_STATUSES, type DomainFilter, type UserStatus } from "../../shared/filters";
import { toApiQuery, useDomainQueryState, type DomainQueryState } from "../hooks/useDomainQueryState";
import { useLocalStorageState } from "../hooks/useLocalStorageState";
import { api, downloadCsv, errorText } from "../lib/api";
import { formatNumber } from "../lib/format";
import { keys, useSavedFilters, useSetUserStatus, useShortlist } from "../lib/queries";
import { ColumnPicker } from "./ColumnPicker";
import { DEFAULT_VISIBLE_COLUMNS } from "./domainColumns";
import { DomainTable } from "./DomainTable";
import { FilterPanel } from "./FilterPanel";
import { Pagination } from "./Pagination";
import { ResearchConfirmModal } from "./ResearchConfirmModal";
import { SaveFilterModal } from "./SaveFilterModal";
import { SearchBox } from "./SearchBox";
import { useToast } from "./Toast";
import { Badge, Button, EmptyState, ErrorState, LoadingState } from "./ui";

interface QuickFilter {
  label: string;
  patch: Partial<DomainFilter>;
  isActive: (filter: DomainFilter) => boolean;
}

const QUICK_FILTERS: QuickFilter[] = [
  { label: "Drops today", patch: { dropDate: "today" }, isActive: (f) => f.dropDate === "today" },
  { label: "Tomorrow", patch: { dropDate: "tomorrow" }, isActive: (f) => f.dropDate === "tomorrow" },
  { label: "≤ 10 chars", patch: { maxLength: 10 }, isActive: (f) => f.maxLength === 10 },
  { label: "No hyphens", patch: { hasHyphen: false }, isActive: (f) => f.hasHyphen === false },
  { label: "No numbers", patch: { hasNumbers: false }, isActive: (f) => f.hasNumbers === false },
  { label: "Researched", patch: { research: "completed" }, isActive: (f) => f.research === "completed" },
  { label: "Not researched", patch: { research: "none" }, isActive: (f) => f.research === "none" },
];

/**
 * Search + filters + table + bulk actions. The browser only ever holds one
 * page of rows; everything else happens server-side.
 */
export function DomainExplorer({
  defaults,
  fixedFilter,
  exportScope = "filter",
  columnsKey = "ddr.columns",
  defaultColumns = DEFAULT_VISIBLE_COLUMNS,
}: {
  defaults?: Partial<DomainQueryState>;
  /** Filter always applied (e.g. shortlisted=true on the shortlist page). */
  fixedFilter?: DomainFilter;
  exportScope?: "filter" | "shortlist";
  columnsKey?: string;
  defaultColumns?: string[];
}) {
  const state = useDomainQueryState(defaults);
  const toast = useToast();
  const [showFilters, setShowFilters] = useState(false);
  const [columns, setColumns] = useLocalStorageState<string[]>(columnsKey, defaultColumns);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [allFilteredSelected, setAllFilteredSelected] = useState(false);
  const [researchTarget, setResearchTarget] = useState<{ ids?: number[]; filter?: DomainFilter } | null>(null);
  const [saveOpen, setSaveOpen] = useState(false);
  const shortlist = useShortlist();
  const setStatus = useSetUserStatus();
  const savedFilters = useSavedFilters();

  const effectiveFilter = useMemo(() => ({ ...state.filter, ...fixedFilter }), [state.filter, fixedFilter]);
  const apiQuery = toApiQuery({ ...state, filter: effectiveFilter });
  const query = useQuery({
    queryKey: keys.domains(apiQuery),
    queryFn: () => api.get<Paginated<DomainRow>>(`/domains?${apiQuery}`),
    placeholderData: keepPreviousData,
  });

  // Selection is scoped to the current result set.
  useEffect(() => {
    setSelected(new Set());
    setAllFilteredSelected(false);
  }, [JSON.stringify(effectiveFilter)]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = query.data?.items ?? [];
  const total = query.data?.total ?? 0;
  const selectedIds = [...selected];
  const selectionCount = allFilteredSelected ? total : selectedIds.length;

  const toggle = (id: number) => {
    setAllFilteredSelected(false);
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const togglePage = (checked: boolean) => {
    setAllFilteredSelected(false);
    setSelected((current) => {
      const next = new Set(current);
      for (const row of rows) {
        if (checked) next.add(row.id);
        else next.delete(row.id);
      }
      return next;
    });
  };

  const run = async (label: string, action: () => Promise<unknown>) => {
    try {
      await action();
      toast(label, "success");
      setSelected(new Set());
      setAllFilteredSelected(false);
    } catch (error) {
      toast(errorText(error), "error");
    }
  };

  const exportCsv = async (scope: "selected" | "filter" | "shortlist") => {
    try {
      if (scope === "selected") await downloadCsv(`/export?scope=selected&ids=${selectedIds.join(",")}`, "domains-selected.csv");
      else if (scope === "shortlist") await downloadCsv("/export?scope=shortlist", "shortlist.csv");
      else await downloadCsv(`/export?scope=filter&${filterToSearchParams(effectiveFilter).toString()}`, "domains.csv");
    } catch (error) {
      toast(errorText(error), "error");
    }
  };

  const filterCount = activeFilterCount(state.filter);

  return (
    <div className="card overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
        <SearchBox
          value={state.filter.q ?? ""}
          mode={state.filter.searchMode ?? "partial"}
          onChange={(q, searchMode) => state.patchFilter({ q: q || undefined, searchMode: searchMode === "partial" ? undefined : searchMode })}
        />
        <Button onClick={() => setShowFilters((value) => !value)} aria-expanded={showFilters}>
          Filters {filterCount > 0 && <Badge tone="blue">{filterCount}</Badge>}
        </Button>
        {savedFilters.data && savedFilters.data.items.length > 0 && (
          <select
            aria-label="Apply a saved filter"
            className="input w-auto"
            value=""
            onChange={(event) => {
              const saved = savedFilters.data.items.find((item) => String(item.id) === event.target.value);
              if (saved) state.setFilter(saved.configuration);
            }}
          >
            <option value="">Saved filters…</option>
            {savedFilters.data.items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        )}
        <Button variant="ghost" onClick={() => setSaveOpen(true)} disabled={Object.keys(state.filter).length === 0}>
          Save filter
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" onClick={() => exportCsv(exportScope)}>
            {exportScope === "shortlist" ? "Export Shortlist" : "Export Current Filter"}
          </Button>
          <ColumnPicker visible={columns} onChange={setColumns} />
        </div>
      </div>

      {/* Quick filters */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-100 px-3 py-2">
        {QUICK_FILTERS.map((quick) => {
          const active = quick.isActive(state.filter);
          return (
            <button
              key={quick.label}
              type="button"
              onClick={() =>
                state.patchFilter(
                  active ? Object.fromEntries(Object.keys(quick.patch).map((key) => [key, undefined])) : quick.patch,
                )
              }
              className={`rounded-full border px-2.5 py-0.5 text-xs ${active ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
            >
              {quick.label}
            </button>
          );
        })}
        {filterCount > 0 && (
          <button type="button" className="ml-1 text-xs text-slate-500 underline" onClick={() => state.setFilter({})}>
            Clear
          </button>
        )}
      </div>

      {showFilters && <FilterPanel filter={state.filter} onApply={(filter) => state.setFilter(filter)} />}

      {/* Bulk actions */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-sm">
        <span className="text-slate-600">
          {selectionCount > 0 ? (
            <>
              <strong className="tabular">{formatNumber(selectionCount)}</strong> selected
            </>
          ) : (
            "Select domains to research, shortlist or export"
          )}
        </span>
        {selected.size > 0 && !allFilteredSelected && total > rows.length && rows.every((row) => selected.has(row.id)) && (
          <button type="button" className="text-xs text-blue-700 underline" onClick={() => setAllFilteredSelected(true)}>
            Select all {formatNumber(total)} matching
          </button>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="primary"
            disabled={selectionCount === 0}
            onClick={() => setResearchTarget(allFilteredSelected ? { filter: effectiveFilter } : { ids: selectedIds })}
          >
            Research Selected
          </Button>
          <Button size="sm" disabled={total === 0} onClick={() => setResearchTarget({ filter: effectiveFilter })}>
            Research All Filtered
          </Button>
          <Button
            size="sm"
            disabled={selectedIds.length === 0 || allFilteredSelected}
            onClick={() => run("Added to shortlist", () => shortlist.mutateAsync(selectedIds))}
          >
            ★ Shortlist
          </Button>
          <select
            aria-label="Set status for selected domains"
            className="rounded-md border border-slate-300 bg-white px-2 py-1 text-xs disabled:text-slate-400"
            disabled={selectedIds.length === 0 || allFilteredSelected}
            value=""
            onChange={(event) =>
              run("Status updated", () =>
                setStatus.mutateAsync({ domainIds: selectedIds, userStatus: event.target.value as UserStatus }),
              )
            }
          >
            <option value="">Set status…</option>
            {USER_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status === "none" ? "clear status" : status}
              </option>
            ))}
          </select>
          <Button size="sm" disabled={selectedIds.length === 0 || allFilteredSelected} onClick={() => exportCsv("selected")}>
            Export Selected
          </Button>
        </div>
      </div>

      {query.isError ? (
        <ErrorState message={errorText(query.error)} onRetry={() => query.refetch()} />
      ) : query.isPending ? (
        <LoadingState label="Loading domains…" />
      ) : rows.length === 0 ? (
        <EmptyState title="No domains match these filters.">
          {state.filter.dropDate === "today"
            ? "Nothing drops today — try Tomorrow or clear the drop date."
            : "Try removing a filter, or import a drop list from the Imports page."}
        </EmptyState>
      ) : (
        <DomainTable
          rows={rows}
          visibleColumns={columns}
          sort={state.sort}
          dir={state.dir}
          onSort={state.setSort}
          selected={selected}
          onToggle={toggle}
          onTogglePage={togglePage}
          loading={query.isFetching}
        />
      )}
      <Pagination page={state.page} pageSize={state.pageSize} total={total} onPage={state.setPage} onPageSize={state.setPageSize} />

      <ResearchConfirmModal
        open={researchTarget !== null}
        onClose={() => setResearchTarget(null)}
        domainIds={researchTarget?.ids}
        filter={researchTarget?.filter}
        onQueued={() => {
          setSelected(new Set());
          setAllFilteredSelected(false);
        }}
      />
      <SaveFilterModal open={saveOpen} onClose={() => setSaveOpen(false)} filter={state.filter} />
    </div>
  );
}
