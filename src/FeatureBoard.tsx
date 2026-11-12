import { useEffect, useState } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { ago, boardRows, isStale, loadBoard, type Board, type BoardRow } from './board';
import { sortTasks, STATUS_LABEL, type FeatureStatus, type WaitItem } from './featureStatus';

const CLOSED: FeatureStatus[] = ['done', 'cancelled'];
/** What the checkbox reveals, in the words the Status column uses. */
const CLOSED_LABEL = CLOSED.map((status) => STATUS_LABEL[status]).join(' / ');

// The neutral dot is a text tone: a background tone (`bg-nim-tertiary`) is invisible on the panel.
const STATUS_DOT: Record<FeatureStatus, string> = {
  cancelled: 'bg-[var(--nim-text-faint)]',
  done: 'bg-nim-success',
  awaiting_decision: 'bg-nim-warning',
  in_progress: 'bg-nim-primary',
  started: 'bg-nim-info',
  consulting: 'bg-nim-info',
  todo: 'bg-[var(--nim-text-faint)]',
};

const WAIT_LABEL: Record<WaitItem['kind'], string> = {
  decision: 'question in session',
  review: 'MR waits for review',
  ci_failed: 'CI failed on MR',
  session_error: 'session ended with an error',
  blocked: 'blocked Task',
};

