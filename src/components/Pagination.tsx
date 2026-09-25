import { formatNumber } from "../lib/format";
import { Button } from "./ui";

const PAGE_SIZES = [25, 50, 100, 200];

/** Pager that works before the (separately fetched) total is known. */
export function Pagination({
  page,
  pageSize,
  total,
  rowsOnPage,
  hasMore,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  /** null while the count is loading. */
  total: number | null;
  rowsOnPage: number;
  hasMore: boolean;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const from = rowsOnPage === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = (page - 1) * pageSize + rowsOnPage;
  const pages = total === null ? null : Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-sm text-slate-600">
      <span className="tabular">
        {formatNumber(from)}–{formatNumber(to)} of {total === null ? "…" : formatNumber(total)}
      </span>
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1">
          Rows
          <select
            className="rounded border border-slate-300 bg-white px-1 py-0.5"
            value={pageSize}
            onChange={(event) => onPageSize(Number(event.target.value))}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(1)} aria-label="First page">
          «
        </Button>
        <Button size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          Prev
        </Button>
        <span className="tabular">
          Page {formatNumber(page)}
          {pages !== null && <> / {formatNumber(pages)}</>}
        </span>
        <Button size="sm" disabled={!hasMore} onClick={() => onPage(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  );
}
