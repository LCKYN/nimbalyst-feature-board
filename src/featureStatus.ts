/**
 * A Feature's status and wait lists, computed from facts and never stored.
 * This is the table "Status is computed, never stored" in
 * `~/.claude/feature-rules.md`; change a rule there first, then here.
 *
 * Everything here is pure: the caller gathers the facts (tracker items,
 * sessions, worktree, MR state) and the same facts always give the same answer.
 */

export type FeatureStatus =
  | 'cancelled'
  | 'done'
  | 'awaiting_decision'
  | 'in_progress'
  | 'started'
  | 'consulting'
  | 'todo';

export const STATUS_LABEL: Record<FeatureStatus, string> = {
  cancelled: 'ยกเลิก',
  done: 'เสร็จแล้ว',
  awaiting_decision: 'รอตัดสินใจ',
  in_progress: 'กำลังทำ',
  started: 'เริ่มทำ',
  consulting: 'ปรึกษา',
  todo: 'จะทำ',
};

/** A `feature-task` tracker item. */
export interface TaskFact {
  id: string;
  title: string;
  /** to-do | in-progress | in-review | done | wont-do */
  status: string;
  tags: string[];
  updatedAt: number;
  /** Ids of the AI sessions linked to the Task, as the tracker item lists them. */
  linkedSessions?: string[];
  /**
   * Short sha of the commit the host last linked to the Task: one a linked
   * session made, or one whose message names the Task. Empty when there is none.
   */
  commit?: string;
}

/** An AI session attributed to the Feature. */
export interface SessionFact {
  id: string;
  title: string;
  taskId?: string;
  /** idle | running | waiting_for_input | error */
  status: string;
  /** The session asked something (a question or a permission) nobody answered yet. */
  hasPendingPrompt: boolean;
  updatedAt: number;
}

/** One MR/PR listed in the Feature's `mrs`. */
export interface MrFact {
  id: string;
  title?: string;
  /** `closed` means closed without merging. */
  state: 'open' | 'merged' | 'closed';
  awaitsReview?: boolean;
  ciFailed?: boolean;
  updatedAt: number;
}

export interface FeatureFacts {
  featureId: string;
  /** The user cancelled the Feature. */
  cancelled?: boolean;
  /** A card (Jira Task or Bug under the Feature's Epic) is still open. */
  hasOpenCard?: boolean;
  /** The Epic, or a card under it, is In Progress in Jira. */
  inProgressInJira?: boolean;
  /**
   * The Feature's Epic is Done. It decides "shipped" only when `mrs` is empty (a no-MR repo), so a caller
   * that knows the Feature has MRs but cannot read their state must leave this undefined.
   */
  epicDone?: boolean;
  /** A worktree for the Feature's `branch` exists. */
  hasWorktree: boolean;
  tasks: TaskFact[];
  sessions: SessionFact[];
  mrs: MrFact[];
}

export interface WaitItem {
  featureId: string;
  kind: 'decision' | 'review' | 'ci_failed' | 'session_error' | 'blocked';
  title: string;
  /** When the thing it points at last changed, which is the closest we have to "waiting since". */
  openedAt: number;
  taskId?: string;
  sessionId?: string;
  mrId?: string;
}

export interface WaitLists {
  /** Needs an answer from the user: an unanswered session prompt, an MR to review. */
  waiting: WaitItem[];
  /** Cannot move on its own: a blocked Task, failed CI, an errored session. */
  stuck: WaitItem[];
}

/** An open Task is one whose status is not `done` or `wont-do`. */
const isOpen = (t: TaskFact) => t.status !== 'done' && t.status !== 'wont-do';

/**
 * What the Feature is waiting on, read from session, MR and Task state, so a
 * session that never reports it is waiting still shows up.
 */
