import { loadFeatures, loadSessions, loadTasks, type Feature } from './features';
import {
  featureStatus,
  STATUS_LABEL,
  taskProgress,
  waitItems,
  type FeatureFacts,
  type FeatureStatus,
  type SessionFact,
  type TaskFact,
  type TaskProgress,
  type WaitItem,
} from './featureStatus';

/**
 * One Epic in `.features/jira-cache.json`. The board has no Jira login: the
 * feature-* and card-* skills write that file ("Jira cache" in
 * `~/.claude/feature-rules.md`) and the board only reads it.
 */
export interface JiraEpic {
  key: string;
  title: string;
  /** To Do | In Progress | Done */
  status: string;
  labels: string[];
  /** Cards (Task or Bug) under the Epic that are not Done. */
  openCards: number;
  cardsInProgress: number;
  /** The Epic's Jira due date (`2026-12-15`), empty when it has none or the cache was written without it. */
  due: string;
}

export interface JiraCache {
  /** ISO time of the Jira read; everything in the file is that old. */
  fetchedAt: string;
  epics: JiraEpic[];
}

/**
 * The cache file's contents; throws with the reason when the text is not a
 * cache. Entries without a key are dropped. An entry without a status or a
 * card count makes the whole cache invalid: the rules forbid a partial write,
 * and a missing count read as 0 would pass for "no open card". `due` is
 * optional: Jira has none for most Epics, and older caches never carry it.
 */
export function parseJiraCache(text: string): JiraCache {
  const raw = JSON.parse(text);
  if (!raw || !Array.isArray(raw.epics)) throw new Error('it has no "epics" list');
  const need = (e: any, field: string, type: string) => {
    if (typeof e[field] !== type) throw new Error(`${e.key} has no ${field}`);
    return e[field];
  };
  const count = (e: any, field: string) => Math.max(0, Math.trunc(need(e, field, 'number')));
  return {
    fetchedAt: typeof raw.fetchedAt === 'string' ? raw.fetchedAt : '',
    epics: raw.epics
      .filter((e: any) => typeof e?.key === 'string' && e.key)
      .map((e: any): JiraEpic => ({
        key: e.key,
        title: typeof e.title === 'string' ? e.title : e.key,
        status: need(e, 'status', 'string'),
        labels: Array.isArray(e.labels) ? e.labels.filter((l: unknown) => typeof l === 'string') : [],
        openCards: count(e, 'openCards'),
        cardsInProgress: count(e, 'cardsInProgress'),
        due: typeof e.due === 'string' ? e.due : '',
      })),
  };
}

export interface JiraRead {
  /** Null when there is no cache file, and when there is one that could not be read. */
  cache: JiraCache | null;
  /** Why the file that is there could not be read. Absent when the file is absent, which is not an error. */
  error?: string;
}

