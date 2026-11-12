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

  it('takes the id from the file name and skips files that are not Features', () => {
    expect(toFeature('/repo/.features/issue-12.md', FILE)).toMatchObject({
      id: 'issue-12',
      title: 'Pay by QR: scan #1 and confirm',
      mrs: ['345', '350'],
    });
    expect(toFeature('/repo/.features/INDEX.md', '# Features\n')).toBeNull();
    expect(toFeature('/repo/.features/_template.md', FILE)).toBeNull();
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
    ]);
    expect([...grouped.keys()]).toEqual(['RDHR-144', 'mr-1']);
    expect(grouped.get('RDHR-144')).toEqual([
      { id: 'a', title: 'a', status: 'done', tags: ['blocked'], updatedAt: Date.parse('2026-11-12T06:11:53.450Z') },
    ]);
  });
});
