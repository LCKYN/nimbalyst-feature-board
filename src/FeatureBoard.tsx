import { useEffect, useState } from 'react';
import { copyToClipboard, type PanelHostProps } from '@nimbalyst/extension-sdk';
import {
  ago,
  boardRows,
  criteriaProgress,
  epicUrl,
  isOverdue,
  isStale,
  loadBoard,
  localDate,
  matches,
  salesList,
  sortRows,
  touchesFeatures,
  trailing,
  usageCells,
  type Board,
  type BoardRow,
  type Sort,
  type SortKey,
} from './board';
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
  // Statuses set by hand, by row id. They live in the board's own storage, never in the Feature file.
  const [overrides, setOverrides] = useState(() => host.storage.get<Record<string, string>>('statusOverride') ?? {});
  const setStatus = (id: string, status: string) => {
    const { [id]: _cleared, ...rest } = overrides;
    const next = status ? { ...rest, [id]: status } : rest;
    setOverrides(next);
    void host.storage.set('statusOverride', next);
  };
  const [query, setQuery] = useState('');
  // Kept in storage for the same reason as `showClosed`. Null is the board's own order: what needs you first.
  const [sort, setSort] = useState<Sort | null>(() => host.storage.get<Sort>('sort') ?? null);
  // One header click sorts up, the next down, the third goes back to the board's own order.
  const toggleSort = (key: SortKey) => {
    const next = sort?.key !== key ? { key, desc: false } : sort.desc ? null : { key, desc: true };
    setSort(next);
    void host.storage.set('sort', next);
  };
  const [copied, setCopied] = useState(false);
  const [reloads, setReloads] = useState(0);
  const reload = () => setReloads((n) => n + 1);

  // Every folder of the workspace, primary root first. A host before SDK 0.6.0 has only the primary root.
  const folders = host.getWorkspaceFolders?.() ?? [host.workspacePath];
  const foldersKey = folders.join('\n');

  // The board loads on mount, on Refresh, when the window gets the focus back
  // and on the two host events below. The rows on screen stay until the new ones are in.
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
  // A Task written by an agent or the Tracker, and a file changed, added or
  // deleted in `.features/` (Feature files and, until `.gitignore` lists it,
  // the Jira cache: the host's watcher drops gitignored changes). A burst of
  // events, such as a session writing several files, loads the board once.
  //
  // ponytail: session changes are not listened to, so a session that starts to
  // wait shows on the next focus, Refresh or Task change. The host sends
  // `ai-session-state:event` on every bit of session activity; check what it
  // carries, then subscribe it to `reloadSoon` as well.
  useEffect(() => {
    const reloadSoon = trailing(reload, 300);
    // `?.`: a host without the method still gets the focus reload.
    const offTasks = host.onWorkspaceEvent?.('document-service:tracker-items-changed', reloadSoon);
    const offFiles = host.onWorkspaceEvent?.(
      'file-changed-on-disk',
      (event) => touchesFeatures(event) && reloadSoon(),
    );
    window.addEventListener('focus', reloadSoon);
    return () => {
      reloadSoon.cancel();
      offTasks?.();
      offFiles?.();
      window.removeEventListener('focus', reloadSoon);
    };
  }, [host]);

  const rows = loaded && boardRows(loaded.features, loaded.tasks, loaded.jira, loaded.sessions, overrides);
  // The host's own way to show a session (its git panel does the same); it leaves the board.
  const openSession = (sessionId: string) =>
    window.dispatchEvent(
      new CustomEvent('open-ai-session', { detail: { sessionId, workspacePath: host.workspacePath } }),
    );
  const closedCount = rows?.filter((r) => CLOSED.includes(r.status)).length ?? 0;
  const filtering = query.trim() !== '';
  // A filter searches the closed rows too: "prod" must find what already shipped.
  const filtered = rows?.filter((r) => (filtering ? matches(r, query) : showClosed || !CLOSED.includes(r.status)));
  const shown = filtered && sortRows(filtered, sort);
  // The SDK's helper, not `navigator.clipboard`, which can fail without a sign in Electron.
  const copyList = () =>
    copyToClipboard(salesList(shown ?? [])).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      (e) => console.error('[feature-board] copy failed:', e),
    );
  const hasTasks = shown?.some((r) => r.progress.total > 0) ?? false;
  const hasTarget = shown?.some((r) => r.target) ?? false;
  const hasCriteria = shown?.some((r) => r.feature?.criteria.length) ?? false;
  const jira = loaded?.jira ?? null;
  const columns = (
    [
      ['title', 'Feature'],
      ['id', 'ID'],
      ['status', 'Status'],
      hasTarget && ['target', 'Target'],
      jira && ['jira', 'Jira'],
      jira && ['labels', 'Labels'],
      hasCriteria && ['criteria', 'Criteria'],
      hasTasks && ['tasks', 'Tasks', 'text-right'],
      hasTasks && ['progress', 'Progress', 'w-48'],
      hasTasks && ['open', 'Open tasks'],
    ] as (false | null | [SortKey, string, string?])[]
  ).filter((c): c is [SortKey, string, string?] => Boolean(c));
  // Read on every render, and every load renders, so the age is as fresh as the rows.
  const now = Date.now();
  const today = localDate(new Date(now));
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
              // A filter lists closed rows whatever this says.
              disabled={filtering}
              checked={showClosed}
              onChange={(e) => {
                setShowClosed(e.target.checked);
                void host.storage.set('showClosed', e.target.checked);
              }}
            />
            Show {CLOSED_LABEL} ({closedCount})
          </label>
        )}
        <input
          type="search"
          className="feature-board-filter w-48 rounded border border-nim bg-transparent px-2 py-0.5 text-xs text-nim"
          placeholder="Search title, id, label, status"
          aria-label="Search the Features by title, id, label or status"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button type="button" className="feature-board-refresh text-xs text-nim-muted hover:underline" onClick={reload}>
          Refresh
        </button>
        <button
          type="button"
          className="feature-board-copy text-xs text-nim-muted hover:underline"
          title="Copy the rows shown as a plain list: title, Jira status, labels"
          disabled={!shown?.length}
          onClick={copyList}
        >
          {copied ? `Copied ${shown?.length ?? 0}` : 'Copy list'}
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
        ) : shown.length === 0 && filtering ? (
          <p className="feature-board-no-match text-sm text-nim-muted">No Feature matches “{query.trim()}”.</p>
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
                  {columns.map(([key, label, className = '']) => {
                    const sorted = sort?.key === key ? (sort.desc ? 'descending' : 'ascending') : undefined;
                    return (
                      <th key={key} className={`px-3 py-2 font-medium ${className}`} aria-sort={sorted}>
                        {/* A button, so a header can be reached and pressed from the keyboard. */}
                        <button
                          type="button"
                          className="feature-board-sort font-medium hover:underline"
                          title={`Sort by ${label}`}
                          onClick={() => toggleSort(key)}
                        >
                          {label}
                          {sorted && (sorted === 'descending' ? ' ▼' : ' ▲')}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => (
                  <FeatureRow
                    key={row.id}
                    row={row}
                    hasJira={Boolean(jira)}
                    hasTasks={hasTasks}
                    hasTarget={hasTarget}
                    hasCriteria={hasCriteria}
                    overdue={isOverdue(row, today)}
                    usage={loaded!.usage}
                    jiraUrl={epicUrl(loaded!.jiraSite, row.epic?.key)}
                    onOpen={(path) => host.openFile(path)}
                    onSetStatus={setStatus}
                    onFilter={setQuery}
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
  hasTarget,
  hasCriteria,
  overdue,
  usage,
  jiraUrl,
  onOpen,
  onSetStatus,
  onFilter,
}: {
  row: BoardRow;
  hasJira: boolean;
  hasTasks: boolean;
  hasTarget: boolean;
  hasCriteria: boolean;
  overdue: boolean;
  /** Tokens, cost and working time by session id; null when the host could not give them. */
  usage: Board['usage'];
  /** The Epic's page in Jira, empty when there is no Epic or the site is not known. */
  jiraUrl: string;
  onOpen: (path: string) => void;
  /** An empty status clears the hand-set one. */
  onSetStatus: (id: string, status: string) => void;
  onFilter: (query: string) => void;
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
  const criteria = criteriaProgress(row);

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
        <RowDetail row={row} usage={usage} />
        {meta.length > 0 && <div className="feature-row-meta mt-0.5 text-xs text-nim-muted">{meta.join(' · ')}</div>}
        {feature?.unreadable && (
          <div className="feature-row-unreadable mt-0.5 text-xs text-nim-error">
            File not read as a Feature: {feature.unreadable}
          </div>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-nim-muted">
        {row.id}
        {jiraUrl && (
          // Its own button, so the id beside it can still be selected and copied.
          <button
            type="button"
            className="feature-row-jira-link ml-1 hover:text-nim"
            title={`Open ${epic?.key} in Jira`}
            aria-label={`Open ${epic?.key} in Jira`}
            onClick={(e) => {
              e.stopPropagation();
              void window.electronAPI.invoke('open-external', jiraUrl);
            }}
          >
            ↗
          </button>
        )}
      </td>
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
          {row.handSet && <span className="feature-row-hand-set text-xs text-nim-muted">✎ hand-set</span>}
          {row.blocked && <span className="text-xs text-nim-error">blocked</span>}
          {row.stalled && <span className="text-xs text-nim-warning">stalled</span>}
        </span>
        {/* Native <select>: the first option sets nothing, or clears what was set. */}
        <select
          className="feature-row-set-status mt-0.5 block cursor-pointer bg-transparent text-xs text-nim-muted"
          aria-label={`Set the status of ${row.id} by hand`}
          value={row.handSet ? row.status : ''}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onSetStatus(row.id, e.target.value)}
        >
          <option className="bg-nim text-nim" value="">
            {row.handSet ? 'clear · back to computed' : 'set by hand…'}
          </option>
          {Object.entries(STATUS_LABEL).map(([status, label]) => (
            <option key={status} className="bg-nim text-nim" value={status}>
              {label}
            </option>
          ))}
        </select>
        {row.mrStateUnknown && row.unknown !== 'MR state not read' && (
          <div className="mt-0.5 text-xs text-nim-muted">MR state not read</div>
        )}
      </td>
      {hasTarget && (
        <td className={`feature-row-target whitespace-nowrap px-3 py-2 ${overdue ? 'text-nim-error' : 'text-nim-muted'}`}>
          {row.target}
          {overdue && ' overdue'}
        </td>
      )}
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
              <button
                key={label}
                type="button"
                className="rounded bg-nim-tertiary px-1.5 py-0.5 text-xs text-nim-muted hover:underline"
                title={`Show the Features labelled ${label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onFilter(label);
                }}
              >
                {label}
              </button>
            ))}
          </span>
        </td>
      )}
      {hasCriteria && (
        <td className="feature-row-criteria whitespace-nowrap px-3 py-2 tabular-nums">
          {criteria && `${criteria.done}/${criteria.total}`}
          {criteria?.noOpenTask && <div className="mt-0.5 text-xs text-nim-warning">no open Task</div>}
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
function RowDetail({ row, usage }: { row: BoardRow; usage: Board['usage'] }) {
  const feature = row.feature?.unreadable ? undefined : row.feature;
  const { tasks, progress } = row;
  // An Epic with no file and no Tasks has nothing to unfold.
  if (!feature && tasks.length === 0) return null;

  const taskCount = `Tasks ${progress.done}/${progress.total}`;
  // Sessions, tokens, cost and time over all the Tasks; null when no Task links a session.
  const total = usageCells(tasks, usage);
  const hasCommit = tasks.some((t) => t.commit);
  const cell = 'py-0.5 pl-4 text-right whitespace-nowrap tabular-nums';
  const [summary, ...restOfGoal] = (feature?.goal ?? '').split('\n\n');
  const criteria = feature?.criteria ?? [];
  const ticked = feature && criteriaProgress(row);
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
              {ticked ? `${ticked.done}/${ticked.total}` : '· none written'}
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
        {tasks.length > 0 && (
          <table className="feature-row-tasks mt-0.5 border-collapse whitespace-normal text-left">
            {(total || hasCommit) && (
              <thead>
                <tr className="border-b border-nim">
                  <th className="py-0.5 font-normal">Status</th>
                  <th className="py-0.5 pl-4 font-normal">Task</th>
                  {total && ['Sessions', 'Tokens', 'Cost', 'Time'].map((h) => (
                    <th key={h} className={`${cell} font-normal`}>
                      {h}
                    </th>
                  ))}
                  {hasCommit && <th className="py-0.5 pl-4 font-normal">Commit</th>}
                </tr>
              </thead>
            )}
            <tbody>
              {sortTasks(tasks).map((task) => (
                <tr key={task.id} className="feature-row-task align-top">
                  <td className="py-0.5 whitespace-nowrap">{task.status.replace(/-/g, ' ')}</td>
                  <td className="py-0.5 pl-4 text-nim">
                    {task.title}
                    {task.tags.includes('blocked') && task.status !== 'done' && task.status !== 'wont-do' && (
                      <span className="text-nim-error"> blocked</span>
                    )}
                  </td>
                  {/* This Task's sessions alone; a Task that links none leaves its cells empty. */}
                  {total && (usageCells([task], usage) ?? ['', '', '', '']).map((value, i) => (
                    <td key={i} className={cell}>
                      {value}
                    </td>
                  ))}
                  {hasCommit && <td className="py-0.5 pl-4 font-mono whitespace-nowrap">{task.commit}</td>}
                </tr>
              ))}
            </tbody>
            {total && tasks.length > 1 && (
              // Each session once: a session two Tasks link is in both rows above, so the rows can add up to more.
              <tfoot>
                <tr className="feature-row-usage border-t border-nim font-medium text-nim">
                  <td className="py-0.5" colSpan={2}>
                    Total
                  </td>
                  {total.map((value, i) => (
                    <td key={i} className={cell}>
                      {value}
                    </td>
                  ))}
                  {hasCommit && <td />}
                </tr>
              </tfoot>
            )}
          </table>
        )}
      </div>
    </details>
  );
}
