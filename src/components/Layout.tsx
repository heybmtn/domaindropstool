import { NavLink, Outlet } from "react-router";
import { useQueueState } from "../lib/queries";
import { ErrorBoundary } from "./ErrorBoundary";
import { Badge } from "./ui";

const NAV = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/drop-lists", label: "Drop Lists" },
  { to: "/domains", label: "Domains" },
  { to: "/queue", label: "Research Queue" },
  { to: "/shortlist", label: "Shortlist" },
  { to: "/filters", label: "Saved Filters" },
  { to: "/imports", label: "Imports" },
  { to: "/settings", label: "Settings" },
];

function QueueIndicator() {
  const queue = useQueueState(15_000);
  if (!queue.data) return null;
  const active = queue.data.counts.pending + queue.data.counts.processing;
  if (queue.data.paused) return <Badge tone="amber">paused</Badge>;
  if (active > 0) return <Badge tone="blue">{active}</Badge>;
  return null;
}

export function Layout() {
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-52 shrink-0 flex-col border-r border-slate-200 bg-slate-900 text-slate-300 md:flex">
        <div className="px-4 py-4">
          <div className="text-[11px] font-semibold tracking-[0.18em] text-slate-400 uppercase">.co.uk</div>
          <div className="text-sm font-semibold text-white">Domain Drop Research</div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-2" aria-label="Main">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `flex items-center justify-between rounded-md px-3 py-1.5 text-sm ${isActive ? "bg-slate-700 text-white" : "hover:bg-slate-800 hover:text-white"}`
              }
            >
              {item.label}
              {item.to === "/queue" && <QueueIndicator />}
            </NavLink>
          ))}
        </nav>
        <p className="px-4 py-3 text-[11px] leading-snug text-slate-500">
          Research Score and heuristics are prioritisation aids, not valuations.
        </p>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Compact nav for small screens */}
        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-slate-900 px-2 py-2 md:hidden" aria-label="Main">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `rounded px-2 py-1 text-xs whitespace-nowrap ${isActive ? "bg-slate-700 text-white" : "text-slate-300"}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <main className="min-w-0 flex-1 p-4 lg:p-6">
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
