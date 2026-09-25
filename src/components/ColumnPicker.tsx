import { useState } from "react";
import { DEFAULT_VISIBLE_COLUMNS, DOMAIN_COLUMNS } from "./domainColumns";
import { Button } from "./ui";

export function ColumnPicker({ visible, onChange }: { visible: string[]; onChange: (keys: string[]) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <Button size="sm" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        Columns ▾
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-30 mt-1 w-56 rounded-md border border-slate-200 bg-white p-2 shadow-lg">
            {DOMAIN_COLUMNS.map((column) => (
              <label key={column.key} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={visible.includes(column.key)}
                  disabled={column.key === "domain"}
                  onChange={(event) =>
                    onChange(
                      event.target.checked
                        ? DOMAIN_COLUMNS.map((c) => c.key).filter((k) => k === column.key || visible.includes(k))
                        : visible.filter((key) => key !== column.key),
                    )
                  }
                />
                {column.label}
              </label>
            ))}
            <button className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-blue-700 hover:bg-slate-50" onClick={() => onChange(DEFAULT_VISIBLE_COLUMNS)}>
              Reset to defaults
            </button>
          </div>
        </>
      )}
    </div>
  );
}
