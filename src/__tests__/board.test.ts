import { describe, expect, it } from 'vitest';
import { boardRows, parseJiraCache, readJiraCache, type JiraEpic } from '../board';
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

  it('says unknown for a Feature that lists MRs when nothing open explains its status', () => {
    const mrOnly = feature({ id: 'mr-1', epic: '', mrs: ['345'] });
    // No Epic and no Tasks, or every Task done: the MRs alone decide, and they are not read.
    expect(boardRows([mrOnly], new Map(), null)[0]).toMatchObject({ unknown: 'MR state not read', epic: undefined });
    expect(boardRows([mrOnly], new Map([['mr-1', [task('done')]]]), null)[0].unknown).toBe('MR state not read');
    // card-do moves the Epic to Done while the MR is only opened, so the Epic alone is never `done`.
    const [shipped] = boardRows([feature({ mrs: ['345'] })], new Map(), cache(epic({ status: 'Done' })));
    expect(shipped.status).not.toBe('done');
    expect(shipped.unknown).toBe('MR state not read');
  });

  it('keeps the computed status of a Feature that lists MRs while work is open, and cancelled from the label', () => {
    const mrOnly = feature({ id: 'mr-1', epic: '', mrs: ['345'] });
    const openTask = boardRows([mrOnly], new Map([['mr-1', [task('to-do')]]]), null)[0];
    expect(openTask).toMatchObject({ status: 'todo', mrStateUnknown: true });
    expect(openTask.unknown).toBeUndefined();

    const withMrs = feature({ mrs: ['345'] });
    const statusWith = (e: JiraEpic) => {
      const [row] = boardRows([withMrs], new Map(), cache(e));
      return [row.status, row.unknown];
    };
    expect(statusWith(epic())).toEqual(['in_progress', undefined]);
    expect(statusWith(epic({ status: 'Done', openCards: 1 }))).toEqual(['todo', undefined]);
    expect(statusWith(epic({ status: 'Done', labels: ['rejected'] }))).toEqual(['cancelled', undefined]);
  });

  it('gives Tasks whose featureId matches no Feature file or Epic a row of their own', () => {
    const rows = boardRows([], new Map([['mr-1', [task('to-do')]]]), null);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: 'mr-1', title: 'mr-1', feature: undefined, progress: { total: 1 } });

    // The rename draft-<slug>.md -> Epic key leaves the Tasks on the old id.
    const renamed = boardRows(
      [feature({ id: 'RDHR-200', epic: 'RDHR-200' })],
      new Map([['draft-qr', [task('in-progress')]]]),
      cache(epic({ key: 'RDHR-200', status: 'Done' })),
    );
    expect(renamed.map((r) => [r.id, r.status, r.progress.total])).toEqual([
      ['draft-qr', 'in_progress', 1],
      ['RDHR-200', 'done', 0],
    ]);
  });

  it('says unknown instead of computing without Jira when the Feature names an Epic the cache does not hold', () => {
    const named = feature({ id: 'ISF-99', epic: 'ISF-99' });
    expect(boardRows([named], new Map(), cache(epic()))[0]).toMatchObject({ unknown: 'Jira not read', epic: undefined });
    expect(boardRows([named], new Map(), null)[0].unknown).toBe('Jira not read');
    expect(boardRows([{ ...named, epic: '' }], new Map(), cache(epic()))[0].unknown).toBeUndefined();
    expect(boardRows([feature()], new Map(), cache(epic()))[0].unknown).toBeUndefined();
  });
});

describe('parseJiraCache', () => {
  it('throws for anything that is not a cache and drops entries without a key', () => {
    expect(() => parseJiraCache('not json')).toThrow();
    expect(() => parseJiraCache('{"fetchedAt":"x"}')).toThrow('epics');
    expect(parseJiraCache('{"fetchedAt":"t","epics":[{"key":"A-1","status":"Done"},{"title":"no key"}]}')).toEqual({
      fetchedAt: 't',
      epics: [{ key: 'A-1', title: 'A-1', status: 'Done', labels: [], openCards: 0, cardsInProgress: 0 }],
    });
  });
});

describe('readJiraCache', () => {
  it('tells a cache that could not be read from one that is not there', () => {
    // The host answers null for a file that does not exist: no cache, and not an error.
    expect(readJiraCache(null)).toEqual({ cache: null });
    expect(readJiraCache({ success: true, content: '{"epics": [' }).error).toBeTruthy();
    expect(readJiraCache({ success: true, content: '{}' })).toEqual({ cache: null, error: 'it has no "epics" list' });
    expect(readJiraCache({ success: false, error: 'EACCES' })).toEqual({ cache: null, error: 'EACCES' });
    expect(readJiraCache({ success: true, content: '{"fetchedAt":"t","epics":[]}' })).toEqual({
      cache: { fetchedAt: 't', epics: [] },
    });
  });
});
