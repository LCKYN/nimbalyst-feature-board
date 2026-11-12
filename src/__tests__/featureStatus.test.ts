import { describe, expect, it } from 'vitest';
import {
  featureStatus,
  waitItems,
  type FeatureFacts,
  type MrFact,
  type SessionFact,
  type TaskFact,
} from '../featureStatus';

const task = (over: Partial<TaskFact> = {}): TaskFact => ({
  id: 't1',
  title: 'Build it',
  status: 'in-progress',
  tags: [],
  updatedAt: 10,
  ...over,
});
const session = (over: Partial<SessionFact> = {}): SessionFact => ({
  id: 's1',
  title: 'Session one',
  taskId: 't1',
  status: 'idle',
  hasPendingPrompt: false,
  updatedAt: 20,
  ...over,
});
const mr = (over: Partial<MrFact> = {}): MrFact => ({ id: '345', state: 'open', updatedAt: 30, ...over });
const facts = (over: Partial<FeatureFacts> = {}): FeatureFacts => ({
  featureId: 'issue-12',
  hasWorktree: false,
  tasks: [],
  sessions: [],
  mrs: [],
  ...over,
});

const status = (over: Partial<FeatureFacts>) => featureStatus(facts(over)).status;

describe('featureStatus', () => {
  it('checks the table top to bottom and stops at the first match', () => {
    // Every row below `cancelled` also matches here; each step removes the top match.
    const all: FeatureFacts = facts({
      cancelled: true,
      mrs: [mr({ state: 'merged' })],
      sessions: [session({ hasPendingPrompt: true })],
      tasks: [task()],
      hasWorktree: true,
    });
    expect(featureStatus(all).status).toBe('cancelled');

    const notCancelled = { ...all, cancelled: false };
    expect(featureStatus(notCancelled).status).toBe('done');

    const notDone = { ...notCancelled, mrs: [] };
    expect(featureStatus(notDone).status).toBe('awaiting_decision');

    const nothingWaiting = { ...notDone, sessions: [session()] };
    expect(featureStatus(nothingWaiting).status).toBe('in_progress');

    const noTaskRan = { ...nothingWaiting, tasks: [task({ status: 'to-do' })] };
    expect(featureStatus(noTaskRan).status).toBe('started');

    const noWorktree = { ...noTaskRan, hasWorktree: false };
    expect(featureStatus(noWorktree).status).toBe('consulting');

    expect(featureStatus({ ...noWorktree, sessions: [] }).status).toBe('todo');
  });

  it('is cancelled when every MR was closed unmerged, but not when one of them merged', () => {
    expect(status({ mrs: [mr({ state: 'closed' }), mr({ id: '346', state: 'closed' })] })).toBe('cancelled');
    expect(status({ mrs: [mr({ state: 'closed' }), mr({ id: '346', state: 'merged' })] })).toBe('todo');
  });

  it('is done only when every MR merged and no card is open', () => {
    const merged = [mr({ state: 'merged' }), mr({ id: '346', state: 'merged' })];
    expect(status({ mrs: merged })).toBe('done');
    expect(status({ mrs: merged, hasOpenCard: true })).toBe('todo');
    expect(status({ mrs: [merged[0], mr({ id: '346' })] })).toBe('todo');
    // A Task marked done does not finish a Feature that has no MR.
    expect(status({ tasks: [task({ status: 'done' })] })).toBe('in_progress');
  });

  it('awaits a decision for an unanswered session prompt or an open MR that waits for review', () => {
    expect(status({ sessions: [session({ hasPendingPrompt: true })] })).toBe('awaiting_decision');
    expect(status({ mrs: [mr({ awaitsReview: true })] })).toBe('awaiting_decision');
  });

  it('counts a Task as run once it has left to-do, and wont-do never ran', () => {
    for (const ran of ['in-progress', 'in-review', 'done']) {
      expect(status({ tasks: [task({ status: ran })] })).toBe('in_progress');
    }
    expect(status({ tasks: [task({ status: 'wont-do' })] })).toBe('todo');
  });

  it('flags an in-progress Feature as stalled when nothing runs and nothing is in the way', () => {
    const idle = facts({ tasks: [task()], sessions: [session()] });
    expect(featureStatus(idle)).toEqual({ status: 'in_progress', stalled: true, blocked: false });
    expect(featureStatus({ ...idle, sessions: [session({ status: 'running' })] })).toEqual({
      status: 'in_progress',
      stalled: false,
      blocked: false,
    });
  });

  it('flags an in-progress Feature as blocked for a blocked Task, failed CI or an errored session', () => {
    const blocked = { status: 'in_progress', stalled: false, blocked: true };
    expect(featureStatus(facts({ tasks: [task({ tags: ['blocked'] })] }))).toEqual(blocked);
    expect(featureStatus(facts({ tasks: [task()], mrs: [mr({ ciFailed: true })] }))).toEqual(blocked);
    expect(featureStatus(facts({ tasks: [task()], sessions: [session({ status: 'error' })] }))).toEqual(blocked);
  });

  it('raises no flag outside in_progress', () => {
    const waiting = facts({ tasks: [task({ tags: ['blocked'] })], sessions: [session({ hasPendingPrompt: true })] });
    expect(featureStatus(waiting)).toEqual({ status: 'awaiting_decision', stalled: false, blocked: false });
    expect(featureStatus(facts())).toEqual({ status: 'todo', stalled: false, blocked: false });
  });
});

describe('waitItems', () => {
  it('splits what needs an answer from what is stuck, each pointing at its source', () => {
    const lists = waitItems(
      facts({
        tasks: [task({ id: 't2', title: 'Wire the API', tags: ['blocked'] }), task()],
        sessions: [
          session({ hasPendingPrompt: true }),
          session({ id: 's2', title: 'Session two', taskId: 't2', status: 'error' }),
          session({ id: 's3' }),
        ],
        mrs: [mr({ title: 'Export PDF', awaitsReview: true }), mr({ id: '346', ciFailed: true })],
      }),
    );

    expect(lists.waiting).toEqual([
      { featureId: 'issue-12', kind: 'decision', title: 'Session one', openedAt: 20, sessionId: 's1', taskId: 't1' },
      { featureId: 'issue-12', kind: 'review', title: 'Export PDF', openedAt: 30, mrId: '345' },
    ]);
    expect(lists.stuck).toEqual([
      { featureId: 'issue-12', kind: 'blocked', title: 'Wire the API', openedAt: 10, taskId: 't2' },
      { featureId: 'issue-12', kind: 'ci_failed', title: '!346', openedAt: 30, mrId: '346' },
      { featureId: 'issue-12', kind: 'session_error', title: 'Session two', openedAt: 20, sessionId: 's2', taskId: 't2' },
    ]);
  });

  it('ignores review and CI state on an MR that is no longer open', () => {
    const closed = facts({ mrs: [mr({ state: 'merged', awaitsReview: true, ciFailed: true })] });
    expect(waitItems(closed)).toEqual({ waiting: [], stuck: [] });
  });
});
