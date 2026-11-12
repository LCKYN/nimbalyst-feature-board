import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ago,
  boardRows,
  epicUrl,
  isOverdue,
  isStale,
  isWorktreeGitFile,
  jiraSite,
  loadBoard,
  localDate,
  matches,
  parseJiraCache,
  readJiraCache,
  touchesFeatures,
  type JiraEpic,
} from '../board';
import type { Feature } from '../features';
import type { SessionFact, TaskFact } from '../featureStatus';

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
  target: '',
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
  due: '',
  ...over,
});
const task = (status: string): TaskFact => ({ id: status, title: status, status, tags: [], updatedAt: 0 });
const cache = (...epics: JiraEpic[]) => ({ fetchedAt: '2026-11-12T08:00:00Z', epics });
const statusOf = (rows: ReturnType<typeof boardRows>) => Object.fromEntries(rows.map((r) => [r.id, r.status]));

describe('boardRows', () => {
  it('lists Feature files and Epics without a file, each Epic once, in key order within one status', () => {
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

  it('puts what needs the user first: by status, blocked before the rest of a status, then by key', () => {
    const blocked: TaskFact = { id: 'b', title: 'b', status: 'in-progress', tags: ['blocked'], updatedAt: 0 };
    const asking: SessionFact = { id: 's', title: 's', taskId: 'b', status: 'idle', hasPendingPrompt: true, updatedAt: 0 };
    const rows = boardRows(
      [],
      new Map([
        ['A-7', [blocked]],
        ['A-8', [blocked]],
      ]),
      cache(
        epic({ key: 'A-1', status: 'Done' }),
        epic({ key: 'A-2', status: 'To Do' }),
        epic({ key: 'A-3', status: 'To Do', labels: ['rejected'] }),
        epic({ key: 'A-10' }),
        epic({ key: 'A-4' }),
        epic({ key: 'A-7' }),
        epic({ key: 'A-8' }),
      ),
      new Map([['A-8', [asking]]]),
      { 'A-1': 'consulting' },
    );
    expect(rows.map((r) => `${r.id} ${r.status}${r.blocked ? ' blocked' : ''}`)).toEqual([
      'A-8 awaiting_decision',
      'A-7 in_progress blocked',
      'A-4 in_progress',
      'A-10 in_progress',
      // A status set by hand sorts where it says.
      'A-1 consulting',
      'A-2 todo',
      'A-3 cancelled',
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

  it('carries what a Feature waits on: a blocked Task is stuck, an unanswered session prompt awaits a decision', () => {
    const blockedTask: TaskFact = { id: 't1', title: 'Wire the API', status: 'in-progress', tags: ['blocked'], updatedAt: 5 };
    const tasks = new Map([['RDHR-144', [blockedTask]]]);
    const [stuck] = boardRows([feature()], tasks, cache(epic()));
    expect(stuck).toMatchObject({ status: 'in_progress', blocked: true, waiting: [] });
    expect(stuck.stuck).toEqual([
      { featureId: 'RDHR-144', kind: 'blocked', title: 'Wire the API', openedAt: 5, taskId: 't1' },
    ]);

    const asking: SessionFact = { id: 's1', title: 'Rollout', taskId: 't1', status: 'idle', hasPendingPrompt: true, updatedAt: 9 };
    const [waiting] = boardRows([feature()], tasks, cache(epic()), new Map([['RDHR-144', [asking]]]));
    expect(waiting).toMatchObject({ status: 'awaiting_decision', blocked: false, stalled: false });
    expect(waiting.waiting).toEqual([
      { featureId: 'RDHR-144', kind: 'decision', title: 'Rollout', openedAt: 9, sessionId: 's1', taskId: 't1' },
    ]);
  });

  it('reads consulting from a linked session, and stalled from Tasks that nothing runs', () => {
    const session = (status: string): SessionFact => ({ id: 's1', title: 'S', status, hasPendingPrompt: false, updatedAt: 0 });
    const withSession = (tasks: TaskFact[], status: string) =>
      boardRows([feature({ epic: '' })], new Map([['RDHR-144', tasks]]), null, new Map([['RDHR-144', [session(status)]]]))[0];
    expect(withSession([task('to-do')], 'idle')).toMatchObject({ status: 'consulting', stalled: false });
    expect(withSession([task('in-progress')], 'idle')).toMatchObject({ status: 'in_progress', stalled: true });
    expect(withSession([task('in-progress')], 'running')).toMatchObject({ status: 'in_progress', stalled: false });
    expect(withSession([task('in-progress')], 'error')).toMatchObject({ blocked: true, stuck: [{ kind: 'session_error' }] });
  });

  it('lets a status set by hand win over the computed one, and marks it', () => {
    const row = (id: string, overrides?: Record<string, string>) =>
      boardRows(
        [feature(), feature({ id: 'ISF-99', epic: 'ISF-99' })],
        new Map(),
        cache(epic()),
        undefined,
        overrides,
      ).find((r) => r.id === id);
    expect(row('RDHR-144')).toMatchObject({ status: 'in_progress', handSet: false });

    const set = { 'RDHR-144': 'awaiting_decision', 'ISF-99': 'cancelled', 'GONE-1': 'done' };
    expect(row('RDHR-144', set)).toMatchObject({ status: 'awaiting_decision', handSet: true });
    // The user knows better than "unknown" too.
    expect(row('ISF-99', set)).toMatchObject({ status: 'cancelled', handSet: true, unknown: undefined });

    // Storage is not trusted: a value that is no status is ignored.
    expect(row('RDHR-144', { 'RDHR-144': 'finished' })).toMatchObject({ status: 'in_progress', handSet: false });
  });

  it('takes the target from the Feature file when it has one, else the due date of the Epic', () => {
    const target = (f: Partial<Feature>, e: Partial<JiraEpic>) =>
      boardRows([feature(f)], new Map(), cache(epic(e)))[0].target;
    expect(target({ target: '2026-12-15' }, { due: '2026-11-30' })).toBe('2026-12-15');
    expect(target({}, { due: '2026-11-30' })).toBe('2026-11-30');
    expect(target({ target: 'v0.2' }, {})).toBe('v0.2');
    expect(target({}, {})).toBe('');
    // An Epic without a file, and a row with neither.
    expect(boardRows([], new Map(), cache(epic({ due: '2026-11-30' })))[0].target).toBe('2026-11-30');
    expect(boardRows([], new Map([['mr-1', [task('to-do')]]]), null)[0].target).toBe('');
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
    const withCache = boardRows([named], new Map(), cache(epic())).find((r) => r.id === 'ISF-99');
    expect(withCache).toMatchObject({ unknown: 'Jira not read', epic: undefined });
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
      epics: [{ key: 'A-1', title: 'A-1', status: 'Done', labels: [], openCards: 0, cardsInProgress: 0, due: '' }],
    });
  });

  it('reads an Epic\'s due date when the cache has one, and accepts a cache without', () => {
    const due = (field: string) =>
      parseJiraCache(`{"epics":[{"key":"A-1","status":"To Do","openCards":0,"cardsInProgress":0${field}}]}`).epics[0].due;
    expect(due('')).toBe('');
    expect(due(',"due":"2026-12-15"')).toBe('2026-12-15');
    expect(due(',"due":null')).toBe('');
    expect(due(',"due":20261215')).toBe('');
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

  it('takes a time in milliseconds too, where 0 means not known', () => {
    expect(ago(now - 2 * 60 * 60_000, now)).toBe('2 h ago');
    expect(ago(0, now)).toBe('');
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

describe('matches', () => {
  const rows = boardRows(
    [feature({ id: 'A-1', epic: 'A-1', title: 'Recruit on LINE', kind: 'change' }), feature({ id: 'ISF-99', epic: 'ISF-99' })],
    new Map(),
    cache(
      epic({ key: 'A-1', labels: ['demo', 'prod'] }),
      epic({ key: 'A-2', title: 'Payroll', labels: ['demo'], status: 'Done' }),
      epic({ key: 'A-3', title: 'Org sync', labels: [], status: 'To Do' }),
    ),
  );
  const ids = (query: string) => rows.filter((r) => matches(r, query)).map((r) => r.id);

  it('keeps every row for an empty query', () => {
    expect(ids('')).toHaveLength(4);
    expect(ids('   ')).toHaveLength(4);
  });

  it('looks in the labels, the title, the id and the kind, whatever the case', () => {
    expect(ids('prod')).toEqual(['A-1']);
    expect(ids('DEMO')).toEqual(['A-1', 'A-2']);
    expect(ids('payroll')).toEqual(['A-2']);
    expect(ids('a-3')).toEqual(['A-3']);
    expect(ids('change')).toEqual(['A-1']);
  });

  it('looks in the Jira status and in the status label the row shows, done rows included', () => {
    expect(ids('to do')).toEqual(['A-3']);
    expect(ids('เสร็จแล้ว')).toEqual(['A-2']);
    // A row that shows "unknown" is found by that word, not by the status it does not show.
    expect(ids('unknown')).toEqual(['ISF-99']);
    expect(ids('จะทำ')).toEqual(['A-3']);
  });

  it('needs every word of the query', () => {
    expect(ids('demo prod')).toEqual(['A-1']);
    expect(ids('demo payroll')).toEqual(['A-2']);
    expect(ids('demo nothing')).toEqual([]);
  });
});

describe('jiraSite and epicUrl', () => {
  const CLAUDE_MD = '@AGENTS.md\n\nJira project: RDHR (https://example.atlassian.net/jira/software/projects/RDHR/boards/1)\n\nFeatures: .features/\n';

  it('takes the Jira site from the `Jira project:` line of CLAUDE.md, when the line has a URL', () => {
    expect(jiraSite(CLAUDE_MD)).toBe('https://example.atlassian.net');
    expect(jiraSite('# repo\n\nJira project: RDDSI\n')).toBe('');
    expect(jiraSite('See (https://example.atlassian.net/x) for the board\n')).toBe('');
    // The text comes from a file and ends in the system browser: https only.
    expect(jiraSite('Jira project: X (http://example.atlassian.net/x)')).toBe('');
    expect(jiraSite('Jira project: X (javascript:alert(1))')).toBe('');
    expect(jiraSite('')).toBe('');
  });

  it('builds the Epic link only from a known site and a key that looks like one', () => {
    const site = 'https://example.atlassian.net';
    expect(epicUrl(site, 'RDHR-144')).toBe('https://example.atlassian.net/browse/RDHR-144');
    expect(epicUrl('', 'RDHR-144')).toBe('');
    expect(epicUrl(site, 'mr-1')).toBe('');
    expect(epicUrl(site, 'RDHR-144/../../x')).toBe('');
    expect(epicUrl(site, undefined)).toBe('');
  });
});

describe('isOverdue', () => {
  const row = (target: string, status = 'In Progress', labels: string[] = []) =>
    boardRows([feature({ target })], new Map(), cache(epic({ status, labels })))[0];

  it('is true for a date before today on a row that is still open', () => {
    expect(isOverdue(row('2026-11-05'), '2026-11-12')).toBe(true);
    expect(isOverdue(row('2026-11-12'), '2026-11-12')).toBe(false);
    expect(isOverdue(row('2026-12-15'), '2026-11-12')).toBe(false);
  });

  it('is false for a closed row, and for a target that is not a date', () => {
    expect(isOverdue(row('2026-11-05', 'Done'), '2026-11-12')).toBe(false);
    expect(isOverdue(row('2026-11-05', 'To Do', ['rejected']), '2026-11-12')).toBe(false);
    expect(isOverdue(row('v0.2'), '2026-11-12')).toBe(false);
    expect(isOverdue(row('2026-11-5'), '2026-11-12')).toBe(false);
    expect(isOverdue(row(''), '2026-11-12')).toBe(false);
  });
});

describe('localDate', () => {
  it('is the date on the wall clock, not the UTC one', () => {
    // Half past midnight local time is still "yesterday" in UTC east of Greenwich.
    expect(localDate(new Date(2026, 10, 5, 0, 30))).toBe('2026-11-05');
    expect(localDate(new Date(2026, 0, 31, 23, 59))).toBe('2026-01-31');
  });
});

describe('touchesFeatures', () => {
  it('is true for a file event inside a .features/ folder, on either kind of path', () => {
    expect(touchesFeatures({ path: '/ws/.features/RDHR-144.md' })).toBe(true);
    expect(touchesFeatures({ path: '/ws/.features/jira-cache.json' })).toBe(true);
    expect(touchesFeatures({ path: 'C:\\ws\\.features\\mr-1.md' })).toBe(true);
    expect(touchesFeatures({ path: '/ws/docs/.features.md' })).toBe(false);
    expect(touchesFeatures({ path: '/ws/src/board.ts' })).toBe(false);
    expect(touchesFeatures({ filePath: '/ws/.features/x.md' })).toBe(false);
    expect(touchesFeatures(undefined)).toBe(false);
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
  const host = (
    listings: Record<string, string[]>,
    files: Record<string, Reply> = {},
    items: object[] = [],
    sessions: object[] = [],
    states: Record<string, object> = {},
  ) =>
    vi.stubGlobal('window', {
      electronAPI: {
        invoke: async (channel: string, path: string) => {
          if (channel === 'get-folder-contents') {
            return (listings[path] ?? []).map((name) => ({ name, type: 'file', path: `${path}/${name}` }));
          }
          if (channel === 'sessions:list') return { success: true, sessions };
          if (channel === 'ai-session-state:get-state') return { success: true, state: states[path] ?? null };
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

  it('reads the sessions linked to the Tasks, each with its live state', async () => {
    const item = (id: string) => ({ id, type: 'feature-task', status: 'in-progress', customFields: { featureId: 'mr-1' } });
    const session = (id: string, linkedTrackerItemIds: string[], over: object = {}) => ({
      id,
      title: `Session ${id}`,
      updatedAt: 7,
      linkedTrackerItemIds,
      ...over,
    });
    host(
      {},
      {},
      [item('t1'), item('t2')],
      [
        session('asks', ['t1'], { hasPendingInteractivePrompt: true }),
        session('runs', ['t2', 't1']),
        session('failed', ['t2']),
        session('elsewhere', ['other-item']),
        session('unlinked', []),
      ],
      { runs: { status: 'idle', isStreaming: true }, failed: { status: 'error' } },
    );
    const { sessions } = await loadBoard(['/ws']);
    expect([...sessions.keys()]).toEqual(['mr-1']);
    expect(sessions.get('mr-1')).toEqual([
      { id: 'asks', title: 'Session asks', taskId: 't1', status: 'idle', hasPendingPrompt: true, updatedAt: 7 },
      { id: 'runs', title: 'Session runs', taskId: 't2', status: 'running', hasPendingPrompt: false, updatedAt: 7 },
      { id: 'failed', title: 'Session failed', taskId: 't2', status: 'error', hasPendingPrompt: false, updatedAt: 7 },
    ]);
  });

  it('finds the Jira site in the CLAUDE.md of a workspace folder', async () => {
    host({}, { '/b/CLAUDE.md': 'Jira project: RDHR (https://example.atlassian.net/jira/software/projects/RDHR)\n' });
    expect((await loadBoard(['/a', '/b'])).jiraSite).toBe('https://example.atlassian.net');
    host({}, { '/a/CLAUDE.md': 'Jira project: RDDSI\n' });
    expect((await loadBoard(['/a'])).jiraSite).toBe('');
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
