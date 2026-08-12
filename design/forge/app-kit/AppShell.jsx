const { Icon, IconButton, Avatar, Kbd, Badge, Button, Tooltip } = window.ForgeDesignSystem_8868ce;

const mono = { fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', letterSpacing: 'var(--tracking-caps)', textTransform: 'uppercase', color: 'var(--text-tertiary)' };

/* ── workspace switcher: a project is a workspace, not a sidebar item ── */
function WorkspaceButton({ open, onToggle }) {
  const ws = window.WORKSPACES[0];
  return (
    <div style={{ padding: '10px 12px 12px', borderBottom: '1px solid var(--border-subtle)' }}>
      <button onClick={onToggle} style={{
        display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 6, width: '100%', padding: '10px 12px',
        background: open ? 'var(--surface-raised)' : 'var(--surface-card)',
        border: '1px solid ' + (open ? 'var(--border-strong)' : 'var(--border-default)'),
        borderRadius: 'var(--radius-md)', cursor: 'pointer', textAlign: 'left',
      }}>
        <span style={{ ...mono, fontSize: 10 }}>Project</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span style={{ font: 'var(--type-ui)', fontWeight: 600, fontSize: 15, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ws.name}</span>
          <Icon name="chevron-down" size={14} style={{ marginLeft: 'auto', flex: 'none', color: 'var(--text-tertiary)' }} />
        </span>
      </button>
    </div>
  );
}

function WorkspaceMenu({ onClose }) {
  return (
    <div style={{
      position: 'absolute', top: 8, left: 8, width: 266, zIndex: 6, padding: 5,
      display: 'flex', flexDirection: 'column', gap: 1,
      background: 'var(--surface-overlay-bg)', border: '1px solid var(--border-strong)',
      borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)',
      animation: 'forge-rise var(--duration-fast) var(--ease-out)',
    }}>
      <div style={{ ...mono, padding: '8px 9px 5px' }}>Workspaces</div>
      {window.WORKSPACES.map(w => (
        <button key={w.name} onClick={onClose} style={{
          display: 'flex', alignItems: 'center', gap: 9, padding: '7px 9px', border: 0,
          background: w.on ? 'var(--surface-raised)' : 'transparent', borderRadius: 'var(--radius-md)',
          font: 'var(--type-ui)', fontWeight: w.on ? 500 : 400,
          color: w.on ? 'var(--text-primary)' : 'var(--text-secondary)', cursor: 'pointer', textAlign: 'left',
        }}>
          <span style={{ width: 17, height: 17, borderRadius: 4, background: w.color, flex: 'none' }} />
          <span style={{ flex: 1 }}>{w.name}</span>
          {w.on ? <Icon name="check" size={13} style={{ color: 'var(--text-accent)' }} />
            : <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>{w.open}</span>}
        </button>
      ))}
      <hr style={{ border: 0, borderTop: '1px solid var(--border-strong)', margin: '5px 3px', width: '100%' }} />
      {['Workspace settings', 'New workspace', 'All workspaces'].map(l => (
        <button key={l} onClick={onClose} style={{ display: 'flex', padding: '7px 9px', border: 0, background: 'none', borderRadius: 'var(--radius-md)', font: 'var(--type-ui)', fontWeight: 400, color: 'var(--text-secondary)', cursor: 'pointer', textAlign: 'left' }}>{l}</button>
      ))}
    </div>
  );
}

/* ── faceted filter rail — the rail's job, not navigation ── */
function MenuRow({ item, checked, onToggle }) {
  const [hover, setHover] = React.useState(false);
  return (
    <button type="button" onClick={onToggle}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '5px 8px',
        border: 0, borderRadius: 'var(--radius-md)', cursor: 'pointer', textAlign: 'left',
        background: hover ? 'var(--surface-hover)' : 'transparent',
        font: 'var(--type-ui)', fontWeight: 400,
        color: checked || hover ? 'var(--text-primary)' : 'var(--text-secondary)',
      }}>
      <span style={{
        display: 'grid', placeItems: 'center', width: 12, height: 12, flex: 'none',
        borderRadius: 3, border: '1px solid ' + (checked ? 'var(--accent-solid)' : 'var(--border-strong)'),
        background: checked ? 'var(--accent-solid)' : 'transparent', color: 'var(--accent-on-solid)',
      }}>{checked ? <Icon name="check" size={8} /> : null}</span>
      {item.dot ? <span style={{ width: 8, height: 8, borderRadius: 999, background: item.dot, flex: 'none' }} /> : null}
      {item.bars != null ? (
        <span style={{ display: 'flex', alignItems: 'flex-end', gap: 1.5, height: 9, width: 11, flex: 'none' }}>
          {[3, 6, 9].map((h, i) => <i key={i} style={{ width: 2.5, height: h, borderRadius: 1, background: i < item.bars ? item.color : 'var(--border-strong)' }} />)}
        </span>
      ) : null}
      {item.agent ? <Icon name="sparkles" size={11} style={{ color: 'var(--text-accent)' }} /> : null}
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.label}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>{item.count}</span>
    </button>
  );
}

