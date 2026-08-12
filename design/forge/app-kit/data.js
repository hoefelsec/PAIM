const LABELS = {
  infra: { name: 'infra', color: 'var(--blue-500)' },
  backend: { name: 'backend', color: 'var(--green-500)' },
  design: { name: 'design', color: 'var(--violet-500)' },
  docs: { name: 'docs', color: 'var(--gray-500)' },
  billing: { name: 'billing', color: 'var(--amber-500)' },
};

const WORKSPACES = [
  { name: 'Billing v2', color: 'var(--ember-500)', open: 17, on: true },
  { name: 'Forge Web', color: 'var(--violet-500)', open: 9 },
  { name: 'Platform infra', color: 'var(--blue-500)', open: 24 },
  { name: 'Support ops', color: 'var(--green-500)', open: 4 },
];

const TASKS = [
  { id: 'FRG-214', size: 'L', title: 'Migrate billing webhooks to the v2 API', status: 'running', priority: 'high', agent: 'Atlas', progress: 62, labels: [LABELS.infra, LABELS.backend], comments: 3, attachments: 2, due: 'Aug 8' },
  { id: 'FRG-219', size: 'M', title: 'Reconcile failed Stripe events from July', status: 'running', priority: 'urgent', agent: 'Ledger', progress: 24, labels: [LABELS.billing], comments: 1, due: 'Aug 7' },
  { id: 'FRG-230', size: 'S', title: 'Verify idempotent retries against the sandbox', status: 'testing', priority: 'high', agent: 'Atlas', progress: 88, labels: [LABELS.backend], comments: 2 },
  { id: 'FRG-208', size: 'M', title: 'Draft the migration runbook for support', status: 'reviewing', priority: 'medium', agent: 'Scribe', progress: 100, labels: [LABELS.docs], comments: 8 },
  { id: 'FRG-211', size: 'S', title: 'Invoice PDF template refresh', status: 'reviewing', priority: 'low', assignee: 'Mara Vidal', labels: [LABELS.design], comments: 2, attachments: 4 },
  { id: 'FRG-221', size: 'L', title: 'Backfill customer events into the ledger', status: 'ready', priority: 'high', agent: 'Ledger', labels: [LABELS.backend], due: 'Aug 11' },
  { id: 'FRG-223', size: 'S', title: 'Rate-limit the webhook replay endpoint', status: 'ready', priority: 'medium', assignee: 'Dev Okafor', labels: [LABELS.infra] },
  { id: 'FRG-226', size: 'XL', title: 'Retire the legacy /charges endpoint', status: 'open-questions', priority: 'low', labels: [LABELS.infra, LABELS.docs], comments: 6 },
  { id: 'FRG-228', size: 'XS', title: 'Dunning email copy pass', status: 'open-questions', priority: 'medium', labels: [LABELS.docs], comments: 2 },
  { id: 'FRG-232', size: 'M', title: 'Failure-state screens for the replay flow', status: 'design', priority: 'medium', assignee: 'Mara Vidal', labels: [LABELS.design], attachments: 3 },
  { id: 'FRG-217', size: 'S', title: 'Sync vendor sandbox credentials', status: 'paused', priority: 'urgent', agent: 'Ledger', labels: [LABELS.billing], comments: 4 },
  { id: 'FRG-209', size: 'M', title: 'Bulk refund reconciliation job', status: 'failed', priority: 'high', agent: 'Ledger', progress: 41, labels: [LABELS.billing], comments: 3 },
  { id: 'FRG-198', size: 'S', title: 'Legacy dunning webhook shim', status: 'canceled', priority: 'low', labels: [LABELS.infra] },
  { id: 'FRG-201', size: 'M', title: 'Idempotency keys on all write paths', status: 'done', priority: 'high', agent: 'Atlas', progress: 100, labels: [LABELS.backend], comments: 5 },
  { id: 'FRG-204', size: 'L', title: 'Ledger schema migration 004', status: 'done', priority: 'medium', assignee: 'Dev Okafor', labels: [LABELS.infra] },
];

const COLUMNS = [
  { key: 'open-questions', label: 'Open questions' },
  { key: 'design', label: 'Design' },
  { key: 'ready', label: 'Ready' },
  { key: 'running', label: 'Running' },
  { key: 'testing', label: 'Testing' },
  { key: 'reviewing', label: 'Reviewing' },
  { key: 'done', label: 'Done' },
];