/** The cache from the host's reply to reading its file. The host answers `null` for a file that does not exist. */
export function readJiraCache(result: { success?: boolean; content?: string; error?: string } | null | undefined): JiraRead {
  if (result == null) return { cache: null };
  try {
    if (!result.success) throw new Error(result.error || 'the read failed');
    return { cache: parseJiraCache(result.content ?? '') };
  } catch (e) {
    return { cache: null, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function loadJiraCache(workspacePath: string): Promise<JiraRead> {
  const read = readJiraCache(
    await window.electronAPI.invoke('read-file-content', `${workspacePath}/.features/jira-cache.json`),
  );
  if (read.error) console.warn('[feature-board] jira-cache.json could not be read:', read.error);
  return read;
}

/**
 * The Jira site (`https://<site>`) from the `Jira project: KEY (<board URL>)`
 * line of a repo's CLAUDE.md, or empty when the line has no https URL.
 */
export const jiraSite = (claudeMd: string) => /^Jira project:.*\((https:\/\/[^/)\s]+)/m.exec(claudeMd)?.[1] ?? '';

/**
 * The Epic's page in Jira, or empty when the site is not known or the key does
 * not look like one. Both parts come from files and the link opens in the
 * system browser, so neither is passed on unchecked.
 */
export const epicUrl = (site: string, key: string | undefined) =>
  site && key && /^[A-Z][A-Z0-9]*-\d+$/.test(key) ? `${site}/browse/${key}` : '';

/** True for the host's `file-changed-on-disk` event (`{ path }`) when the file is inside a `.features/` folder. */
export const touchesFeatures = (event: unknown) => {
  const path = (event as { path?: unknown } | undefined)?.path;
  return typeof path === 'string' && /[\\/]\.features[\\/]/.test(path);
};

/** True for the content of a linked worktree's `.git` file (`gitdir: <main checkout>/.git/worktrees/<name>`). */
export const isWorktreeGitFile = (content: string) => /^gitdir:.*[\\/]worktrees[\\/]/.test(content);

export interface Board {
  features: Feature[];
  tasks: Map<string, TaskFact[]>;
  /** The sessions linked to each Feature's Tasks, by Feature id. */
  sessions: Map<string, SessionFact[]>;
  jira: JiraCache | null;
  /** Why a `jira-cache.json` is there but could not be read. */
  jiraError: string | undefined;
  /** `https://<site>` of the repo's Jira, empty when no CLAUDE.md names it. */
  jiraSite: string;
  /** A `.features/` listing came back at the host's cap, so Feature files may be missing. */
  truncated: boolean;
  /** No cache was found and the workspace is a linked worktree: the cache and the Tasks are with the main checkout. */
  worktree: boolean;
}

/**
 * Everything the board shows. Feature files and the Jira cache are read from
 * every folder of the workspace (`folders`, primary root first); Tasks and
 * sessions hang on the primary root.
 *
 * ponytail: ids are taken to be unique across the folders, and the oldest
 * `fetchedAt` dates every Epic. Key rows by folder and id if two enrolled
 * repos are ever attached to one workspace.
 */
export async function loadBoard(folders: string[]): Promise<Board> {
  const [lists, tasks, reads, claudeMds] = await Promise.all([
    Promise.all(folders.map(loadFeatures)),
    loadTasks(folders[0]),
    Promise.all(folders.map(loadJiraCache)),
    Promise.all(folders.map((folder) => window.electronAPI.invoke('read-file-content', `${folder}/CLAUDE.md`))),
  ]);
  const sessions = await loadSessions(folders[0], tasks);
  const features = lists.flatMap((l) => l.features);
  const caches = reads.flatMap((r) => r.cache ?? []);
  const jira = caches.length > 0
    ? { fetchedAt: caches.map((c) => c.fetchedAt).sort()[0], epics: caches.flatMap((c) => c.epics) }
    : null;
  const jiraError = reads.find((r) => r.error)?.error;
  // Asked only when a Feature names an Epic and no cache was found: in a main
  // checkout `.git` is a folder, and the host logs each failed read of it.
  const git =
    !jira && !jiraError && features.some((f) => f.epic)
      ? await window.electronAPI.invoke('read-file-content', `${folders[0]}/.git`)
      : null;
  return {
    features,
    tasks,
    sessions,
    jira,
    jiraError,
    // ponytail: one site for the whole workspace, the first one found.
    jiraSite: claudeMds.map((md) => (md?.success ? jiraSite(md.content) : '')).find(Boolean) ?? '',
    truncated: lists.some((l) => l.truncated),
    worktree: Boolean(git?.success && isWorktreeGitFile(git.content)),
  };
}

export interface BoardRow {
  id: string;
  title: string;
  /** Absent for an Epic, or for Tasks, with no Feature file in this checkout. */
  feature?: Feature;
  /** Absent when the Feature has no Epic, or the Epic is not in the cache. */
  epic?: JiraEpic;
  /** The Tasks that name this row's id. */
  tasks: TaskFact[];
  progress: TaskProgress;
  /** The computed status, or the one the user set by hand on the board. */
  status: FeatureStatus;
  /** `status` was set by hand. `blocked`, `stalled` and the wait lists stay computed. */
  handSet: boolean;
  blocked: boolean;
  stalled: boolean;
  /** When it is due: the file's `target` when it has one, else the Epic's due date. Empty when neither. */
  target: string;
  /** What needs an answer from the user, and what cannot move on its own. */
  waiting: WaitItem[];
  stuck: WaitItem[];
  /**
   * The file lists MRs, whose state the board does not read yet. Such a row is
   * never `done` (a Done Epic does not stand in for the MRs, nor for an `mrs`
   * key that is still empty) and its status is only right while work is open;
   * `cancelled` still comes from the `rejected` label.
   */
  mrStateUnknown: boolean;
  /**
   * Set when `status` was computed (not set by hand) without a fact it needs, so the board says
   * "unknown" in its place: the Feature names an Epic the cache does not hold,
   * or it lists MRs and nothing open (Task, card, Jira In Progress, a session's question) explains its status.
   */
  unknown?: 'Jira not read' | 'MR state not read';
}

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id, undefined, { numeric: true });

/**
 * One row per Feature file, plus one per cached Epic that has no file and one
 * per Task `featureId` that matches neither, each with its status from the
 * rules table.
 *
 * ponytail: worktrees and MR state are not read yet, so a row is never
 * `started` (it reads `consulting` or `todo`) and an MR never makes one
 * `awaiting_decision`, `cancelled` or blocked. A worktree for `branch` is not
 * in the host's `worktree:list`, which knows only the worktrees Nimbalyst made;
 * it takes `git worktree list` through `host.exec`, and so the `filesystem`
 * permission, which lets this read-only panel run shell commands. That is the
 * owner's decision. Pass both facts in here once the board gathers them.
 *
 * `overrides` holds the statuses the user set by hand, by row id. They come
 * from the board's own storage, never from the file, and are not trusted: a
 * value that is no status is ignored.
 */
export function boardRows(
  features: Feature[],
  tasks: Map<string, TaskFact[]>,
  cache: JiraCache | null,
  sessions: Map<string, SessionFact[]> = new Map(),
  overrides: Record<string, string> = {},
): BoardRow[] {
  const epics = new Map((cache?.epics ?? []).map((e) => [e.key, e]));
  const withFile = new Set<string>();

  const row = (id: string, title: string, feature?: Feature, epic?: JiraEpic): BoardRow => {
    const own = tasks.get(id) ?? [];
    const progress = taskProgress(own);
    const mrStateUnknown = (feature?.mrs.length ?? 0) > 0;
    const jiraStatus = epic?.status.trim().toLowerCase();
    const hasOpenCard = epic ? epic.openCards > 0 : undefined;
    const inProgressInJira = epic ? epic.cardsInProgress > 0 || jiraStatus === 'in progress' : undefined;
    const facts: FeatureFacts = {
      featureId: id,
      // `rejected` is one of the fixed Jira labels; "Labels" in `~/.claude/card-rules.md` owns the name.
      cancelled: epic?.labels.includes('rejected'),
      hasOpenCard,
      inProgressInJira,
      // The Epic decides "shipped" only in a no-MR repo, whose files have no `mrs` key. With the key the MRs
      // decide: their state is not read, and an empty list has not shipped.
      epicDone: epic && !feature?.hasMrsKey ? jiraStatus === 'done' : undefined,
      hasWorktree: false,
      tasks: own,
      sessions: sessions.get(id) ?? [],
      mrs: [],
    };
    const { status: computed, blocked, stalled } = featureStatus(facts);
    const handSet = Object.hasOwn(overrides, id) && Object.hasOwn(STATUS_LABEL, overrides[id]);
    const status = handSet ? (overrides[id] as FeatureStatus) : computed;
    const { waiting, stuck } = waitItems(facts);
    const explained =
      status === 'cancelled' ||
      progress.total > progress.done ||
      hasOpenCard ||
      inProgressInJira ||
      waiting.length > 0;
    const unknown = handSet
      ? undefined
      : feature?.epic && !epic
        ? 'Jira not read'
        : mrStateUnknown && !explained
          ? 'MR state not read'
          : undefined;
    return {
      id,
      title,
      feature,
      epic,
      tasks: own,
      progress,
      status,
      handSet,
      blocked,
      stalled,
      target: feature?.target || epic?.due || '',
      waiting,
      stuck,
      mrStateUnknown,
      unknown,
    };
  };

  const rows = features.map((feature) => {
    // In a Jira repo the file name is the Epic key; `epic:` only finds the Epic of a draft-* file.
    const epic = epics.get(feature.id) ?? epics.get(feature.epic);
    if (epic) withFile.add(epic.key);
    return row(feature.id, feature.title, feature, epic);
  });
  for (const epic of epics.values()) {
    if (!withFile.has(epic.key)) rows.push(row(epic.key, epic.title, undefined, epic));
  }
  // Tasks that name no row above (a renamed file, a file on another branch) must not vanish.
  const placed = new Set(rows.map((r) => r.id));
  for (const id of tasks.keys()) {
    if (!placed.has(id)) rows.push(row(id, id));
  }
  return rows.sort(byId);
}

/**
 * Whether a row has every word of `query` somewhere in its title, id, kind,
 * labels, Jira status or the status the board shows for it. An empty query
 * matches every row.
 *
 * ponytail: plain substrings, so a title that contains a label word ("Demo
 * mode") is found by `demo` too. Offer the labels as an exact-match list if
 * that ever gives a wrong hit.
 */
export function matches(row: BoardRow, query: string): boolean {
  const text = [
    row.title,
    row.id,
    row.feature?.kind,
    ...(row.epic?.labels ?? []),
    row.epic?.status,
    row.unknown ? 'unknown' : STATUS_LABEL[row.status],
  ]
    .join(' ')
    .toLowerCase();
  return query.toLowerCase().split(/\s+/).every((word) => text.includes(word));
}

/** `YYYY-MM-DD` on the local wall clock. Not `toISOString`, which is UTC and runs hours behind east of Greenwich. */
export const localDate = (d: Date) =>
  [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, '0')).join('-');

/**
 * A target that is a date (`YYYY-MM-DD`) before `today` (the local date), on a
 * row that is not done or cancelled. A milestone name is never overdue.
 */
export const isOverdue = (row: BoardRow, today: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(row.target) && row.target < today && row.status !== 'done' && row.status !== 'cancelled';

/** A Jira read older than a day, or at a time `ago()` cannot tell, may no longer match Jira. */
export function isStale(iso: string, now: number): boolean {
  const age = now - Date.parse(iso);
  return !(age >= -60_000 && age < 24 * 60 * 60_000);
}

/**
 * "5 min ago", "3 h ago", "2 d ago" for an ISO time or one in milliseconds;
 * empty for a time that cannot be read, is 0, or is more than a minute ahead of `now`.
 */
export function ago(time: string | number, now: number): string {
  const at = typeof time === 'number' ? time : Date.parse(time);
  const minutes = Math.floor((now - at) / 60_000);
  if (!at || minutes < -1) return '';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} h ago`;
  return `${Math.floor(minutes / (60 * 24))} d ago`;
}
