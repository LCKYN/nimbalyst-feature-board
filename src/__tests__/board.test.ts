import { describe, expect, it } from 'vitest';
import { boardRows, parseJiraCache, type JiraEpic } from '../board';
import type { Feature } from '../features';
import type { TaskFact } from '../featureStatus';

const feature = (over: Partial<Feature> = {}): Feature => ({
  id: 'RDHR-144',
  path: '/repo/.features/RDHR-144.md',
  title: 'Recruit on LINE',
  kind: 'feature',
  epic: 'RDHR-144',
  branch: '',
  relates: [],
  mrs: [],
  source: 'backfill',
  ...over,
});
const epic = (over: Partial<JiraEpic> = {}): JiraEpic => ({
  key: 'RDHR-144',
  title: 'Recruit on LINE',
  status: 'In Progress',
  labels: [],
  openCards: 0,
  cardsInProgress: 0,
  ...over,
});
const task = (status: string): TaskFact => ({ id: status, title: status, status, tags: [], updatedAt: 0 });
const cache = (...epics: JiraEpic[]) => ({ fetchedAt: '2026-11-12T08:00:00Z', epics });
const statusOf = (rows: ReturnType<typeof boardRows>) => Object.fromEntries(rows.map((r) => [r.id, r.status]));

describe('boardRows', () => {
  it('lists Feature files and Epics without a file, in key order, each Epic once', () => {
    const rows = boardRows(
      [feature()],
      new Map(),
      cache(epic({ key: 'RDHR-1000', title: 'Later' }), epic(), epic({ key: 'RDHR-20', title: 'Payroll' })),
    );
    expect(rows.map((r) => [r.id, r.title, Boolean(r.feature)])).toEqual([
      ['RDHR-20', 'Payroll', false],
      ['RDHR-144', 'Recruit on LINE', true],
      ['RDHR-1000', 'Later', false],
    ]);
  });

  it('takes done, in progress and cancelled from the Epic and its cards when there are no MRs', () => {
    const rows = boardRows(
      [],
      new Map(),
      cache(
        epic({ key: 'A-1', status: 'Done' }),
        epic({ key: 'A-2', status: 'Done', openCards: 1 }),
        epic({ key: 'A-3', status: 'To Do', openCards: 2, cardsInProgress: 1 }),
        epic({ key: 'A-4', status: 'To Do', openCards: 2 }),
        epic({ key: 'A-6' }),
        epic({ key: 'A-5', status: 'Done', labels: ['rejected'] }),
      ),
    );
    expect(statusOf(rows)).toEqual({
      'A-1': 'done',
      'A-2': 'todo',
      'A-3': 'in_progress',
      'A-4': 'todo',
      'A-5': 'cancelled',
      'A-6': 'in_progress',
    });
  });

  it('keeps a Feature with an open Task out of done even when its Epic is Done', () => {
    const tasks = new Map([['RDHR-144', [task('done'), task('in-review')]]]);
    const [row] = boardRows([feature()], tasks, cache(epic({ status: 'Done' })));
    expect(row.status).toBe('in_progress');
    expect(row.progress).toMatchObject({ total: 2, done: 1 });
  });

  it('works without a Jira cache and flags Features whose MR state is not read', () => {
    const [row] = boardRows([feature({ id: 'mr-1', epic: '', mrs: ['1'] })], new Map([['mr-1', [task('done')]]]), null);
    expect(row).toMatchObject({ status: 'in_progress', epic: undefined, mrStateUnknown: true });
  });
});

describe('parseJiraCache', () => {
  it('returns null for anything that is not a cache and drops entries without a key', () => {
    expect(parseJiraCache('not json')).toBeNull();
    expect(parseJiraCache('{"fetchedAt":"x"}')).toBeNull();
    expect(parseJiraCache('{"fetchedAt":"t","epics":[{"key":"A-1","status":"Done"},{"title":"no key"}]}')).toEqual({
      fetchedAt: 't',
      epics: [{ key: 'A-1', title: 'A-1', status: 'Done', labels: [], openCards: 0, cardsInProgress: 0 }],
    });
  });
});
