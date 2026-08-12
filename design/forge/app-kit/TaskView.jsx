const { Icon, IconButton, Button, Badge, Tag, Avatar, StatusPill, AgentRunIndicator, ExecutionLog, ApprovalBanner, ProgressBar, Textarea, Input, Card, Kbd } = window.ForgeDesignSystem_8868ce;

/* Pipeline order. A tab unlocks once the task has reached its stage; the tab that
   matches the current status is highlighted and selected on open. */
const TABS = [
  { value: 'description', label: 'Description', stage: 0 },
  { value: 'questions', label: 'Questions', stage: 1 },
  { value: 'design', label: 'Design', stage: 2 },
  { value: 'execution', label: 'Execution', stage: 3 },
  { value: 'test', label: 'Test', stage: 4 },
  { value: 'review', label: 'Review', stage: 5 },
];
const REACHED = { 'open-questions': 1, design: 2, ready: 2, running: 3, testing: 4, reviewing: 5, paused: 3, failed: 4, canceled: 3, done: 5 };
const FOCUS = { 'open-questions': 'questions', design: 'design', ready: 'description', running: 'execution', testing: 'test', reviewing: 'review', paused: 'execution', failed: 'execution', canceled: 'description', done: 'review' };

function Prop({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 26, padding: '0 0', borderBottom: '1px solid var(--border-subtle)' }}>
      <span style={{ width: 92, flex: 'none', font: 'var(--type-caption)', color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', minWidth: 0 }}>{children}</span>
    </div>
  );
}

function SizePill({ size }) {
  return <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-secondary)', background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 4, padding: '1px 7px' }}>{size || 'M'}</span>;
}

function TabBar({ value, onChange, reached, focus }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, borderBottom: '1px solid var(--border-default)', padding: '0 20px' }}>
      {TABS.map(t => {
        const enabled = t.stage <= reached;
        const on = t.value === value;
        const hot = t.value === focus;
        return (
          <button key={t.value} type="button" disabled={!enabled} onClick={() => enabled && onChange(t.value)}
            title={enabled ? undefined : 'Not reached yet'}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6, height: 34, padding: '0 10px',
              border: 0, background: 'none', marginBottom: -1, cursor: enabled ? 'pointer' : 'not-allowed',
              borderBottom: '2px solid ' + (on ? 'var(--accent-solid)' : 'transparent'),
              font: 'var(--type-ui)', opacity: enabled ? 1 : .38,
              color: on ? 'var(--text-primary)' : hot ? 'var(--text-accent)' : 'var(--text-tertiary)',
              transition: 'var(--transition-control)',
            }}>
            {t.label}
            {hot && !on ? <i style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--accent-solid)' }} /> : null}
          </button>
        );
      })}
    </div>
  );
}

function Body({ children }) {
  return <div style={{ padding: '20px 20px 32px', display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 860 }}>{children}</div>;
}

function SectionLabel({ children }) {
  return <div style={{ font: 'var(--type-overline)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>{children}</div>;
}

function DescriptionTab({ task }) {
  return (
    <Body>
      <SectionLabel>Objective</SectionLabel>
      <p style={{ font: 'var(--type-body-lg)', color: 'var(--text-body)', margin: 0 }}>
        Port every webhook handler from the v1 signature scheme to v2, keep a shim behind the <code>billing_v2</code> flag, and generate coverage for each event type. Do not touch the payout handlers.
      </p>
      <SectionLabel>Instructions to the agent</SectionLabel>
      <Card padding="sm" style={{ background: 'var(--surface-raised)' }}>
        <ol style={{ margin: 0, paddingLeft: 18, font: 'var(--type-body)', color: 'var(--text-body)', display: 'flex', flexDirection: 'column', gap: 5 }}>
          <li>Read <code>docs/stripe-v2.md</code> and the current handler map.</li>
          <li>Port handlers one at a time; each lands with its own test.</li>
          <li>Keep the v1 shim until support signs off on the runbook.</li>
          <li>Stop and ask before touching anything under <code>payouts/</code>.</li>
        </ol>
      </Card>
      <SectionLabel>Context</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {[['stripe-v2-spec.pdf', '2.4 MB'], ['ledger-schema.sql', '18 KB'], ['docs/stripe-v2.md', 'workspace']].map(([n, m]) => (
          <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--type-ui)', fontWeight: 400, color: 'var(--text-secondary)' }}>
            <Icon name="paperclip" size={13} style={{ color: 'var(--text-tertiary)' }} />{n}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-tertiary)' }}>{m}</span>
          </div>
        ))}
      </div>
    </Body>
  );
}

