import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import {
  DEFAULT_PAGE_SIZE,
  filterFromSearchParams,
  filterToSearchParams,
  pageSchema,
  sortSchema,
  type DomainFilter,
  type SortField,
} from "../../shared/filters";

export interface DomainQueryState {
  filter: DomainFilter;
  sort: SortField;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

/**
 * Keeps filters, sorting and pagination in the URL so any view can be
 * bookmarked or shared, e.g. /domains?drop=today&maxLength=15&minRD=20.
 * `defaults` apply only when the URL has no parameters at all.
 */
export function useDomainQueryState(defaults: Partial<DomainQueryState> = {}) {
  const [params, setParams] = useSearchParams();

  const state = useMemo<DomainQueryState>(() => {
    const empty = [...params.keys()].length === 0;
    const sortParsed = sortSchema.safeParse({
      sort: params.get("sort") ?? defaults.sort ?? undefined,
      dir: params.get("dir") ?? defaults.dir ?? undefined,
    });
    const pageParsed = pageSchema.safeParse({
      page: params.get("page") ?? undefined,
      pageSize: params.get("pageSize") ?? defaults.pageSize ?? DEFAULT_PAGE_SIZE,
    });
    return {
      filter: empty && defaults.filter ? defaults.filter : filterFromSearchParams(params),
      sort: sortParsed.success ? sortParsed.data.sort : "drop_date",
      dir: sortParsed.success ? sortParsed.data.dir : "asc",
      page: pageParsed.success ? pageParsed.data.page : 1,
      pageSize: pageParsed.success ? pageParsed.data.pageSize : DEFAULT_PAGE_SIZE,
    };
    // defaults are static per page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const write = useCallback(
    (next: DomainQueryState) => {
      const search = filterToSearchParams(next.filter);
      if (next.sort !== "drop_date" || next.dir !== "asc") {
        search.set("sort", next.sort);
        search.set("dir", next.dir);
      }
      if (next.page > 1) search.set("page", String(next.page));
      if (next.pageSize !== DEFAULT_PAGE_SIZE) search.set("pageSize", String(next.pageSize));
      // Keep an explicit marker so an intentionally empty filter does not fall back to defaults.
      if ([...search.keys()].length === 0) search.set("all", "1");
      setParams(search, { replace: false });
    },
    [setParams],
  );

  return {
    ...state,
    setFilter: (filter: DomainFilter) => write({ ...state, filter, page: 1 }),
    patchFilter: (patch: Partial<DomainFilter>) => {
      const merged: DomainFilter = { ...state.filter, ...patch };
      for (const key of Object.keys(merged) as (keyof DomainFilter)[]) {
        if (merged[key] === undefined || merged[key] === "") delete merged[key];
      }
      write({ ...state, filter: merged, page: 1 });
    },
    setSort: (sort: SortField) =>
      write({ ...state, sort, dir: state.sort === sort && state.dir === "desc" ? "asc" : "desc", page: 1 }),
    setPage: (page: number) => write({ ...state, page }),
    setPageSize: (pageSize: number) => write({ ...state, pageSize, page: 1 }),
  };
}

/** Builds the API query string for the current state. */
export function toApiQuery(state: DomainQueryState): string {
  const search = filterToSearchParams(state.filter);
  search.set("sort", state.sort);
  search.set("dir", state.dir);
  search.set("page", String(state.page));
  search.set("pageSize", String(state.pageSize));
  return search.toString();
}
