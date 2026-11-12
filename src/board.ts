import { loadFeatures, loadTasks, type Feature } from './features';
import { featureStatus, taskProgress, type FeatureStatus, type TaskFact, type TaskProgress } from './featureStatus';

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
 * and a missing count read as 0 would pass for "no open card".
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
        status: need(e, 'status', 'string').trim(),
        labels: Array.isArray(e.labels) ? e.labels.filter((l: unknown) => typeof l === 'string') : [],
        openCards: count(e, 'openCards'),
        cardsInProgress: count(e, 'cardsInProgress'),
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

/** True for the content of a linked worktree's `.git` file (`gitdir: <main checkout>/.git/worktrees/<name>`). */
export const isWorktreeGitFile = (content: string) => /^gitdir:.*[\\/]worktrees[\\/]/.test(content);

export interface Board {
  features: Feature[];
  tasks: Map<string, TaskFact[]>;
  jira: JiraCache | null;
  /** Why a `jira-cache.json` is there but could not be read. */
  jiraError: string | undefined;
  /** A `.features/` listing came back at the host's cap, so Feature files may be missing. */
  truncated: boolean;
  /** No cache was found and the workspace is a linked worktree: the cache and the Tasks are with the main checkout. */
  worktree: boolean;
}

/**
 * Everything the board shows. Feature files and the Jira cache are read from
 * every folder of the workspace (`folders`, primary root first); Tasks hang on
 * the primary root.
 *
 * ponytail: ids are taken to be unique across the folders, and the oldest
 * `fetchedAt` dates every Epic. Key rows by folder and id if two enrolled
 * repos are ever attached to one workspace.
 */
export async function loadBoard(folders: string[]): Promise<Board> {
  const [lists, tasks, reads] = await Promise.all([
    Promise.all(folders.map(loadFeatures)),
    loadTasks(folders[0]),
    Promise.all(folders.map(loadJiraCache)),
  ]);
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
    jira,
    jiraError,
    truncated: lists.some((l) => l.truncated),
    worktree: Boolean(git?.success && isWorktreeGitFile(git.content)),
  };
}

export interface BoardRow {
  id: string;
  title: string;
  kind: string;
  /** Absent for an Epic, or for Tasks, with no Feature file in this checkout. */
  feature?: Feature;
  /** Absent when the Feature has no Epic, or the Epic is not in the cache. */
  epic?: JiraEpic;
  progress: TaskProgress;
  status: FeatureStatus;
  blocked: boolean;
  /**
   * The file lists MRs, whose state the board does not read yet. Such a row is
   * never `done` (a Done Epic does not stand in for the MRs) and its status is
   * only right while work is open; `cancelled` still comes from the `rejected` label.
   */
  mrStateUnknown: boolean;
  /**
   * Set when `status` was computed without a fact it needs, so the board says
   * "unknown" in its place: the Feature names an Epic the cache does not hold,
   * or it lists MRs and nothing open (Task, card, Jira In Progress) explains its status.
   */
  unknown?: 'Jira not read' | 'MR state not read';
}

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id, undefined, { numeric: true });

/**
 * One row per Feature file, plus one per cached Epic that has no file and one
 * per Task `featureId` that matches neither, each with its status from the
 * rules table.
 *
 * ponytail: sessions, worktrees and MR state are not read yet, so a row is
 * never `awaiting_decision`, `consulting` or `started`, and the `stalled` flag
 * is left out. Pass those facts in here once the board gathers them.
 */
export function boardRows(features: Feature[], tasks: Map<string, TaskFact[]>, cache: JiraCache | null): BoardRow[] {
  const epics = new Map((cache?.epics ?? []).map((e) => [e.key, e]));
  const withFile = new Set<string>();

  const row = (id: string, title: string, kind: string, feature?: Feature, epic?: JiraEpic): BoardRow => {
    const own = tasks.get(id) ?? [];
    const progress = taskProgress(own);
    const mrStateUnknown = (feature?.mrs.length ?? 0) > 0;
    const jiraStatus = epic?.status.trim().toLowerCase();
    const hasOpenCard = epic ? epic.openCards > 0 : undefined;
    const inProgressInJira = epic ? epic.cardsInProgress > 0 || jiraStatus === 'in progress' : undefined;
    const { status, blocked } = featureStatus({
      featureId: id,
      cancelled: epic?.labels.includes('rejected'),
      hasOpenCard,
      inProgressInJira,
      // The Epic decides "shipped" only for a Feature without MRs; with MRs their state does, and it is not read.
      epicDone: epic && !mrStateUnknown ? jiraStatus === 'done' : undefined,
      hasWorktree: false,
      tasks: own,
      sessions: [],
      mrs: [],
    });
    const explained = status === 'cancelled' || progress.total > progress.done || hasOpenCard || inProgressInJira;
    const unknown =
      feature?.epic && !epic ? 'Jira not read' : mrStateUnknown && !explained ? 'MR state not read' : undefined;
    return { id, title, kind, feature, epic, progress, status, blocked, mrStateUnknown, unknown };
  };

  const rows = features.map((feature) => {
    // In a Jira repo the file name is the Epic key; `epic:` only finds the Epic of a draft-* file.
    const epic = epics.get(feature.id) ?? epics.get(feature.epic);
    if (epic) withFile.add(epic.key);
    return row(feature.id, feature.title, feature.kind, feature, epic);
  });
  for (const epic of epics.values()) {
    if (!withFile.has(epic.key)) rows.push(row(epic.key, epic.title, '', undefined, epic));
  }
  // Tasks that name no row above (a renamed file, a file on another branch) must not vanish.
  const placed = new Set(rows.map((r) => r.id));
  for (const id of tasks.keys()) {
    if (!placed.has(id)) rows.push(row(id, id, ''));
  }
  return rows.sort(byId);
}

/** A Jira read older than a day, or at a time `ago()` cannot tell, may no longer match Jira. */
export function isStale(iso: string, now: number): boolean {
  const age = now - Date.parse(iso);
  return !(age >= -60_000 && age < 24 * 60 * 60_000);
}

/** "5 min ago", "3 h ago", "2 d ago"; empty for a time that cannot be read or is more than a minute ahead of `now`. */
export function ago(iso: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (Number.isNaN(minutes) || minutes < -1) return '';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} h ago`;
  return `${Math.floor(minutes / (60 * 24))} d ago`;
}
