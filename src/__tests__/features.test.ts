import { describe, expect, it } from 'vitest';
import { parseFrontmatter, toFeature } from '../features';

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