export function waitItems(facts: FeatureFacts): WaitLists {
  const { featureId } = facts;
  const openMrs = facts.mrs.filter((mr) => mr.state === 'open');
  const ofSession = (kind: WaitItem['kind']) => (s: SessionFact): WaitItem => ({
    featureId,
    kind,
    title: s.title,
    openedAt: s.updatedAt,
    sessionId: s.id,
    taskId: s.taskId,
  });
  const ofMr = (kind: WaitItem['kind']) => (mr: MrFact): WaitItem => ({
    featureId,
    kind,
    title: mr.title ?? `!${mr.id}`,
    openedAt: mr.updatedAt,
    mrId: mr.id,
  });

  return {
    waiting: [
      ...facts.sessions.filter((s) => s.hasPendingPrompt).map(ofSession('decision')),
      ...openMrs.filter((mr) => mr.awaitsReview).map(ofMr('review')),
    ],
    stuck: [
      ...facts.tasks
        .filter((t) => isOpen(t) && t.tags.includes('blocked'))
        .map((t): WaitItem => ({ featureId, kind: 'blocked', title: t.title, openedAt: t.updatedAt, taskId: t.id })),
      ...openMrs.filter((mr) => mr.ciFailed).map(ofMr('ci_failed')),
      ...facts.sessions.filter((s) => s.status === 'error').map(ofSession('session_error')),
    ],
  };
}

export interface TaskProgress {
  /** Every Task except the `wont-do` ones, which count nowhere. */
  total: number;
  done: number;
  inReview: number;
  inProgress: number;
  todo: number;
  /** Tasks whose status is none of the five above. They count as open, and not as "to do". */
  other: number;
}

/** How far a Feature's Tasks are. Only `done` counts as done: a Task in review is still open. */
export function taskProgress(tasks: TaskFact[]): TaskProgress {
  const count = (status: string) => tasks.filter((t) => t.status === status).length;
  const total = tasks.length - count('wont-do');
  const done = count('done');
  const inReview = count('in-review');
  const inProgress = count('in-progress');
  const todo = count('to-do');
  return { total, done, inReview, inProgress, todo, other: total - done - inReview - inProgress - todo };
}

/** The order work moves in. A status that is not listed sorts after `to-do`: it is open, and nobody knows how far. */
const TASK_ORDER = ['in-progress', 'in-review', 'to-do', '', 'done', 'wont-do'];

/** A Feature's Tasks for reading: the open blocked ones first, then by status in the order work moves. */
export function sortTasks(tasks: TaskFact[]): TaskFact[] {
  const rank = (t: TaskFact) =>
    isOpen(t) && t.tags.includes('blocked') ? -1 : TASK_ORDER.indexOf(TASK_ORDER.includes(t.status) ? t.status : '');
  return [...tasks].sort((a, b) => rank(a) - rank(b));
}

/** Task statuses that mean the Task was picked up at some point. */
const RAN = new Set(['in-progress', 'in-review', 'done']);

export interface ComputedStatus {
  status: FeatureStatus;
  /** `in_progress` only: nothing is running and nothing explains why. */
  stalled: boolean;
  /** `in_progress` only: something in the stuck list is in the way. */
  blocked: boolean;
}

/** The status table, checked top to bottom; the first match wins. */
export function featureStatus(facts: FeatureFacts): ComputedStatus {
  const { waiting, stuck } = waitItems(facts);
  // `every` is true for an empty list, and a Feature with no MR is neither cancelled nor done.
  const everyMr = (state: MrFact['state']) => facts.mrs.length > 0 && facts.mrs.every((mr) => mr.state === state);

  const shipped = facts.mrs.length > 0 ? everyMr('merged') : facts.epicDone === true;
  const hasOpenTask = facts.tasks.some(isOpen);

  const status: FeatureStatus =
    facts.cancelled || everyMr('closed')
      ? 'cancelled'
      : shipped && !hasOpenTask && !facts.hasOpenCard
        ? 'done'
        : waiting.length > 0
          ? 'awaiting_decision'
          : facts.tasks.some((t) => RAN.has(t.status)) || facts.inProgressInJira
            ? 'in_progress'
            : facts.hasWorktree
              ? 'started'
              : facts.sessions.length > 0
                ? 'consulting'
                : 'todo';

  const blocked = status === 'in_progress' && stuck.length > 0;
  // ponytail: no clock, so a Feature counts as stalled the moment its last
  // session goes idle. Pass `now` and compare it to `updatedAt` if the flag
  // turns out to flicker on the board.
  const stalled =
    status === 'in_progress' &&
    !blocked &&
    facts.tasks.length > 0 &&
    !facts.sessions.some((s) => s.status === 'running');
  return { status, stalled, blocked };
}
