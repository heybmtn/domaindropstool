import type { DomainRow } from "../../shared/api";
import type { SortField } from "../../shared/filters";
import { DOMAIN_COLUMNS, type ColumnContext } from "./domainColumns";

export interface DomainTableProps {
  rows: DomainRow[];
  visibleColumns: string[];
  sort: SortField;
  dir: "asc" | "desc";
  onSort: (field: SortField) => void;
  selected: Set<number>;
  onToggle: (id: number) => void;
  onTogglePage: (checked: boolean) => void;
  /** Shortlist state per row (includes optimistic updates). */
  isStarred: (row: DomainRow) => boolean;
  onToggleStar: (row: DomainRow) => void;
  context: ColumnContext;
  loading?: boolean;
}

function StarButton({ starred, domain, onClick }: { starred: boolean; domain: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={starred}
      aria-label={starred ? `Remove ${domain} from shortlist` : `Add ${domain} to shortlist`}
      title={starred ? "Remove from shortlist" : "Add to shortlist"}
      className={`rounded p-0.5 text-lg leading-none transition-colors ${starred ? "text-amber-500 hover:text-amber-600" : "text-slate-300 hover:text-amber-500"}`}
    >
      {starred ? "★" : "☆"}
    </button>
  );
}

/** Dense, scan-friendly domain table. Rows are always one server page. */
export function DomainTable({
  rows,
  visibleColumns,
  sort,
  dir,
  onSort,
  selected,
  onToggle,
  onTogglePage,
  isStarred,
  onToggleStar,
  context,
  loading,
}: DomainTableProps) {
  const columns = DOMAIN_COLUMNS.filter((column) => visibleColumns.includes(column.key));
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const someSelected = rows.some((row) => selected.has(row.id));

  return (
    <div className={`overflow-x-auto ${loading ? "opacity-60 transition-opacity" : ""}`}>
      <table className="w-full border-collapse text-[15px]">
        <thead className="sticky top-0 z-10 bg-slate-50 text-sm text-slate-600">
          <tr className="border-b border-slate-200">
            <th className="w-8 px-3 py-2.5">
              <input
                type="checkbox"
                aria-label="Select all rows on this page"
                checked={allSelected}
                ref={(input) => {
                  if (input) input.indeterminate = someSelected && !allSelected;
                }}
                onChange={(event) => onTogglePage(event.target.checked)}
              />
            </th>
            <th className="w-8 px-1 py-2.5" aria-label="Shortlist">
              <span className="text-slate-400">★</span>
            </th>
            {columns.map((column) => {
              const active = column.sort === sort;
              return (
                <th
                  key={column.key}
                  title={column.title}
                  aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
                  className={`px-3 py-2.5 font-medium whitespace-nowrap ${column.align === "right" ? "text-right" : "text-left"}`}
                >
                  {column.sort ? (
                    <button
                      type="button"
                      onClick={() => onSort(column.sort!)}
                      className={`inline-flex items-center gap-1 hover:text-slate-900 ${active ? "text-slate-900" : ""}`}
                    >
                      {column.label}
                      <span aria-hidden className="text-[10px]">
                        {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isSelected = selected.has(row.id);
            return (
              <tr
                key={row.id}
                className={`border-b border-slate-100 ${isSelected ? "bg-blue-50/70" : "hover:bg-slate-50"} ${row.userStatus === "ignored" ? "opacity-50" : ""}`}
              >
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.domain}`}
                    checked={isSelected}
                    onChange={() => onToggle(row.id)}
                  />
                </td>
                <td className="px-1 py-2">
                  <StarButton starred={isStarred(row)} domain={row.domain} onClick={() => onToggleStar(row)} />
                </td>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`tabular px-3 py-2 whitespace-nowrap ${column.align === "right" ? "text-right" : ""}`}
                  >
                    {column.render(row, context)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
