import { useEffect, useState } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { ago, boardRows, loadJiraCache, type BoardRow, type JiraCache } from './board';
import { loadFeatures, loadTasks, type Feature } from './features';
import { STATUS_LABEL, type FeatureStatus, type TaskFact } from './featureStatus';

interface Loaded {
  features: Feature[];
  tasks: Map<string, TaskFact[]>;
  jira: JiraCache | null;
}

const CLOSED: FeatureStatus[] = ['done', 'cancelled'];

const STATUS_DOT: Record<FeatureStatus, string> = {
  cancelled: 'bg-nim-tertiary',
  done: 'bg-nim-success',
  awaiting_decision: 'bg-nim-warning',
  in_progress: 'bg-nim-primary',
  started: 'bg-nim-info',
  consulting: 'bg-nim-info',
  todo: 'bg-nim-tertiary',
};

export function FeatureBoard({ host }: PanelHostProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  // A fullscreen panel remounts each time it is opened, so loading on mount
  // already picks up Feature files, Tasks and the Jira cache that changed while it was closed.
  useEffect(() => {
    let cancelled = false;
    const ws = host.workspacePath;
    Promise.all([loadFeatures(ws), loadTasks(ws), loadJiraCache(ws)])
      .then(([features, tasks, jira]) => !cancelled && setLoaded({ features, tasks, jira }))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
    };
  }, [host.workspacePath]);

  const rows = loaded && boardRows(loaded.features, loaded.tasks, loaded.jira);
  const closedCount = rows?.filter((r) => CLOSED.includes(r.status)).length ?? 0;
  const shown = rows?.filter((r) => showClosed || !CLOSED.includes(r.status));
  const jira = loaded?.jira ?? null;
  // A Feature names an Epic but nothing was ever read from Jira for this workspace.
  const jiraNeverSynced = !jira && loaded?.features.some((f) => f.epic);

  return (
    <div className="feature-board flex h-full flex-col overflow-hidden bg-nim text-nim">
      {/* A div, not <header>: the host's global `header h1` rule paints a dark colour and a top margin. */}
      <div className="feature-board-header flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-4">
        <h1 className="text-base font-semibold text-nim">Features</h1>
        {shown && <span className="text-xs text-nim-muted">{shown.length}</span>}
        {closedCount > 0 && (
          <label className="feature-board-show-closed flex cursor-pointer items-center gap-1.5 text-xs text-nim-muted">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} />
            Show done ({closedCount})
          </label>
        )}
        <span className="feature-board-jira-age ml-auto text-xs text-nim-muted">
          {jira
            ? `Jira read ${ago(jira.fetchedAt, Date.now()) || 'at an unknown time'} · /feature-sync refreshes it`
            : jiraNeverSynced
              ? 'Jira status not read yet · run /feature-sync'
              : ''}
        </span>
      </div>
      <div className="feature-board-body flex-1 overflow-auto p-4">
        {error ? (
          <p className="feature-board-error text-sm text-nim-error select-text">Could not read .features/: {error}</p>
        ) : !shown ? (
          <p className="text-sm text-nim-muted">Loading…</p>
        ) : rows!.length === 0 ? (
          <p className="feature-board-empty text-sm text-nim-muted">
            No Feature files in <code>.features/</code> of this workspace.
          </p>
        ) : (
          <table className="feature-board-table w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-nim text-xs text-nim-muted">
                <th className="px-3 py-2 font-medium">Feature</th>
                <th className="px-3 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">Status</th>
                {jira && <th className="px-3 py-2 font-medium">Jira</th>}
                {jira && <th className="px-3 py-2 font-medium">Labels</th>}
                <th className="px-3 py-2 text-right font-medium">Tasks</th>
                <th className="w-48 px-3 py-2 font-medium">Done</th>
                <th className="px-3 py-2 font-medium">Open tasks</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <FeatureRow key={row.id} row={row} hasJira={Boolean(jira)} onOpen={(path) => host.openFile(path)} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function FeatureRow({ row, hasJira, onOpen }: { row: BoardRow; hasJira: boolean; onOpen: (path: string) => void }) {
  const { feature, epic, progress } = row;
  const { total, done } = progress;
  const openTasks = [
    progress.inProgress && `${progress.inProgress} in progress`,
    progress.inReview && `${progress.inReview} in review`,
    progress.todo && `${progress.todo} to do`,
  ].filter(Boolean);
  const meta = [
    feature?.kind,
    feature?.branch,
    feature && feature.mrs.length > 0 && `MR ${feature.mrs.map((mr) => `!${mr}`).join(' ')}`,
    feature && feature.relates.length > 0 && `relates to ${feature.relates.join(', ')}`,
    !feature && 'no Feature file',
  ].filter(Boolean);
  const open = feature ? () => onOpen(feature.path) : undefined;

  return (
    <tr
      className={`feature-row border-b border-nim align-top ${open ? 'cursor-pointer hover:bg-nim-hover' : ''}`}
      onClick={open}
    >
      <td className="px-3 py-2">
        {open ? (
          // The button keeps the row reachable by keyboard; the row click is the larger mouse target.
          <button type="button" className="feature-row-title text-left font-medium text-nim hover:underline">
            {row.title}
          </button>
        ) : (
          <span className="feature-row-title text-nim-muted">{row.title}</span>
        )}
        {meta.length > 0 && <div className="feature-row-meta mt-0.5 text-xs text-nim-faint">{meta.join(' · ')}</div>}
      </td>
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-nim-muted">{row.id}</td>
      <td className="feature-row-status whitespace-nowrap px-3 py-2">
        <span className="flex items-center gap-1.5">
          <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[row.status]}`} />
          {STATUS_LABEL[row.status]}
          {row.blocked && <span className="text-xs text-nim-error">blocked</span>}
        </span>
        {row.mrStateUnknown && <div className="mt-0.5 text-xs text-nim-faint">MR state not read</div>}
      </td>
      {hasJira && (
        <td className="feature-row-jira whitespace-nowrap px-3 py-2 text-nim-muted">
          {epic && (
            <>
              {epic.status}
              {epic.openCards > 0 && (
                <div className="mt-0.5 text-xs text-nim-faint">
                  {epic.openCards} open {epic.openCards === 1 ? 'card' : 'cards'}
                  {epic.cardsInProgress > 0 && `, ${epic.cardsInProgress} in progress`}
                </div>
              )}
            </>
          )}
        </td>
      )}
      {hasJira && (
        <td className="feature-row-labels px-3 py-2">
          <span className="flex flex-wrap gap-1">
            {epic?.labels.map((label) => (
              <span key={label} className="rounded bg-nim-tertiary px-1.5 py-0.5 text-xs text-nim-muted">
                {label}
              </span>
            ))}
          </span>
        </td>
      )}
      <td className="feature-row-tasks px-3 py-2 text-right tabular-nums">{total || ''}</td>
      <td className="feature-row-done px-3 py-2">
        {total > 0 && (
          <div className="flex items-center gap-2">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-nim-tertiary">
              <div className="h-full rounded-full bg-nim-success" style={{ width: `${(done / total) * 100}%` }} />
            </div>
            <span className="whitespace-nowrap tabular-nums">
              {done}/{total}
            </span>
          </div>
        )}
      </td>
      <td className="feature-row-open px-3 py-2 text-nim-muted">{openTasks.join(' · ')}</td>
    </tr>
  );
}
