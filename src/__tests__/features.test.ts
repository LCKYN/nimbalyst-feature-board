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
});
