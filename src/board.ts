import type { Feature } from './features';
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

/** The cache file's contents, or null when it is missing or not a cache. Entries without a key are dropped. */
export function parseJiraCache(text: string): JiraCache | null {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || !Array.isArray(raw.epics)) return null;
  return {
    fetchedAt: typeof raw.fetchedAt === 'string' ? raw.fetchedAt : '',
    epics: raw.epics
      .filter((e: any) => typeof e?.key === 'string' && e.key)
      .map((e: any): JiraEpic => ({
        key: e.key,
        title: typeof e.title === 'string' ? e.title : e.key,
        status: typeof e.status === 'string' ? e.status : '',
        labels: Array.isArray(e.labels) ? e.labels.filter((l: unknown) => typeof l === 'string') : [],
        openCards: Number(e.openCards) || 0,
        cardsInProgress: Number(e.cardsInProgress) || 0,
      })),
  };
}

export async function loadJiraCache(workspacePath: string): Promise<JiraCache | null> {
  const result = await window.electronAPI.invoke('read-file-content', `${workspacePath}/.features/jira-cache.json`);
  return result?.success ? parseJiraCache(result.content) : null;
}

export interface BoardRow {
  id: string;
  title: string;
  kind: string;
  /** Absent for an Epic that has no Feature file yet. */
  feature?: Feature;
  /** Absent when the Feature has no Epic, or the Epic is not in the cache. */
  epic?: JiraEpic;
  progress: TaskProgress;
  status: FeatureStatus;
  blocked: boolean;
  /**
   * The file lists MRs, whose state the board does not read yet, so the status
   * can be neither `done` nor `cancelled` and is only right while work is open.
   */
  mrStateUnknown: boolean;
}

const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id, undefined, { numeric: true });

/**
 * One row per Feature file, plus one per cached Epic that has no file, each
 * with its status from the rules table.
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
    const { status, blocked } = featureStatus({
      featureId: id,
      cancelled: epic?.labels.includes('rejected'),
      hasOpenCard: epic ? epic.openCards > 0 : undefined,
      inProgressInJira: epic ? epic.cardsInProgress > 0 || epic.status.toLowerCase() === 'in progress' : undefined,
      epicDone: epic ? epic.status.toLowerCase() === 'done' : undefined,
      hasWorktree: false,
      tasks: own,
      sessions: [],
      mrs: [],
    });
    const mrStateUnknown = (feature?.mrs.length ?? 0) > 0;
    return { id, title, kind, feature, epic, progress: taskProgress(own), status, blocked, mrStateUnknown };
  };

  const rows = features.map((feature) => {
    const epic = epics.get(feature.epic || feature.id);
    if (epic) withFile.add(epic.key);
    return row(feature.id, feature.title, feature.kind, feature, epic);
  });
  for (const epic of epics.values()) {
    if (!withFile.has(epic.key)) rows.push(row(epic.key, epic.title, '', undefined, epic));
  }
  return rows.sort(byId);
}

/** "5 min ago", "3 h ago", "2 d ago"; empty for a time that cannot be read. */
export function ago(iso: string, now: number): string {
  const minutes = Math.floor((now - Date.parse(iso)) / 60_000);
  if (Number.isNaN(minutes)) return '';
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)} h ago`;
  return `${Math.floor(minutes / (60 * 24))} d ago`;
}