/* Every filter reads "label: value". The value opens a checkbox menu; one pick
   shows that value, several collapse to "N selected". */
function FilterRow({ facet, picks, setPicks, open, onOpen }) {
  const [rect, setRect] = React.useState(null);
  const [hover, setHover] = React.useState(false);
  const ref = React.useRef(null);
  const empty = !facet.items.length;

  const show = () => {
    if (empty) return;
    setRect(ref.current.getBoundingClientRect());
    onOpen(open ? null : facet.label);
  };
  React.useEffect(() => {
    if (!open) return;
    const away = (e) => {
      const t = e.target;
      const inMenu = t && t.closest && t.closest('[data-facet-menu]');
      if (ref.current && !ref.current.contains(t) && !inMenu) onOpen(null);
    };
    const esc = (e) => { if (e.key === 'Escape') onOpen(null); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const toggle = (label) => setPicks(facet.label, picks.includes(label) ? picks.filter(x => x !== label) : [...picks, label]);
  const value = empty ? 'Any' : picks.length === 0 ? 'Any' : picks.length === 1 ? picks[0] : picks.length + ' selected';
  const one = picks.length === 1 ? facet.items.find(i => i.label === picks[0]) : null;

  return (
    <>
      <button ref={ref} type="button" onClick={show}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8, width: '100%', height: 28, padding: '0 8px',
          border: 0, borderRadius: 'var(--radius-md)', cursor: empty ? 'default' : 'pointer', textAlign: 'left',
          background: open ? 'var(--surface-active)' : hover && !empty ? 'var(--surface-hover)' : 'transparent',
          font: 'var(--type-ui)', fontWeight: 400, opacity: empty ? .5 : 1,
        }}>
        <span style={{ color: 'var(--text-tertiary)', flex: 'none' }}>{facet.label}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0, justifyContent: 'flex-end' }}>
          {one && one.dot ? <span style={{ width: 7, height: 7, borderRadius: 999, background: one.dot, flex: 'none' }} /> : null}
          {one && one.agent ? <Icon name="sparkles" size={11} style={{ color: 'var(--text-accent)' }} /> : null}
          <span style={{
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: picks.length ? 'var(--text-primary)' : 'var(--text-disabled)',
            fontWeight: picks.length ? 500 : 400,
          }}>{value}</span>
          <Icon name="chevron-down" size={11} style={{ color: 'var(--text-tertiary)', flex: 'none' }} />
        </span>
      </button>
      {open && rect ? (
        <div data-facet-menu style={{
          position: 'fixed', top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 208), zIndex: 40,
          maxHeight: 320, overflowY: 'auto', padding: 5, display: 'flex', flexDirection: 'column', gap: 1,
          background: 'var(--surface-overlay-bg)', border: '1px solid var(--border-strong)',
          borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)',
          animation: 'forge-rise var(--duration-fast) var(--ease-out)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', ...mono, fontSize: 9.5, padding: '6px 8px 4px' }}>
            {facet.label}
            <span style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: '.06em', color: 'var(--border-strong)' }}>{facet.src}</span>
          </div>
          {facet.items.map(it => (
            <MenuRow key={it.label} item={it} checked={picks.includes(it.label)} onToggle={() => toggle(it.label)} />
          ))}
          {picks.length ? (
            <button type="button" onClick={() => setPicks(facet.label, [])}
              style={{ marginTop: 3, padding: '6px 8px', border: 0, borderTop: '1px solid var(--border-strong)', background: 'none', cursor: 'pointer', textAlign: 'left', font: 'var(--type-caption)', color: 'var(--text-tertiary)' }}>
              Clear {facet.label.toLowerCase()}
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

function Sidebar() {
  const [menu, setMenu] = React.useState(false);
  const [picks, setPicksMap] = React.useState({ Status: ['Ready', 'Running'], Priority: [], Assignee: [], Labels: [], Due: [] });
  const [openFacet, setOpenFacet] = React.useState(null);
  const setPicks = (facet, next) => setPicksMap(p => ({ ...p, [facet]: next }));
  const total = Object.values(picks).reduce((n, v) => n + v.length, 0);
  return (
    <aside style={{ display: 'flex', flexDirection: 'column', minHeight: 0, background: 'var(--surface-page)', borderRight: '1px solid var(--border-subtle)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 12px 12px' }}>
        <img src="./forge-app/assets/logo.svg" alt="" style={{ width: 26, height: 26, flex: 'none' }} />
        <span style={{ font: 'var(--type-ui)', fontWeight: 600, fontSize: 19, letterSpacing: 'var(--tracking-heading)', color: 'var(--text-primary)' }}>Forge</span>
      </div>
      <WorkspaceButton open={menu} onToggle={() => setMenu(!menu)} />
      {menu ? <WorkspaceMenu onClose={() => setMenu(false)} /> : null}
      <div style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-subtle)' }}>
        <a href="#docs" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 'var(--radius-md)', font: 'var(--type-ui)', fontWeight: 400, color: 'var(--text-secondary)', textDecoration: 'none' }}>
          <Icon name="file-text" size={13} />Docs
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>12</span>
        </a>
      </div>
      <div style={{ padding: '12px 8px', display: 'flex', flexDirection: 'column', gap: 2, overflowY: 'auto', flex: 1 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7, padding: '6px 9px', marginBottom: 10,
          background: 'var(--surface-card)', border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)', font: 'var(--type-ui)', fontWeight: 400, color: 'var(--text-tertiary)',
        }}>
          <Icon name="search" size={13} /><span style={{ flex: 1 }}>Search tasks</span><Kbd>/</Kbd>
        </div>
        <div style={{ ...mono, fontSize: 9.5, padding: '0 8px 6px' }}>Filters</div>
        {window.FACETS.map(fc => (
          <FilterRow key={fc.label} facet={fc} picks={picks[fc.label] || []} setPicks={setPicks}
            open={openFacet === fc.label} onOpen={setOpenFacet} />
        ))}
        <div style={{ marginTop: 'auto', paddingTop: 10, borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: 8, font: 'var(--type-caption)', color: 'var(--text-tertiary)' }}>
          <button onClick={() => setPicksMap({ Status: [], Priority: [], Assignee: [], Labels: [], Due: [] })}
            style={{ border: 0, background: 'none', padding: 0, cursor: 'pointer', font: 'inherit', color: 'inherit' }}>Clear all</button>
          <b style={{ color: 'var(--text-accent)', fontWeight: 500 }}>{total}</b>
        </div>
      </div>
    </aside>
  );
}

