const { Icon, IconButton, TaskCard } = window.ForgeDesignSystem_8868ce;

/* Board is the only view — a switcher with one option is chrome, so the toolbar
   names the saved filter set instead. */
function BoardColumn({ column, tasks, onOpen, selected }) {
  return (
    <div style={{ width: 268, flex: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '0 2px' }}>
        <span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--status-' + column.key + ')' }} />
        <span style={{ font: 'var(--type-ui)', color: 'var(--text-primary)' }}>{column.label}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>{tasks.length}</span>
        <span style={{ flex: 1 }} />
        <IconButton icon="plus" size="sm" label={'Add to ' + column.label} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {tasks.map(t => <TaskCard key={t.id} {...t} selected={selected === t.id} onClick={() => onOpen(t)} />)}
        {tasks.length ? null : <div style={{ height: 56, border: '1px dashed var(--border-subtle)', borderRadius: 'var(--radius-lg)' }} />}
      </div>
    </div>
  );
}

function BoardScreen({ onOpen, selected }) {
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16, background: 'var(--surface-card)' }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        {window.COLUMNS.map(c => (
          <BoardColumn key={c.key} column={c} selected={selected}
            tasks={window.TASKS.filter(t => t.status === c.key)} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { BoardScreen, BoardColumn });