/* Left rail facets. Status comes from the pipeline; the rest from the workspace schema. */
const FACETS = [
  { label: 'Status', src: 'pipeline', open: true, items: [
    { label: 'Open questions', count: 2, dot: 'var(--status-open-questions)' },
    { label: 'Design', count: 1, dot: 'var(--status-design)' },
    { label: 'Ready', count: 5, dot: 'var(--status-ready)', on: true },
    { label: 'Running', count: 2, dot: 'var(--status-running)', on: true },
    { label: 'Testing', count: 1, dot: 'var(--status-testing)' },
    { label: 'Reviewing', count: 2, dot: 'var(--status-reviewing)' },
    { label: 'Paused', count: 1, dot: 'var(--status-paused)' },
    { label: 'Failed', count: 1, dot: 'var(--status-failed)' },
    { label: 'Done', count: 9, dot: 'var(--status-done)' },
  ] },
  { label: 'Priority', src: 'core', open: true, items: [
    { label: 'Urgent', count: 2, bars: 3, color: 'var(--danger-fg)' },
    { label: 'High', count: 4, bars: 2, color: 'var(--warning-fg)' },
    { label: 'Medium', count: 6, bars: 1, color: 'var(--text-secondary)' },
    { label: 'Low', count: 3, bars: 0, color: 'var(--text-disabled)' },
  ] },
  { label: 'Assignee', src: 'core', open: true, items: [
    { label: 'Atlas', count: 3, agent: true },
    { label: 'Ledger', count: 4, agent: true },
    { label: 'Scribe', count: 1, agent: true },
    { label: 'Mara Vidal', count: 2 },
    { label: 'Dev Okafor', count: 2 },
  ] },
  { label: 'Labels', src: 'core', open: false, items: [] },
  { label: 'Due', src: 'core', open: false, items: [] },
];

/* Token budget for this workspace — spend you can see, and stop. */
const METERS = [
  { label: '5-hour', pct: 46, budget: '0.9M / 2M tok', reset: 'ends 2h 14m' },
  { label: 'Weekly', pct: 71, budget: '7.1M / 10M tok', reset: 'ends Mon' },
  { label: 'Billing v2', pct: 118, budget: '2.4M / 2M tok', reset: 'ends Mon' },
];

/* The activity dock is global: every run in every workspace. */
const RUNS = [
  { ws: WORKSPACES[0], id: 'FRG-214', title: 'Migrate billing webhooks to the v2 API', model: 'claude-sonnet-4.5', step: 4, of: 6, elapsed: '2m 14s' },
  { ws: WORKSPACES[0], id: 'FRG-219', title: 'Reconcile failed Stripe events from July', model: 'claude-sonnet-4.5', step: 1, of: 5, elapsed: '0m 48s' },
  { ws: WORKSPACES[2], id: 'INF-88', title: 'Rotate staging certificates', model: 'claude-opus-4.1', indeterminate: true, elapsed: '0m 22s' },
  { ws: WORKSPACES[1], id: 'WEB-31', title: 'Changelog page metadata', model: 'gpt-5', queued: true },
  { ws: WORKSPACES[0], id: 'FRG-221', title: 'Backfill customer events into the ledger', model: 'claude-sonnet-4.5', queued: true },
];

const LOG = [
  { time: '14:02:09', level: 'info', message: 'run started · claude-sonnet-4.5 · tools: repo, shell, http' },
  { time: '14:02:11', level: 'tool', message: 'read_file("billing/webhooks.ts")' },
  { time: '14:02:14', level: 'tool', message: 'search_repo("stripe.constructEvent")  → 14 matches' },
  { time: '14:02:22', level: 'info', message: 'plan: port 12 handlers, keep v1 shim behind flag' },
  { time: '14:02:31', level: 'ok', message: '12 handlers ported · 31 tests generated' },
  { time: '14:02:38', level: 'tool', message: 'shell("pnpm test billing")' },
  { time: '14:02:44', level: 'warn', message: 'retry: rate limit on staging deploy (1/3)' },
  { time: '14:02:51', level: 'ok', message: '31/31 tests passing' },
  { time: '14:02:52', level: 'info', message: 'awaiting human approval — milestone 2 of 4' },
];

Object.assign(window, { LABELS, WORKSPACES, TASKS, COLUMNS, FACETS, METERS, RUNS, LOG });