/* ── toolbar: one view, so the view selector names the saved filter set ── */
function Chip({ children, onClick, accent }) {
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 9px',
      background: accent ? 'var(--accent-soft)' : 'var(--surface-card)',
      border: '1px solid ' + (accent ? 'var(--accent-soft-border)' : 'var(--border-subtle)'),
      borderRadius: 'var(--radius-md)', cursor: 'pointer', flex: 'none', whiteSpace: 'nowrap',
      font: 'var(--type-ui)', fontWeight: accent ? 500 : 400,
      color: accent ? 'var(--text-accent)' : 'var(--text-secondary)',
    }}>{children}</button>
  );
}

function Toolbar({ shown, total, onNew }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '12px 18px', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'nowrap', overflow: 'hidden' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '4px 8px', borderRadius: 'var(--radius-md)', font: 'var(--type-ui)', color: 'var(--text-primary)', cursor: 'pointer', flex: 'none', whiteSpace: 'nowrap' }}>
        Open work
        <i style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--accent-solid)' }} />
        <Icon name="chevron-down" size={11} style={{ color: 'var(--text-tertiary)' }} />
      </span>
      <span style={{ width: 1, height: 18, background: 'var(--border-subtle)' }} />
      <span style={{ font: 'var(--type-caption)', color: 'var(--text-tertiary)', whiteSpace: 'nowrap' }}>
        <b style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>{shown}</b> of {total} tasks
      </span>
      <span style={{ flex: 1 }} />
      <Chip>Sort <b style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Suggested</b></Chip>
      <Chip>Group <b style={{ color: 'var(--text-primary)', fontWeight: 500 }}>Status</b></Chip>
      <Chip accent>Save view</Chip>
      <span style={{ width: 1, height: 18, background: 'var(--border-subtle)' }} />
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-tertiary)' }}>
        <i style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--status-done)', boxShadow: '0 0 0 3px rgba(111,199,162,.14)' }} />live
      </span>
      <Button variant="primary" size="sm" onClick={onNew} style={{ flex: 'none', whiteSpace: 'nowrap' }}>New task <Kbd style={{ background: 'rgba(255,255,255,.16)', borderColor: 'rgba(255,255,255,.28)', color: 'inherit' }}>C</Kbd></Button>
    </div>
  );
}

/* ── stats band: what the workspace is, and what it is costing ── */
function Meter({ m }) {
  const over = m.pct >= 100;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 124 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, ...mono, fontSize: 9.5, color: over ? 'var(--danger-fg)' : 'var(--text-tertiary)' }}>
        {m.label}<em style={{ marginLeft: 'auto', fontStyle: 'normal', fontSize: 10.5, letterSpacing: 0, color: 'var(--text-secondary)' }}>{m.pct}%</em>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: 'var(--border-subtle)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: '0 auto 0 0', width: Math.min(m.pct, 100) + '%', borderRadius: 3, background: over ? 'var(--warning-solid)' : 'var(--accent-solid)' }} />
      </div>
      <div style={{ fontSize: 10.5, fontFamily: 'var(--font-mono)', color: 'var(--text-tertiary)' }}>{m.budget} · {m.reset}</div>
    </div>
  );
}

