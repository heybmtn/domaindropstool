import type { DomainRow } from "../../shared/api";
import type { SortField } from "../../shared/filters";
import { DOMAIN_COLUMNS } from "./domainColumns";

export interface DomainTableProps {
  rows: DomainRow[];
  visibleColumns: string[];
  sort: SortField;
  dir: "asc" | "desc";
  onSort: (field: SortField) => void;
  selected: Set<number>;
  onToggle: (id: number) => void;
  onTogglePage: (checked: boolean) => void;
  loading?: boolean;
}

/** Dense, scan-friendly domain table. Rows are always one server page. */
export function DomainTable({ rows, visibleColumns, sort, dir, onSort, selected, onToggle, onTogglePage, loading }: DomainTableProps) {
  const columns = DOMAIN_COLUMNS.filter((column) => visibleColumns.includes(column.key));
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const someSelected = rows.some((row) => selected.has(row.id));

  return (
    <div className={`overflow-x-auto ${loading ? "opacity-60 transition-opacity" : ""}`}>
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-slate-50 text-xs text-slate-600">
          <tr className="border-b border-slate-200">
            <th className="w-8 px-3 py-2">
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
            {columns.map((column) => {
              const active = column.sort === sort;
              return (
                <th
                  key={column.key}
                  title={column.title}
                  aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}
                  className={`px-3 py-2 font-medium whitespace-nowrap ${column.align === "right" ? "text-right" : "text-left"}`}
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
                <td className="px-3 py-1.5">
                  <input
                    type="checkbox"
                    aria-label={`Select ${row.domain}`}
                    checked={isSelected}
                    onChange={() => onToggle(row.id)}
                  />
                </td>
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={`tabular px-3 py-1.5 whitespace-nowrap ${column.align === "right" ? "text-right" : ""}`}
                  >
                    {column.render(row)}
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