export function FeatureBoard({ host }: PanelHostProps) {
  const [loaded, setLoaded] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Opening a file unmounts the panel, so the choice is kept in the workspace's storage, not in state alone.
  const [showClosed, setShowClosed] = useState(() => host.storage.get<boolean>('showClosed') ?? false);
  const [reloads, setReloads] = useState(0);
  const reload = () => setReloads((n) => n + 1);

  // Every folder of the workspace, primary root first. A host before SDK 0.6.0 has only the primary root.
  const folders = host.getWorkspaceFolders?.() ?? [host.workspacePath];
  const foldersKey = folders.join('\n');

  // The host tells a panel nothing about file or tracker changes, so the board
  // loads on mount, on Refresh, and whenever the window gets the focus back.
  // The rows on screen stay until the new ones are in.
  useEffect(() => {
    let cancelled = false;
    loadBoard(folders)
      .then((board) => {
        if (cancelled) return;
        setLoaded(board);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        console.error('[feature-board] load failed:', e);
        setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [foldersKey, reloads]);
  useEffect(() => {
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, []);

  const rows = loaded && boardRows(loaded.features, loaded.tasks, loaded.jira, loaded.sessions);
  // The host's own way to show a session (its git panel does the same); it leaves the board.
  const openSession = (sessionId: string) =>
    window.dispatchEvent(
      new CustomEvent('open-ai-session', { detail: { sessionId, workspacePath: host.workspacePath } }),
    );
  const closedCount = rows?.filter((r) => CLOSED.includes(r.status)).length ?? 0;
  const shown = rows?.filter((r) => showClosed || !CLOSED.includes(r.status));
  const hasTasks = shown?.some((r) => r.progress.total > 0) ?? false;
  const jira = loaded?.jira ?? null;
  // Read on every render, and every load renders, so the age is as fresh as the rows.
  const now = Date.now();
  const jiraStale = jira !== null && isStale(jira.fetchedAt, now);
  // A Feature names an Epic but nothing was ever read from Jira for this workspace.
  const jiraNeverSynced = !jira && loaded?.features.some((f) => f.epic);
  const jiraNote = loaded?.jiraError
    ? `jira-cache.json could not be read (${loaded.jiraError}) · Jira status unknown · run /feature-sync`
    : jira
      ? `Jira read ${ago(jira.fetchedAt, now) || 'at an unknown time'} · ${jiraStale ? 'statuses may be out of date · ' : ''}/feature-sync refreshes it`
      : loaded?.worktree
        ? // /feature-sync writes the cache to the main checkout, so it cannot help here.
          'This is a worktree · open the main checkout to see Jira status and Tasks'
        : jiraNeverSynced
          ? 'Jira status not read yet · run /feature-sync'
          : '';

  return (
    <div className="feature-board flex h-full flex-col overflow-hidden bg-nim text-nim">
      {/* A div, not <header>: the host's global `header h1` rule paints a dark colour and a top margin. */}
      <div className="feature-board-header flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-4">
        <h1 className="text-base font-semibold text-nim">Features</h1>
        {shown && <span className="text-xs text-nim-muted">{shown.length}</span>}
        {closedCount > 0 && (
          <label className="feature-board-show-closed flex cursor-pointer items-center gap-1.5 text-xs text-nim-muted">
            <input
              type="checkbox"
              checked={showClosed}
              onChange={(e) => {
                setShowClosed(e.target.checked);
                void host.storage.set('showClosed', e.target.checked);
              }}
            />
            Show {CLOSED_LABEL} ({closedCount})
          </label>
        )}
        <button type="button" className="feature-board-refresh text-xs text-nim-muted hover:underline" onClick={reload}>
          Refresh
        </button>
        <span
          className={`feature-board-jira-age ml-auto text-xs select-text ${
            loaded?.jiraError ? 'text-nim-error' : jiraStale ? 'text-nim-warning' : 'text-nim-muted'
          }`}
        >
          {jiraNote}
        </span>
        {/* ponytail: a fixed line while board.ts passes no worktree and no MR state; drop it with that gap. */}
        <p className="feature-board-limits basis-full text-xs text-nim-muted">
          Worktrees and MR state are not read yet: a row never shows {STATUS_LABEL.started}, and an MR that waits for
          review or failed CI is not listed.
        </p>
        {loaded?.truncated && (
          <p className="feature-board-truncated basis-full text-xs text-nim-warning">
            Only the first 200 entries of .features/ were read; Feature files may be missing.
          </p>
        )}
      </div>
      <div className="feature-board-body flex-1 overflow-auto p-4">
        {error ? (
          <p className="feature-board-error text-sm text-nim-error select-text">Could not load the board: {error}</p>
        ) : !shown ? (
          <p className="text-sm text-nim-muted">Loading…</p>
        ) : rows!.length === 0 ? (
          <p className="feature-board-empty text-sm text-nim-muted select-text">
            No Feature files found in <code>{folders.map((folder) => `${folder}/.features/`).join(', ')}</code> (the
            folder is missing, empty or could not be read).
          </p>
        ) : shown.length === 0 ? (
          <p className="feature-board-all-closed text-sm text-nim-muted">
            All {closedCount} Features are closed ({CLOSED_LABEL}). Tick “Show {CLOSED_LABEL}” to list them.
          </p>
        ) : (
          <>
            <WaitList
              title="Waiting on you"
              items={rows!.flatMap((r) => r.waiting)}
              now={now}
              onOpenSession={openSession}
            />
            <WaitList title="Stuck" items={rows!.flatMap((r) => r.stuck)} now={now} onOpenSession={openSession} />
            <table className="feature-board-table w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-nim text-xs text-nim-muted">
                  <th className="px-3 py-2 font-medium">Feature</th>
                  <th className="px-3 py-2 font-medium">ID</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  {jira && <th className="px-3 py-2 font-medium">Jira</th>}
                  {jira && <th className="px-3 py-2 font-medium">Labels</th>}
                  {hasTasks && <th className="px-3 py-2 text-right font-medium">Tasks</th>}
                  {hasTasks && <th className="w-48 px-3 py-2 font-medium">Progress</th>}
                  {hasTasks && <th className="px-3 py-2 font-medium">Open tasks</th>}
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <FeatureRow
                    key={row.id}
                    row={row}
                    hasJira={Boolean(jira)}
                    hasTasks={hasTasks}
                    onOpen={(path) => host.openFile(path)}
                  />
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </div>
  );
}

/** One of the two lists above the table: what needs an answer, or what cannot move on its own. */
function WaitList({
  title,
  items,
  now,
  onOpenSession,
}: {
  title: string;
  items: WaitItem[];
  now: number;
  onOpenSession: (sessionId: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="feature-board-wait mb-4 text-sm select-text">
      <h2 className="m-0 mb-1 text-xs font-semibold text-nim">
        {title} ({items.length})
      </h2>
      {items.map((item, i) => (
        <div key={i} className="feature-board-wait-item flex flex-wrap items-baseline gap-x-2 py-0.5">
          <span className="font-mono text-xs text-nim-muted">{item.featureId}</span>
          <span>
            {WAIT_LABEL[item.kind]}: {item.title}
          </span>
          <span className="text-xs text-nim-muted">{ago(item.openedAt, now)}</span>
          {item.sessionId && (
            <button
              type="button"
              className="text-xs text-nim-muted underline"
              onClick={() => onOpenSession(item.sessionId!)}
            >
              open session
            </button>
          )}
        </div>
      ))}
    </section>
  );
}

function FeatureRow({
  row,
  hasJira,
  hasTasks,
  onOpen,
}: {
  row: BoardRow;
  hasJira: boolean;
  hasTasks: boolean;
  onOpen: (path: string) => void;
}) {
  const { feature, epic, progress } = row;
  const { total, done } = progress;
  const openTasks = [
    progress.inProgress && `${progress.inProgress} in progress`,
    progress.inReview && `${progress.inReview} in review`,
    progress.todo && `${progress.todo} to do`,
    progress.other && `${progress.other} unknown status`,
  ].filter(Boolean);
  const mrList = feature && feature.mrs.length > 0 && `MR ${feature.mrs.map((mr) => `!${mr}`).join(' ')}`;
  const meta = [
    feature?.kind,
    feature?.branch,
    mrList,
    feature && feature.relates.length > 0 && `relates to ${feature.relates.join(', ')}`,
    !feature && 'no Feature file in this checkout',
  ].filter(Boolean);
  const open = feature ? () => onOpen(feature.path) : undefined;

  return (
    <tr
      className={`feature-row border-b border-nim align-top ${open ? 'cursor-pointer hover:bg-nim-hover' : ''}`}
      // A click that ends a text selection (copying the id, a branch name) is not a request to open the file.
      onClick={open && (() => window.getSelection()?.toString() || open())}
    >
      <td className="px-3 py-2">
        {open ? (
          // The button keeps the row reachable by keyboard; the row click is the larger mouse target.
          <button
            type="button"
            className="feature-row-title text-left font-medium text-nim hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              open();
            }}
          >
            {row.title}
          </button>
        ) : (
          <span className="feature-row-title text-nim-muted">{row.title}</span>
        )}
        <RowDetail row={row} />
        {meta.length > 0 && <div className="feature-row-meta mt-0.5 text-xs text-nim-muted">{meta.join(' · ')}</div>}
        {feature?.unreadable && (
          <div className="feature-row-unreadable mt-0.5 text-xs text-nim-error">
            File not read as a Feature: {feature.unreadable}
          </div>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-nim-muted">{row.id}</td>
      <td className="feature-row-status whitespace-nowrap px-3 py-2">
        <span className="flex items-center gap-1.5">
          {row.unknown ? (
            // The status was computed without a fact it needs, so no dot and no label.
            <span className="feature-row-unknown text-nim-muted">
              unknown · {row.unknown === 'MR state not read' ? `${mrList} not checked` : row.unknown}
            </span>
          ) : (
            <>
              <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[row.status]}`} />
              {STATUS_LABEL[row.status]}
            </>
          )}
          {row.blocked && <span className="text-xs text-nim-error">blocked</span>}
          {row.stalled && <span className="text-xs text-nim-warning">stalled</span>}
        </span>
        {row.mrStateUnknown && row.unknown !== 'MR state not read' && (
          <div className="mt-0.5 text-xs text-nim-muted">MR state not read</div>
        )}
      </td>
      {hasJira && (
        <td className="feature-row-jira whitespace-nowrap px-3 py-2 text-nim-muted">
          {!epic && feature?.epic && `${feature.epic} not in cache`}
          {epic && (
            <>
              {epic.status}
              {epic.openCards > 0 && (
                <div className="mt-0.5 text-xs text-nim-muted">
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
      {hasTasks && <td className="feature-row-tasks px-3 py-2 text-right tabular-nums">{total || ''}</td>}
      {hasTasks && (
        <td className="feature-row-done px-3 py-2">
          {total > 0 && (
            <div className="flex items-center gap-2">
              {/* The border keeps an empty track visible: its background tone alone is not. */}
              <div className="h-2 flex-1 overflow-hidden rounded-full border border-nim bg-nim-tertiary">
                <div className="h-full rounded-full bg-nim-success" style={{ width: `${(done / total) * 100}%` }} />
              </div>
              <span className="whitespace-nowrap tabular-nums">
                {done}/{total}
              </span>
            </div>
          )}
        </td>
      )}
      {hasTasks && <td className="feature-row-open px-3 py-2 text-nim-muted">{openTasks.join(' · ')}</td>}
    </tr>
  );
}

/**
 * What the Feature file says and what its Tasks are, under the title: the Goal's
 * first paragraph, and on unfolding the rest of the Goal, the acceptance
 * criteria, Related code, Decisions and the Tasks. A native <details>, so it
 * needs no state and works from the keyboard. The text is shown as written.
 *
 * ponytail: the body is only as wide as the Feature column, and Markdown is
 * not rendered (links are text). Move it to a full-width row under the Feature
 * if long criteria feel cramped.
 */
function RowDetail({ row }: { row: BoardRow }) {
  const feature = row.feature?.unreadable ? undefined : row.feature;
  const { tasks, progress } = row;
  // An Epic with no file and no Tasks has nothing to unfold.
  if (!feature && tasks.length === 0) return null;

  const taskCount = `Tasks ${progress.done}/${progress.total}`;
  const [summary, ...restOfGoal] = (feature?.goal ?? '').split('\n\n');
  const criteria = feature?.criteria ?? [];
  const heading = 'mt-2 font-medium text-nim';
  return (
    <details
      className="feature-row-detail group mt-0.5 cursor-default text-xs text-nim-muted select-text"
      // The row's click opens the file; a click in here unfolds the detail or selects its text.
      onClick={(e) => e.stopPropagation()}
    >
      <summary className="flex cursor-pointer list-none gap-1">
        <span className="shrink-0 group-open:[transform:rotate(90deg)]">▸</span>
        <span className="line-clamp-1 group-open:line-clamp-none">
          {summary || (feature ? 'No Goal written' : taskCount)}
        </span>
      </summary>
      <div className="ml-3.5 whitespace-pre-wrap pb-1">
        {restOfGoal.length > 0 && <div className="feature-row-goal mt-1">{restOfGoal.join('\n\n')}</div>}
        {feature && (
          <>
            <div className={heading}>
              Acceptance criteria{' '}
              {criteria.length > 0 ? `${criteria.filter((c) => c.done).length}/${criteria.length}` : '· none written'}
            </div>
            {criteria.map((c, i) => (
              <div key={i} className="feature-row-criterion flex gap-1.5">
                <span className="shrink-0">{c.done ? '☑' : '☐'}</span>
                <span>{c.text}</span>
              </div>
            ))}
            {feature.relatedCode && <div className={heading}>Related code</div>}
            {feature.relatedCode}
            {feature.decisions && <div className={heading}>Decisions</div>}
            {feature.decisions}
          </>
        )}
        <div className={heading}>{tasks.length > 0 ? taskCount : 'Tasks · none'}</div>
        {sortTasks(tasks).map((task) => (
          <div key={task.id} className="feature-row-task flex gap-2">
            <span className="w-20 shrink-0">{task.status.replace(/-/g, ' ')}</span>
            <span>
              {task.title}
              {task.tags.includes('blocked') && task.status !== 'done' && task.status !== 'wont-do' && (
                <span className="text-nim-error"> blocked</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}