function StatsBand() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 18px', background: 'var(--surface-page)', borderBottom: '1px solid var(--border-subtle)', flexWrap: 'nowrap', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, font: 'var(--type-caption)', color: 'var(--text-tertiary)', flex: 'none', whiteSpace: 'nowrap' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 4, padding: '1px 7px' }}>v2.14.0</span>
        <b style={{ color: 'var(--text-primary)', fontWeight: 600 }}>28</b> tasks<span>·</span>
        <b style={{ color: 'var(--text-primary)', fontWeight: 600 }}>17</b> open<span>·</span>11 closed
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'nowrap' }}>
        {window.METERS.map(m => <Meter key={m.label} m={m} />)}
        <Icon name="chevron-down" size={11} style={{ color: 'var(--text-tertiary)' }} />
      </div>
    </div>
  );
}

/* ── activity dock: global, spans the full window under the sidebar ── */
function DockRow({ r, onOpen }) {
  const [hover, setHover] = React.useState(false);
  return (
    <div onClick={onOpen} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 16px', cursor: 'pointer', background: hover ? 'var(--surface-hover)' : 'transparent' }}>
      <span style={{ width: 12, height: 12, borderRadius: 3, background: r.ws.color, flex: 'none' }} />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)', width: 62 }}>{r.id}</span>
      <span style={{ font: 'var(--type-ui)', fontWeight: 400, color: r.queued ? 'var(--text-tertiary)' : 'var(--text-primary)', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-tertiary)', background: 'var(--surface-raised)', border: '1px solid var(--border-subtle)', borderRadius: 4, padding: '1px 7px' }}>{r.model}</span>
      <span style={{ width: 132, display: 'flex', alignItems: 'center', gap: 7 }}>
        {r.queued ? <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-tertiary)' }}>next up</span> : (
          <>
            <span style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--border-subtle)', overflow: 'hidden' }}>
              <span style={r.indeterminate
                ? { display: 'block', height: '100%', width: '100%', background: 'linear-gradient(90deg,transparent,var(--accent-solid),transparent)', backgroundSize: '200% 100%', animation: 'forge-scan 1.4s linear infinite' }
                : { display: 'block', height: '100%', width: (r.step / r.of * 100) + '%', background: 'var(--accent-solid)' }} />
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-tertiary)' }}>{r.indeterminate ? 'planning' : r.step + '/' + r.of}</span>
          </>
        )}
      </span>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-tertiary)', width: 48, textAlign: 'right' }}>{r.elapsed || ''}</span>
      <IconButton icon={r.queued ? 'x' : 'pause'} size="sm" label={r.queued ? 'Remove from queue' : 'Pause run'} />
    </div>
  );
}

function ActivityDock({ open, onToggle, onOpen }) {
  const active = window.RUNS.filter(r => !r.queued);
  const queued = window.RUNS.filter(r => r.queued);
  return (
    <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', background: 'var(--surface-page)', borderTop: '1px solid var(--border-strong)' }}>
      <button onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 16px', border: 0, background: 'none', cursor: 'pointer', font: 'var(--type-ui)', fontWeight: 400, color: 'var(--text-secondary)', textAlign: 'left' }}>
        <Icon name="chevron-down" size={12} style={{ color: 'var(--text-tertiary)', transform: open ? 'none' : 'rotate(180deg)' }} />
        <b style={{ color: 'var(--text-primary)', fontWeight: 600 }}>Activity</b>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-tertiary)' }}>{active.length} running · {queued.length} queued</span>
        <span style={{ flex: 1 }} />
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 10.5, color: 'var(--text-tertiary)' }}>
          <i style={{ width: 6, height: 6, borderRadius: 999, background: 'var(--accent-solid)', animation: 'forge-pulse var(--duration-pulse) infinite' }} />all workspaces
        </span>
      </button>
      {open ? (
        <div style={{ maxHeight: 190, overflowY: 'auto', paddingBottom: 4 }}>
          {active.map(r => <DockRow key={r.id} r={r} onOpen={onOpen} />)}
          <div style={{ ...mono, fontSize: 9.5, padding: '8px 16px 4px' }}>Queued</div>
          {queued.map(r => <DockRow key={r.id} r={r} onOpen={onOpen} />)}
        </div>
      ) : null}
    </div>
  );
}

Object.assign(window, { Sidebar, Toolbar, StatsBand, ActivityDock, Chip });
