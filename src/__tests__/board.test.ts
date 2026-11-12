import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ago,
  boardRows,
  isStale,
  isWorktreeGitFile,
  loadBoard,
  parseJiraCache,
  readJiraCache,
  type JiraEpic,
} from '../board';
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
  // As `toFeature` sets it: a file that lists MRs has the key.
  hasMrsKey: (over.mrs?.length ?? 0) > 0,
  goal: '',
  criteria: [],
  relatedCode: '',
  decisions: '',
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
    expect(row.tasks.map((t) => t.status)).toEqual(['done', 'in-review']);
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

  it('never takes done from the Epic alone for a file with an `mrs` key, also while it lists no MR yet', () => {
    const done = cache(epic({ status: 'Done' }));
    // An MR repo: no MR was opened, the Epic was moved to Done by hand. Not shipped, and no MR state is missing.
    const [mrRepo] = boardRows([feature({ hasMrsKey: true })], new Map(), done);
    expect(mrRepo).toMatchObject({ status: 'todo', mrStateUnknown: false, unknown: undefined });
    // A no-MR repo leaves the key out, and there the Epic decides.
    expect(boardRows([feature()], new Map(), done)[0].status).toBe('done');
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

  it('finds the Epic by the file name before `epic:`, so a stale `epic:` line gives no second row', () => {
    const rows = boardRows(
      [feature({ id: 'RDHR-170', epic: 'RDHR-144' })],
      new Map(),
      cache(epic(), epic({ key: 'RDHR-170', status: 'To Do' })),
    );
    expect(rows.map((r) => [r.id, r.epic?.key, Boolean(r.feature)])).toEqual([
      ['RDHR-144', 'RDHR-144', false],
      ['RDHR-170', 'RDHR-170', true],
    ]);
    // A draft file still finds its Epic through `epic:`.
    const [draft] = boardRows([feature({ id: 'draft-qr', epic: 'RDHR-144' })], new Map(), cache(epic()));
    expect(draft).toMatchObject({ id: 'draft-qr', epic: { key: 'RDHR-144' }, unknown: undefined });
  });

  it('reads a Jira status with stray blanks or another case', () => {
    const rows = boardRows([], new Map(), cache(epic({ key: 'A-1', status: 'Done ' }), epic({ key: 'A-2', status: ' in progress' })));
    expect(statusOf(rows)).toEqual({ 'A-1': 'done', 'A-2': 'in_progress' });
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
    expect(
      parseJiraCache(
        '{"fetchedAt":"t","epics":[{"key":"A-1","status":"Done","openCards":0,"cardsInProgress":0},{"title":"no key"}]}',
      ),
    ).toEqual({
      fetchedAt: 't',
      epics: [{ key: 'A-1', title: 'A-1', status: 'Done', labels: [], openCards: 0, cardsInProgress: 0 }],
    });
  });

  it('rejects a partial cache: an entry without a status or a card count is not "no open card"', () => {
    const entry = (fields: string) => `{"fetchedAt":"t","epics":[{"key":"A-1"${fields}}]}`;
    expect(() => parseJiraCache(entry(',"status":"To Do"'))).toThrow('A-1 has no openCards');
    expect(() => parseJiraCache(entry(',"status":"To Do","openCards":"3","cardsInProgress":0'))).toThrow('A-1 has no openCards');
    expect(() => parseJiraCache(entry(',"status":"To Do","openCards":1'))).toThrow('A-1 has no cardsInProgress');
    expect(() => parseJiraCache(entry(',"openCards":1,"cardsInProgress":0'))).toThrow('A-1 has no status');
  });

  it('clamps card counts to whole numbers that are not negative', () => {
    const [e] = parseJiraCache('{"epics":[{"key":"A-1","status":"Done","openCards":-1,"cardsInProgress":2.5}]}').epics;
    expect(e).toMatchObject({ openCards: 0, cardsInProgress: 2 });
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

describe('ago', () => {
  const now = Date.parse('2026-11-12T10:00:00Z');
  const before = (minutes: number) => new Date(now - minutes * 60_000).toISOString();

  it('rounds down to minutes, hours and days', () => {
    expect(ago(before(0.5), now)).toBe('just now');
    expect(ago(before(59), now)).toBe('59 min ago');
    expect(ago(before(60), now)).toBe('1 h ago');
    expect(ago(before(24 * 60 - 1), now)).toBe('23 h ago');
    expect(ago(before(24 * 60), now)).toBe('1 d ago');
  });

  it('is empty for a time that cannot be read or lies in the future', () => {
    expect(ago('', now)).toBe('');
    expect(ago('yesterday', now)).toBe('');
    // A local time written with a Z is hours ahead; that is not "just now".
    expect(ago('2026-11-12T17:00:00Z', now)).toBe('');
    // One minute of clock skew still is.
    expect(ago('2026-11-12T10:00:30Z', now)).toBe('just now');
  });
});

describe('isStale', () => {
  const now = Date.parse('2026-11-12T00:00:00Z');

  it('is true for a read older than a day, or at a time that cannot be trusted', () => {
    expect(isStale('2026-11-11T23:00:00Z', now)).toBe(false);
    expect(isStale('2026-11-10T23:59:00Z', now)).toBe(true);
    expect(isStale('2026-11-01T00:00:00Z', now)).toBe(true);
    expect(isStale('', now)).toBe(true);
    expect(isStale('2026-11-12T07:00:00Z', now)).toBe(true);
  });
});

describe('isWorktreeGitFile', () => {
  it('knows the .git file of a linked worktree from a submodule and from nothing', () => {
    expect(isWorktreeGitFile('gitdir: /repo/.git/worktrees/x\n')).toBe(true);
    expect(isWorktreeGitFile('gitdir: ../.git/modules/lib\n')).toBe(false);
    expect(isWorktreeGitFile('')).toBe(false);
  });
});

describe('loadBoard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  type Reply = string | { success: false; error: string };
  /** A host with these folder listings and file contents; a file not named is absent. */
  const host = (listings: Record<string, string[]>, files: Record<string, Reply> = {}, items: object[] = []) =>
    vi.stubGlobal('window', {
      electronAPI: {
        invoke: async (channel: string, path: string) => {
          if (channel === 'get-folder-contents') {
            return (listings[path] ?? []).map((name) => ({ name, type: 'file', path: `${path}/${name}` }));
          }
          if (channel !== 'read-file-content') return items;
          const reply = files[path];
          return reply === undefined ? null : typeof reply === 'string' ? { success: true, content: reply } : reply;
        },
      },
    });

  it('reads the Feature files of every workspace folder, not only the first', async () => {
    host({ '/b/.features': ['mr-1.md', 'jira-cache.json'] }, { '/b/.features/mr-1.md': '---\ntitle: Board\n---\n' });
    const board = await loadBoard(['/a', '/b']);
    expect(board.features.map((f) => [f.id, f.title])).toEqual([['mr-1', 'Board']]);
    expect(board).toMatchObject({ jira: null, jiraError: undefined, truncated: false, worktree: false });
  });

  it('keeps a file whose read failed as a row and logs it, and drops one that is gone', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    host(
      { '/ws/.features': ['ok.md', 'locked.md', 'gone.md', 'INDEX.md'] },
      {
        '/ws/.features/ok.md': '---\ntitle: Fine\n---\n',
        '/ws/.features/locked.md': { success: false, error: 'EACCES' },
        '/ws/.features/INDEX.md': '# Features\n',
      },
    );
    const { features } = await loadBoard(['/ws']);
    expect(Object.fromEntries(features.map((f) => [f.id, f.unreadable]))).toEqual({ ok: undefined, locked: 'EACCES' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]).toContain('locked.md');
  });

  it('says when a folder listing came back at the cap of 200 entries', async () => {
    const names = (n: number) => Array.from({ length: n }, (_, i) => `f-${i}.txt`);
    host({ '/ws/.features': names(199) });
    expect((await loadBoard(['/ws'])).truncated).toBe(false);
    host({ '/ws/.features': names(200) });
    expect((await loadBoard(['/ws'])).truncated).toBe(true);
  });

  it('reports a cache that is there and broken, and joins the caches of several folders', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const one = (key: string, fetchedAt: string) =>
      JSON.stringify({ fetchedAt, epics: [{ key, status: 'Done', openCards: 0, cardsInProgress: 0 }] });
    host(
      {},
      {
        '/a/.features/jira-cache.json': one('A-1', '2026-11-12T08:00:00Z'),
        '/b/.features/jira-cache.json': one('B-1', '2026-11-10T08:00:00Z'),
        '/c/.features/jira-cache.json': '{"epics": [',
      },
    );
    const board = await loadBoard(['/a', '/b', '/c']);
    // The oldest read dates the whole board.
    expect(board.jira).toMatchObject({ fetchedAt: '2026-11-10T08:00:00Z', epics: [{ key: 'A-1' }, { key: 'B-1' }] });
    expect(board.jiraError).toBeTruthy();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('knows a worktree opened as its own project, where neither the cache nor the Tasks are', async () => {
    const feature = { '/ws/.features/RDHR-1.md': '---\nepic: RDHR-1\n---\n' };
    host({ '/ws/.features': ['RDHR-1.md'] }, { ...feature, '/ws/.git': 'gitdir: /repo/.git/worktrees/ws\n' });
    expect((await loadBoard(['/ws'])).worktree).toBe(true);
    // A main checkout: `.git` is a folder, which the host cannot read as a file.
    host({ '/ws/.features': ['RDHR-1.md'] }, { ...feature, '/ws/.git': { success: false, error: 'EISDIR' } });
    expect((await loadBoard(['/ws'])).worktree).toBe(false);
  });
});
