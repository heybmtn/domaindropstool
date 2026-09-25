import type { ButtonHTMLAttributes, ReactNode } from "react";

/** Small shared UI primitives. */

type Variant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-blue-700 text-white hover:bg-blue-800 disabled:bg-blue-300",
  secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:text-slate-400",
  danger: "border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:text-red-300",
  ghost: "text-slate-600 hover:bg-slate-100 disabled:text-slate-300",
};

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  const sizing = size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-sm";
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed ${sizing} ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}

const BADGE_TONES = {
  slate: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  violet: "bg-violet-50 text-violet-700 ring-violet-200",
} as const;
export type BadgeTone = keyof typeof BADGE_TONES;

export function Badge({ tone = "slate", children, title }: { tone?: BadgeTone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap ring-1 ring-inset ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

const RESEARCH_TONES: Record<string, BadgeTone> = {
  none: "slate",
  pending: "amber",
  processing: "blue",
  completed: "green",
  failed: "red",
};
const RESEARCH_LABELS: Record<string, string> = {
  none: "Not researched",
  pending: "Queued",
  processing: "Researching",
  completed: "Researched",
  failed: "Failed",
};

export function ResearchBadge({ status }: { status: string }) {
  return <Badge tone={RESEARCH_TONES[status] ?? "slate"}>{RESEARCH_LABELS[status] ?? status}</Badge>;
}

const DOMAIN_STATUS_TONES: Record<string, BadgeTone> = { listed: "blue", removed: "slate", dropped: "violet" };
const DOMAIN_STATUS_TITLES: Record<string, string> = {
  listed: "On the current Nominet drop list",
  removed: "No longer on the drop list before its drop time (likely renewed or restored)",
  dropped: "Drop time has passed and the domain left the list",
};

export function DomainStatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={DOMAIN_STATUS_TONES[status] ?? "slate"} title={DOMAIN_STATUS_TITLES[status]}>
      {status}
    </Badge>
  );
}

const USER_STATUS_TONES: Record<string, BadgeTone> = {
  none: "slate",
  shortlisted: "amber",
  ignored: "slate",
  registered: "green",
  sold: "violet",
};

export function UserStatusBadge({ status }: { status: string }) {
  if (status === "none") return <span className="text-slate-400">—</span>;
  return <Badge tone={USER_STATUS_TONES[status] ?? "slate"}>{status}</Badge>;
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600 ${className}`}
    />
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
      <Spinner /> {label}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="m-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <p>{message}</p>
      {onRetry && (
        <Button size="sm" className="mt-2" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export function Banner({ tone, children }: { tone: "info" | "warning" | "error"; children: ReactNode }) {
  const tones = {
    info: "border-blue-200 bg-blue-50 text-blue-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    error: "border-red-200 bg-red-50 text-red-900",
  };
  return <div className={`rounded-md border px-3 py-2 text-sm ${tones[tone]}`}>{children}</div>;
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-lg font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = "" }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
          {title && <h2 className="text-sm font-semibold text-slate-800">{title}</h2>}
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function StatCard({ label, value, hint, tone = "slate" }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "slate" | "blue" | "green" | "amber" }) {
  const accents = { slate: "border-l-slate-300", blue: "border-l-blue-500", green: "border-l-emerald-500", amber: "border-l-amber-500" };
  return (
    <div className={`card border-l-4 px-4 py-3 ${accents[tone]}`}>
      <div className="text-xs font-medium tracking-wide text-slate-500 uppercase">{label}</div>
      <div className="tabular mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}