function QuestionsTab() {
  return (
    <Body>
      <ApprovalBanner tone="warning" title="Atlas stopped to ask, rather than guess"
        description="Two answers are blocking the design stage."
        actions={<Button size="sm" variant="primary">Send answers</Button>} />
      {[
        ['Should the v1 shim stay behind a flag, or be removed in the same change?', 'Removing it now means support loses the fallback mid-migration; keeping it means dead code until Q4.'],
        ['Do replayed events need to preserve their original timestamps?', 'The ledger indexes on received_at, so replays would land out of order unless we backdate them.'],
      ].map(([q, why], i) => (
        <Card key={i} padding="sm">
          <div style={{ display: 'flex', gap: 9 }}>
            <Icon name="circle-help" size={15} style={{ color: 'var(--status-open-questions)', marginTop: 2, flex: 'none' }} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ font: 'var(--type-h3)', fontSize: 'var(--text-md)', color: 'var(--text-primary)' }}>{q}</div>
              <div style={{ font: 'var(--type-body)', color: 'var(--text-secondary)' }}>{why}</div>
              <Textarea rows={2} placeholder="Answer…" />
            </div>
          </div>
        </Card>
      ))}
    </Body>
  );
}

function DesignTab() {
  return (
    <Body>
      <SectionLabel>Proposed approach</SectionLabel>
      <p style={{ font: 'var(--type-body-lg)', color: 'var(--text-body)', margin: 0 }}>
        Route every event through one verifier that accepts both signature schemes, then delete the v1 branch once the shim flag is off. Handlers stay pure; only the transport changes.
      </p>
      <SectionLabel>Options considered</SectionLabel>
      <div style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        {[
          ['Dual verifier behind one entry point', 'Chosen', 'One code path, one flag to remove later.', true],
          ['Parallel v2 endpoint', 'Rejected', 'Doubles the surface support has to reason about.', false],
          ['Big-bang cutover', 'Rejected', 'No rollback if a provider lags on the new scheme.', false],
        ].map(([n, verdict, why, on], i) => (
          <div key={n} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 12px', borderTop: i ? '1px solid var(--border-subtle)' : 0, background: on ? 'var(--accent-soft)' : 'transparent' }}>
            <Icon name={on ? 'circle-check' : 'circle-slash'} size={14} style={{ color: on ? 'var(--status-done)' : 'var(--text-disabled)', marginTop: 2 }} />
            <div style={{ flex: 1 }}>
              <div style={{ font: 'var(--type-ui)', color: 'var(--text-primary)' }}>{n}</div>
              <div style={{ font: 'var(--type-caption)', color: 'var(--text-secondary)', marginTop: 2 }}>{why}</div>
            </div>
            <Badge size="sm" tone={on ? 'accent' : 'neutral'}>{verdict}</Badge>
          </div>
        ))}
      </div>
      <SectionLabel>Decision</SectionLabel>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, font: 'var(--type-body)', color: 'var(--text-secondary)' }}>
        <Avatar name="Mara Vidal" size="xs" />Approved by Mara Vidal · Aug 5, 11:20 · recorded as <code>decisions/0007-webhook-verifier.md</code>
      </div>
    </Body>
  );
}

function ExecutionTab({ task, approved, onApprove }) {
  return (
    <Body>
      {approved ? (
        <ApprovalBanner tone="warning" title="Approved by you · 14:04" description="Atlas resumed and is deploying to staging." actions={<Button size="sm" icon="undo-2">Undo</Button>} />
      ) : (
        <ApprovalBanner title="Approval needed to deploy to staging" description="Milestone 2 of 4 · 12 files changed · 31/31 tests passing"
          actions={<><Button size="sm">Request changes</Button><Button size="sm" variant="primary" icon="check" onClick={onApprove}>Approve</Button></>} />
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 220px', gap: 16, alignItems: 'start' }}>
        <ExecutionLog live entries={window.LOG} height={260} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <ProgressBar value={task.progress || 62} label="Execution" />
          {[['read spec', true], ['port handlers', true], ['generate tests', true], ['deploy staging', false], ['verify + close', false]].map(([s, done]) => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 7, font: 'var(--type-ui)', fontWeight: 400, color: done ? 'var(--text-tertiary)' : 'var(--text-body)' }}>
              <Icon name={done ? 'circle-check' : 'circle-dashed'} size={13} style={{ color: done ? 'var(--status-done)' : 'var(--text-disabled)' }} />
              <span style={{ textDecoration: done ? 'line-through' : 'none' }}>{s}</span>
            </div>
          ))}
        </div>
      </div>
      <SectionLabel>Artifacts</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[['webhooks-v2.diff', '12 files · +684 −211', 'git-compare'], ['coverage-report.html', '31 tests · 94% lines', 'file-check-2'], ['migration-runbook.md', 'draft · 4 steps', 'file-text']].map(([n, m, ic]) => (
          <Card key={n} padding="sm" interactive style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Icon name={ic} size={15} style={{ color: 'var(--text-tertiary)' }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ font: 'var(--type-ui)', color: 'var(--text-primary)' }}>{n}</div>
              <div style={{ font: 'var(--type-caption)', color: 'var(--text-tertiary)' }}>{m}</div>
            </div>
            <Badge tone="accent" size="sm" icon="sparkles">Atlas</Badge>
          </Card>
        ))}
      </div>
    </Body>
  );
}

