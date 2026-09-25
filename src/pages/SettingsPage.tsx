import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { ResearchSettings, SettingsDto } from "../../shared/api";
import { REGISTRAR_PRESETS, registrarSettingsSchema, registrarUrl, type RegistrarSettings } from "../../shared/registrar";
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

interface AuthStatus {
  mode: "token" | "open";
  authorized: boolean;
}

function authMessage(status: AuthStatus, hasToken: boolean): { tone: "success" | "error"; text: string } {
  if (status.authorized) return { tone: "success", text: "Admin access confirmed. Imports, research and edits are enabled in this browser." };
  if (status.mode === "open") {
    return {
      tone: "error",
      text: "The Worker cannot see an ADMIN_TOKEN. In Cloudflare go to Workers & Pages → domaindropstool → Settings → Variables and Secrets (not Build variables), add ADMIN_TOKEN with type Secret, then click Save here again.",
    };
  }
  if (!hasToken) return { tone: "error", text: "Enter the ADMIN_TOKEN value you set on the Worker, then click Save." };
  return { tone: "error", text: "Token saved, but it does not match the Worker's ADMIN_TOKEN secret. Check for typos, or set the secret again in Cloudflare and paste the same value here." };
}

function AdminAccess() {
  const [token, setToken] = useState(getAdminToken());
  const client = useQueryClient();
  const toast = useToast();
  const auth = useQuery({ queryKey: ["auth"], queryFn: () => api.get<AuthStatus>("/settings/auth"), staleTime: 0 });
  const [checking, setChecking] = useState(false);

  const save = async () => {
    setChecking(true);
    setAdminToken(token.trim());
    try {
      const status = await client.fetchQuery({ queryKey: ["auth"], queryFn: () => api.get<AuthStatus>("/settings/auth"), staleTime: 0 });
      const message = authMessage(status, token.trim().length > 0);
      toast(message.text, message.tone);
      void client.invalidateQueries({ queryKey: keys.settings });
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      setChecking(false);
    }
  };

  const current = auth.data ? authMessage(auth.data, getAdminToken().length > 0) : null;
  return (
    <Card title="Admin access">
      <div className="space-y-2 p-4 text-sm">
        <p className="text-slate-600">
          Imports, research and edits require the <code className="mx-1">ADMIN_TOKEN</code> secret set on the Worker. Enter the same
          value here; it is stored only in this browser.
        </p>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <input className="input" type="password" autoComplete="off" placeholder="Admin token" value={token} onChange={(e) => setToken(e.target.value)} />
          <Button type="submit" variant="primary" disabled={checking}>
            {checking ? "Checking…" : "Save"}
          </Button>
        </form>
        {current && (
          <p className={current.tone === "success" ? "text-emerald-700" : "text-red-700"}>
            {current.tone === "success" ? <Badge tone="green">authorized</Badge> : <Badge tone="red">not authorized</Badge>} {current.text}
          </p>
        )}
      </div>
    </Card>
  );
}

function RegistrarSection({
  settings,
  onSave,
  saving,
}: {
  settings: SettingsDto;
  onSave: (registrar: RegistrarSettings) => void;
  saving: boolean;
}) {
  const [draft, setDraft] = useState<RegistrarSettings>(settings.registrar);
  useEffect(() => setDraft(settings.registrar), [settings.registrar]);
  const parsed = registrarSettingsSchema.safeParse(draft);
  const example = parsed.success ? registrarUrl(parsed.data, "example.co.uk") : null;
  return (
    <Card title="Registrar">
      <div className="space-y-3 p-4 text-sm">
        <p className="text-slate-600">Clicking a domain opens this registrar's availability search in a new tab.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label>
            <span className="label">Registrar</span>
            <select
              className="input w-48"
              value={draft.preset}
              onChange={(event) => setDraft({ ...draft, preset: event.target.value as RegistrarSettings["preset"] })}
            >
              {Object.entries(REGISTRAR_PRESETS).map(([key, preset]) => (
                <option key={key} value={key}>
                  {preset.label}
                </option>
              ))}
              <option value="custom">Custom URL…</option>
            </select>
          </label>
          {draft.preset === "custom" && (
            <label className="min-w-80 flex-1">
              <span className="label">Search URL (use {"{domain}"} where the domain goes)</span>
              <input
                className="input"
                placeholder="https://www.example-registrar.co.uk/search?domain={domain}"
                value={draft.urlTemplate ?? ""}
                onChange={(event) => setDraft({ ...draft, urlTemplate: event.target.value })}
              />
            </label>
          )}
          <Button variant="primary" disabled={saving || !parsed.success} onClick={() => parsed.success && onSave(parsed.data)}>
            Save registrar
          </Button>
        </div>
        {parsed.success ? (
          <p className="text-xs text-slate-500">
            Example: <code className="break-all">{example}</code>
          </p>
        ) : (
          <p className="text-xs text-red-700">{parsed.error.issues[0]?.message}</p>
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
    mutationFn: (body: { research?: Partial<ResearchSettings>; scoring?: ScoreWeights; registrar?: RegistrarSettings }) =>
      api.put<SettingsDto>("/settings", body),
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
        <Banner tone="warning">The Worker has no ADMIN_TOKEN secret yet, so imports, research and edits are disabled. Add it in Cloudflare → Workers & Pages → domaindropstool → Settings → Variables and Secrets (type: Secret).</Banner>
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
      <RegistrarSection settings={s} saving={save.isPending} onSave={(registrar) => save.mutate({ registrar })} />
      <DataForSeoSection settings={s} />
      <ResearchSection settings={s} saving={save.isPending} onSave={(research) => save.mutate({ research })} />
      <ScoringSection settings={s} saving={save.isPending} onSave={(scoring) => save.mutate({ scoring })} />
    </div>
  );
}
