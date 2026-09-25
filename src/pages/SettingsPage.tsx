import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ResearchSettings, SettingsDto } from "../../shared/api";
import { DEFAULT_SCORE_WEIGHTS, type ScoreWeights } from "../../shared/scoring";
import { useToast } from "../components/Toast";
import { Badge, Banner, Button, Card, ErrorState, LoadingState, PageHeader } from "../components/ui";
import { api, errorText, getAdminToken, setAdminToken } from "../lib/api";
import { formatDateTime, formatMoney } from "../lib/format";
import { keys, useSettings } from "../lib/queries";

function NumberField({ label, value, onChange, hint, step }: { label: string; value: number; onChange: (v: number) => void; hint?: string; step?: number }) {
  return (
    <label>
      <span className="label">{label}</span>
      <input className="input" type="number" min={0} step={step ?? 1} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      {hint && <span className="mt-0.5 block text-[11px] text-slate-500">{hint}</span>}
    </label>
  );
}

function AdminAccess() {
  const [token, setToken] = useState(getAdminToken());
  const client = useQueryClient();
  const auth = useQuery({ queryKey: ["auth"], queryFn: () => api.get<{ mode: string; authorized: boolean }>("/settings/auth") });
  return (
    <Card title="Admin access">
      <div className="space-y-2 p-4 text-sm">
        <p className="text-slate-600">
          Imports, research and edits require the <code className="mx-1">ADMIN_TOKEN</code> secret set on the Worker. Enter the same
          value here; it is stored only in this browser.
        </p>
        <div className="flex gap-2">
          <input className="input" type="password" autoComplete="off" placeholder="Admin token" value={token} onChange={(e) => setToken(e.target.value)} />
          <Button
            variant="primary"
            onClick={() => {
              setAdminToken(token.trim());
              void client.invalidateQueries({ queryKey: ["auth"] });
            }}
          >
            Save
          </Button>
        </div>
        {auth.data && (
          <p>
            Mode: <Badge>{auth.data.mode}</Badge>{" "}
            {auth.data.authorized ? <Badge tone="green">authorized</Badge> : <Badge tone="red">not authorized</Badge>}
          </p>
        )}
      </div>
    </Card>
  );
}

function DataForSeoSection({ settings }: { settings: SettingsDto }) {
  const toast = useToast();
  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; message: string; balance?: number | null }>("/settings/dataforseo/test"),
    onSuccess: (result) =>
      toast(`${result.message}${result.balance !== undefined && result.balance !== null ? ` Balance: ${formatMoney(result.balance)}` : ""}`, result.ok ? "success" : "error"),
    onError: (error) => toast(errorText(error), "error"),
  });
  return (
    <Card title="DataForSEO">
      <div className="space-y-2 p-4 text-sm">
        <p>
          Status:{" "}
          {settings.dataforseo.configured ? <Badge tone="green">Configured</Badge> : <Badge tone="red">Not Configured</Badge>}{" "}
          {settings.dataforseo.mock && <Badge tone="amber">mock provider</Badge>}
        </p>
        <p className="text-slate-600">
          API base: <code>{settings.dataforseo.baseUrl}</code>. Credentials are Worker secrets (<code>DATAFORSEO_LOGIN</code>,{" "}
          <code>DATAFORSEO_PASSWORD</code>) and are never sent to the browser.
        </p>
        <Button disabled={!settings.dataforseo.configured || test.isPending} onClick={() => test.mutate()}>
          Connection Test
        </Button>
      </div>
    </Card>
  );
}

const RESEARCH_FIELDS: { key: keyof ResearchSettings; label: string; hint?: string }[] = [
  { key: "dailyDomainLimit", label: "Daily domain limit", hint: "Max domains researched per UTC day (cost cap)" },
  { key: "batchSize", label: "Batch size", hint: "Jobs processed per 2-minute cron tick" },
  { key: "concurrency", label: "Concurrency", hint: "Parallel domains within a batch" },
  { key: "maxAttempts", label: "Max attempts", hint: "Retries before a job fails" },
  { key: "maxEnqueuePerRequest", label: "Max domains per request", hint: "Cap for “Research All Filtered”" },
  { key: "locationCode", label: "Location code", hint: "2826 = United Kingdom" },
  { key: "keywordLimit", label: "Keywords per domain" },
  { key: "backlinkLimit", label: "Backlinks per domain" },
];