function TestTab() {
  const rows = [
    ['verifies v2 signatures', 'regression', 'pass', '0.14s'],
    ['rejects tampered payloads', 'regression', 'pass', '0.09s'],
    ['replays idempotently', 'task', 'pass', '1.20s'],
    ['falls back to v1 behind the flag', 'task', 'pass', '0.31s'],
    ['handles clock skew over 5 minutes', 'task', 'fail', '0.44s'],
  ];
  return (
    <Body>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Badge tone="success" icon="circle-check">30 passing</Badge>
        <Badge tone="danger" icon="circle-x">1 failing</Badge>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>2.18s · pnpm test billing</span>
        <span style={{ flex: 1 }} />
        <Button size="sm" icon="refresh-cw">Re-run</Button>
      </div>
      <div style={{ border: '1px solid var(--border-default)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 92px 72px 64px', gap: 10, padding: '7px 12px', background: 'var(--surface-raised)', font: 'var(--type-overline)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>
          <span>Test</span><span>Kind</span><span>Result</span><span style={{ textAlign: 'right' }}>Time</span>
        </div>
        {rows.map(([n, k, res, t], i) => (
          <div key={n} style={{ display: 'grid', gridTemplateColumns: '1fr 92px 72px 64px', gap: 10, alignItems: 'center', padding: '8px 12px', borderTop: '1px solid var(--border-subtle)' }}>
            <span style={{ font: 'var(--type-ui)', fontWeight: 400, color: 'var(--text-primary)' }}>{n}</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-tertiary)' }}>{k}</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, font: 'var(--type-caption)', color: res === 'pass' ? 'var(--success-fg)' : 'var(--danger-fg)' }}>
              <Icon name={res === 'pass' ? 'circle-check' : 'circle-x'} size={12} />{res}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-tertiary)', textAlign: 'right' }}>{t}</span>
          </div>
        ))}
      </div>
      <Card padding="sm" style={{ borderColor: 'var(--danger-bg)' }}>
        <div style={{ font: 'var(--type-ui)', color: 'var(--text-primary)' }}>handles clock skew over 5 minutes</div>
        <pre style={{ margin: '8px 0 0', font: 'var(--type-mono)', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>expected: accepted with tolerance 300s{'\n'}received: SignatureExpired at t+301s</pre>
      </Card>
    </Body>
  );
}

function ReviewTab({ approved, onApprove }) {
  return (
    <Body>
      <Card padding="md">
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <Avatar name="Atlas" kind="agent" size="sm" />
          <div style={{ flex: 1 }}>
            <div style={{ font: 'var(--type-ui)', color: 'var(--text-primary)' }}>Agent review</div>
            <div style={{ font: 'var(--type-caption)', color: 'var(--text-tertiary)' }}>read the description, the cumulative diff and the test output</div>
          </div>
          <Badge tone="warning" icon="circle-alert">1 concern</Badge>
        </div>
        <p style={{ font: 'var(--type-body)', color: 'var(--text-body)', margin: '12px 0 0' }}>
          The port is complete and behaviour-preserving for every event type in the spec. One concern: the clock-skew tolerance is hard-coded at 300s in two places, and the failing test suggests the second one was missed. Recommend extracting it before sign-off.
        </p>
      </Card>
      <SectionLabel>Changes</SectionLabel>
      <div style={{ display: 'flex', gap: 14, font: 'var(--type-caption)', color: 'var(--text-tertiary)' }}>
        <span>12 files</span>
        <span style={{ color: 'var(--success-fg)', fontFamily: 'var(--font-mono)' }}>+684</span>
        <span style={{ color: 'var(--danger-fg)', fontFamily: 'var(--font-mono)' }}>−211</span>
        <span>across billing/, tests/, docs/</span>
      </div>
      <SectionLabel>Comments</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
        {[['Mara Vidal', 'user', '2h', 'Keep the v1 shim until support finishes the runbook.'], ['Atlas', 'agent', '46m', 'Shim retained behind billing_v2. Removal is queued as FRG-226.'], ['Dev Okafor', 'user', '12m', 'Nice. I will take the rate-limit follow-up.']].map(([n, k, t, msg]) => (
          <div key={n + t} style={{ display: 'flex', gap: 9 }}>
            <Avatar name={n} kind={k} size="sm" />
            <div style={{ flex: 1 }}>
              <div style={{ display: 'flex', gap: 7, alignItems: 'baseline' }}>
                <span style={{ font: 'var(--type-ui)', color: 'var(--text-primary)' }}>{n}</span>
                <span style={{ font: 'var(--type-caption)', color: 'var(--text-tertiary)' }}>{t} ago</span>
              </div>
              <div style={{ font: 'var(--type-body)', color: 'var(--text-body)', marginTop: 2 }}>{msg}</div>
            </div>
          </div>
        ))}
        <Textarea rows={2} placeholder="Comment or give the agent feedback…" />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button size="md" icon="undo-2">Request changes</Button>
        <Button size="md" variant="primary" icon="check" onClick={onApprove} disabled={approved}>{approved ? 'Approved' : 'Approve and close'}</Button>
      </div>
    </Body>
  );
}

/* The task opens as a full view in the main pane — properties first, then the
   pipeline as tabs. Stages the task has not reached are disabled. */
function TaskView({ task, onBack, approved, onApprove }) {
  const reached = REACHED[task.status] != null ? REACHED[task.status] : 0;
  const focus = FOCUS[task.status] || 'description';
  const [tab, setTab] = React.useState(focus);
  React.useEffect(() => { setTab(FOCUS[task.status] || 'description'); }, [task.id]);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1, background: 'var(--surface-card)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', borderBottom: '1px solid var(--border-subtle)' }}>
        <IconButton icon="arrow-left" size="sm" label="Back to board" onClick={onBack} />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{task.id}</span>
        <span style={{ font: 'var(--type-ui)', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.title}</span>
        <span style={{ flex: 1 }} />
        <Kbd>Esc</Kbd>
        <IconButton icon="link" size="sm" label="Copy link" />
        <IconButton icon="ellipsis" size="sm" label="More" />
        {task.agent ? <Button size="sm" icon="pause">Pause agent</Button> : null}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        <div style={{ padding: '18px 20px 16px' }}>
          <h1 style={{ font: 'var(--type-h1)', letterSpacing: 'var(--tracking-tight)', color: 'var(--text-primary)', margin: '0 0 14px', maxWidth: 780 }}>{task.title}</h1>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 40px', maxWidth: 860 }}>
            <Prop label="Status"><StatusPill status={task.status} size="sm" /></Prop>
            <Prop label="Agent">{task.agent ? <AgentRunIndicator agent={task.agent} state={task.status === 'running' ? 'running' : 'idle'} compact /> : <span style={{ font: 'var(--type-ui)', fontWeight: 400, color: 'var(--text-tertiary)' }}>unassigned</span>}</Prop>
            <Prop label="Priority"><Badge tone={task.priority === 'urgent' ? 'danger' : task.priority === 'high' ? 'warning' : 'neutral'} size="sm" icon={task.priority === 'low' ? 'signal-low' : task.priority === 'medium' ? 'signal-medium' : 'signal-high'}>{task.priority}</Badge></Prop>
            <Prop label="Model"><Badge size="sm">claude-sonnet-4.5</Badge></Prop>
            <Prop label="Size"><SizePill size={task.size} /></Prop>
            <Prop label="Reviewer"><Avatar name={task.assignee || 'Mara Vidal'} size="xs" /><span style={{ font: 'var(--type-ui)', fontWeight: 400, color: 'var(--text-body)' }}>{task.assignee || 'Mara Vidal'}</span></Prop>
            <Prop label="Labels">{(task.labels || []).map(l => <Tag key={l.name} color={l.color}>{l.name}</Tag>)}</Prop>
            <Prop label="Due"><span style={{ font: 'var(--type-ui)', fontWeight: 400, color: 'var(--text-body)' }}>{task.due || '—'}</span></Prop>
            <Prop label="Branch"><span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>forge/{task.id.toLowerCase()}</span></Prop>
            <Prop label="Updated"><span style={{ font: 'var(--type-ui)', fontWeight: 400, color: 'var(--text-body)' }}>4 min ago</span></Prop>
          </div>
        </div>
        <TabBar value={tab} onChange={setTab} reached={reached} focus={focus} />
        {tab === 'description' ? <DescriptionTab task={task} /> : null}
        {tab === 'questions' ? <QuestionsTab /> : null}
        {tab === 'design' ? <DesignTab /> : null}
        {tab === 'execution' ? <ExecutionTab task={task} approved={approved} onApprove={onApprove} /> : null}
        {tab === 'test' ? <TestTab /> : null}
        {tab === 'review' ? <ReviewTab approved={approved} onApprove={onApprove} /> : null}
      </div>
    </div>
  );
}

Object.assign(window, { TaskView });
