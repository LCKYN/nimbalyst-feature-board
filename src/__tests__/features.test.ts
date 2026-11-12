import { describe, expect, it } from 'vitest';
import { groupTasks, parseFrontmatter, sections, toFeature } from '../features';

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

// The shape of a real backfilled file: a Goal wrapped mid-sentence, then "Built" and "Waits on" lines.
const WITH_BODY = `---
id: issue-12
title: Pay by QR
---
intro before the first heading

## Goal
Customers pay an invoice by scanning a QR code, without typing a card or
an account number.

Built: the QR on the invoice page.
Waits on: bank sandbox access.

## Acceptance criteria
- [x] The QR opens the bank app
- [ ] A paid invoice is marked within a minute
  - [X] also when the page was closed
- not a checkbox

## Related code
- [docs/features/qr.md](../docs/features/qr.md)
- \`backend/app/pay/qr_*.py\`

## Decisions
- 2026-11-12: one QR per invoice.
`;

describe('Feature file body', () => {
  it('splits the body into its ## sections and leaves the frontmatter out', () => {
    expect(Object.keys(sections(WITH_BODY))).toEqual(['Goal', 'Acceptance criteria', 'Related code', 'Decisions']);
    expect(sections(WITH_BODY).Decisions).toBe('- 2026-11-12: one QR per invoice.');
    expect(sections('no heading at all')).toEqual({});
  });

  it('keeps the Goal with its first paragraph on one line, and the rest as written', () => {
    expect(toFeature('/x/issue-12.md', WITH_BODY)?.goal).toBe(
      'Customers pay an invoice by scanning a QR code, without typing a card or an account number.\n\n' +
        'Built: the QR on the invoice page.\nWaits on: bank sandbox access.',
    );
    // A body line that looks like frontmatter is body.
    expect(toFeature('/x/issue-12.md', FILE)).toMatchObject({ goal: 'relates: not-frontmatter', relates: [] });
  });

  it('reads the acceptance criteria as checkboxes, and the other sections as text', () => {
    expect(toFeature('/x/issue-12.md', WITH_BODY)).toMatchObject({
      criteria: [
        { text: 'The QR opens the bank app', done: true },
        { text: 'A paid invoice is marked within a minute', done: false },
        { text: 'also when the page was closed', done: true },
      ],
      relatedCode: '- [docs/features/qr.md](../docs/features/qr.md)\n- `backend/app/pay/qr_*.py`',
      decisions: '- 2026-11-12: one QR per invoice.',
    });
    const ticks = toFeature('/x/a.md', '---\ntitle: T\n---\n## Acceptance criteria\n- [x] a\n- [ ] b\n- [X] c\n')?.criteria;
    expect(ticks?.map((c) => c.done)).toEqual([true, false, true]);
    // A backfilled file: the section is there and empty.
    const empty = toFeature('/x/RDHR-1.md', '---\ntitle: T\n---\n## Goal\nG\n\n## Acceptance criteria\n\n## Related code\n');
    expect(empty).toMatchObject({ goal: 'G', criteria: [], relatedCode: '', decisions: '' });
  });
});

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

  it('reads an optional `target`, a date or a milestone name', () => {
    const target = (line: string) => toFeature('/x/mr-1.md', `---\ntitle: T\n${line}---\n`)?.target;
    expect(target('target: 2026-12-15   # when it is due\n')).toBe('2026-12-15');
    expect(target('target: v0.2\n')).toBe('v0.2');
    expect(target('')).toBe('');
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