function ResearchSection({ settings, onSave, saving }: { settings: SettingsDto; onSave: (research: Partial<ResearchSettings>) => void; saving: boolean }) {
  const [draft, setDraft] = useState(settings.research);
  useEffect(() => setDraft(settings.research), [settings.research]);
  return (
    <Card title="Research & cost controls">
      <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-4">
        {RESEARCH_FIELDS.map((field) => (
          <NumberField
            key={field.key}
            label={field.label}
            hint={field.hint}
            value={draft[field.key] as number}
            onChange={(value) => setDraft({ ...draft, [field.key]: value })}
          />
        ))}
        <label>
          <span className="label">Language code</span>
          <input className="input" value={draft.languageCode} onChange={(e) => setDraft({ ...draft, languageCode: e.target.value })} />
        </label>
        {(["fetchKeywords", "fetchBacklinks", "fetchHistory"] as const).map((key) => (
          <label key={key} className="flex items-center gap-2 self-end pb-2 text-sm">
            <input type="checkbox" checked={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })} />
            {{ fetchKeywords: "Fetch top keywords", fetchBacklinks: "Fetch backlink sample", fetchHistory: "Fetch traffic history" }[key]}
          </label>
        ))}
      </div>
      <p className="px-4 text-xs text-slate-500">
        Each researched domain always uses 2 calls (backlinks summary + domain overview); each enabled option adds one more.
      </p>
      <div className="p-4">
        <Button variant="primary" disabled={saving} onClick={() => onSave(draft)}>
          Save research settings
        </Button>
      </div>
    </Card>
  );
}

const WEIGHT_FIELDS: { key: Exclude<keyof ScoreWeights, "reference">; label: string; step?: number }[] = [
  { key: "referringDomains", label: "Referring Domains (max points)" },
  { key: "organicTraffic", label: "Organic Traffic (max points)" },
  { key: "backlinks", label: "Backlinks (max points)" },
  { key: "organicKeywords", label: "Organic Keywords (max points)" },
  { key: "trafficValue", label: "Traffic Value (max points)" },
  { key: "shortDomain", label: "Short Domain (max points)" },
  { key: "hyphenPenalty", label: "Hyphen penalty (per hyphen)", step: 0.5 },
  { key: "numberPenalty", label: "Number penalty (per digit)", step: 0.5 },
  { key: "fullBonusLength", label: "Full short bonus at ≤ chars" },
  { key: "zeroBonusLength", label: "No short bonus at ≥ chars" },
];

function ScoringSection({ settings, onSave, saving }: { settings: SettingsDto; onSave: (scoring: ScoreWeights) => void; saving: boolean }) {
  const [draft, setDraft] = useState(settings.scoring);
  useEffect(() => setDraft(settings.scoring), [settings.scoring]);
  return (
    <Card title="Research Score weights">
      <div className="p-4 text-sm text-slate-600">
        SEO inputs earn up to their max points on a log scale, reaching the maximum at the reference value. The score is capped to 0–100 and
        is a prioritisation aid, not a valuation. Scores are recalculated on the next research of each domain.
      </div>
      <div className="grid grid-cols-2 gap-3 px-4 md:grid-cols-5">
        {WEIGHT_FIELDS.map((field) => (
          <NumberField key={field.key} label={field.label} step={field.step} value={draft[field.key]} onChange={(value) => setDraft({ ...draft, [field.key]: value })} />
        ))}
        {(Object.keys(draft.reference) as (keyof ScoreWeights["reference"])[]).map((key) => (
          <NumberField
            key={key}
            label={`Reference: ${key}`}
            value={draft.reference[key]}
            onChange={(value) => setDraft({ ...draft, reference: { ...draft.reference, [key]: value } })}
          />
        ))}
      </div>
      <div className="flex gap-2 p-4">
        <Button variant="primary" disabled={saving} onClick={() => onSave(draft)}>
          Save weights
        </Button>
        <Button variant="ghost" onClick={() => setDraft(DEFAULT_SCORE_WEIGHTS)}>
          Reset to defaults
        </Button>
      </div>
    </Card>
  );
}

export function SettingsPage() {
  const settings = useSettings();
  const client = useQueryClient();
  const toast = useToast();
  const save = useMutation({
    mutationFn: (body: { research?: Partial<ResearchSettings>; scoring?: ScoreWeights }) => api.put<SettingsDto>("/settings", body),
    onSuccess: (data) => {
      client.setQueryData(keys.settings, data);
      void client.invalidateQueries({ queryKey: keys.queue });
      toast("Settings saved", "success");
    },
    onError: (error) => toast(errorText(error), "error"),
  });

  if (settings.isPending) return <LoadingState />;
  if (settings.isError) return <ErrorState message={errorText(settings.error)} onRetry={() => settings.refetch()} />;
  const s = settings.data;

  return (
    <div className="space-y-4">
      <PageHeader title="Settings" />
      {s.auth.mode === "open" && (
        <Banner tone="warning">No ADMIN_TOKEN secret is configured. Admin operations only work in local development.</Banner>
      )}
      <AdminAccess />
      <Card title="Nominet">
        <div className="space-y-1 p-4 text-sm">
          <p>
            Drop list URL: <code>{s.nominet.dropListUrl}</code> (<code>NOMINET_DROP_LIST_URL</code>)
          </p>
          <p className="text-slate-600">
            Last successful import: {s.nominet.lastImport ? formatDateTime(s.nominet.lastImport.completedAt) : "never"}. The cron checks the published
            checksum hourly and imports only when the file changes.
          </p>
        </div>
      </Card>
      <DataForSeoSection settings={s} />
      <ResearchSection settings={s} saving={save.isPending} onSave={(research) => save.mutate({ research })} />
      <ScoringSection settings={s} saving={save.isPending} onSave={(scoring) => save.mutate({ scoring })} />
    </div>
  );
}
