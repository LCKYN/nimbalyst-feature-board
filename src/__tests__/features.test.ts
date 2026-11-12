import { describe, expect, it } from 'vitest';
import { groupTasks, parseFrontmatter, toFeature } from '../features';

const FILE = `---
id: issue-12
title: "Pay by QR: scan #1 and confirm"
kind: feature        # feature | change | bug
relates: []
branch: feature/issue-12
mrs: [345, 350]      # every MR
source: new
---
## Goal
relates: not-frontmatter
`;

describe('Feature files', () => {
  it('reads scalars, inline lists and block lists, and stops at the closing fence', () => {
    expect(parseFrontmatter(FILE)).toEqual({
      id: 'issue-12',
      title: 'Pay by QR: scan #1 and confirm',
      kind: 'feature',
      relates: [],
      branch: 'feature/issue-12',
      mrs: ['345', '350'],
      source: 'new',
    });
    expect(parseFrontmatter('---\nmrs:\n  - 1\n  - 2\nkind: bug\n---\n')).toEqual({ mrs: ['1', '2'], kind: 'bug' });
  });

  it('reads quoted scalars the way YAML does: escapes, an inner quote, a comment after the closing quote', () => {
    const title = (line: string) => parseFrontmatter(`---\ntitle: ${line}\n---\n`)?.title;
    expect(title('"He said \\"hi\\": ok"  # was "x"')).toBe('He said "hi": ok');
    expect(title('"Export" # the "PDF" one')).toBe('Export');
    expect(title("'It''s: done'")).toBe("It's: done");
    expect(title("'Pay by QR'  # sales call it 'scan to pay'")).toBe('Pay by QR');
    expect(toFeature('/x/RDHR-1.md', '---\nepic: ~\nbranch: null\n---\n')).toMatchObject({ epic: '', branch: '' });
  });

  it('takes the id from the file name and skips INDEX.md and _files by name', () => {
    expect(toFeature('/repo/.features/issue-12.md', FILE)).toMatchObject({
      id: 'issue-12',
      title: 'Pay by QR: scan #1 and confirm',
      mrs: ['345', '350'],
      unreadable: undefined,
    });
    expect(toFeature('/repo/.features/INDEX.md', '# Features\n')).toBeNull();
    expect(toFeature('/repo/.features/INDEX.md', '---\ntitle: x\n---\n')).toBeNull();
    expect(toFeature('/repo/.features/_template.md', FILE)).toBeNull();
  });

  it('remembers whether the file has an `mrs` key, which a no-MR repo leaves out', () => {
    const withKey = (line: string) => toFeature('/x/ISF-1.md', `---\ntitle: T\n${line}---\n`)?.hasMrsKey;
    expect(withKey('mrs: []\n')).toBe(true);
    expect(withKey('mrs: [345]\n')).toBe(true);
    expect(withKey('mrs:\n')).toBe(true);
    expect(withKey('')).toBe(false);
  });

  it('keeps a Feature file it cannot read as a row that says why', () => {
    expect(toFeature('/x/ISF-12.md', 'no frontmatter')).toMatchObject({
      id: 'ISF-12',
      path: '/x/ISF-12.md',
      title: 'ISF-12',
      mrs: [],
      unreadable: 'no frontmatter block',
    });
    expect(toFeature('/x/ISF-12.md', '', 'EACCES: permission denied')).toMatchObject({
      title: 'ISF-12',
      unreadable: 'EACCES: permission denied',
    });
  });

  it('accepts trailing blanks on both fences', () => {
    expect(parseFrontmatter('--- \nid: issue-1\n---\t\n## Goal\n')).toEqual({ id: 'issue-1' });
    expect(toFeature('/x/issue-1.md', '---\ntitle: T\n--- \n## Goal\n')).toMatchObject({ title: 'T', unreadable: undefined });
  });
});

describe('groupTasks', () => {
  it('keeps live feature-task items and groups them by the Feature they name', () => {
    const item = (id: string, over: object = {}) => ({
      id,
      type: 'feature-task',
      title: id,
      status: 'to-do',
      archived: false,
      updated: '2026-11-12T06:11:53.450Z',
      customFields: { featureId: 'RDHR-144' },
      ...over,
    });
    const grouped = groupTasks([
      item('a', { status: 'done', tags: ['blocked'] }),
      item('b', { customFields: { featureId: 'mr-1' } }),
      item('archived', { archived: true }),
      item('other-type', { type: 'task' }),
      item('no-feature', { customFields: {} }),
      item('padded', { customFields: { featureId: ' mr-1 ' } }),
    ]);
    expect([...grouped.keys()]).toEqual(['RDHR-144', 'mr-1']);
    expect(grouped.get('mr-1')?.map((t) => t.id)).toEqual(['b', 'padded']);
    expect(grouped.get('RDHR-144')).toEqual([
      { id: 'a', title: 'a', status: 'done', tags: ['blocked'], updatedAt: Date.parse('2026-11-12T06:11:53.450Z') },
    ]);
  });

  const item = (id: string, over: object = {}) => ({
    id,
    type: 'feature-task',
    status: 'to-do',
    customFields: { featureId: 'mr-1' },
    ...over,
  });
  const statuses = (items: object[], workspace?: string) =>
    (groupTasks(items, workspace).get('mr-1') ?? []).map((t) => [t.id, t.status]);

  it('writes every Task status the way the tracker ids are written', () => {
    expect(
      statuses([
        item('a', { status: 'In Progress' }),
        item('b', { status: 'in_progress' }),
        item('c', { status: ' Done ' }),
        item('d', { status: null }),
      ]),
    ).toEqual([
      ['a', 'in-progress'],
      ['b', 'in-progress'],
      ['c', 'done'],
      ['d', 'to-do'],
    ]);
  });

  it('keeps an archived Task that is done, because it has run, and drops other archived ones', () => {
    expect(statuses([item('a', { status: 'done', archived: true }), item('b', { archived: true })])).toEqual([['a', 'done']]);
  });

  it('drops items the host returned for another workspace', () => {
    const items = [item('a', { workspace: '/ws' }), item('b', { workspace: '/other' }), item('c')];
    expect(statuses(items, '/ws')).toEqual([
      ['a', 'to-do'],
      ['c', 'to-do'],
    ]);
  });
});
