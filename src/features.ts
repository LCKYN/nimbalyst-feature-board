import type { TaskFact } from './featureStatus';

export interface Feature {
  /** File name without `.md`; the rules make this the Feature's id. */
  id: string;
  path: string;
  title: string;
  kind: string;
  /** Jira Epic key, empty when the repo has no Jira. */
  epic: string;
  branch: string;
  relates: string[];
  mrs: string[];
  source: string;
  /** Why the file could not be read as a Feature (no frontmatter block, a failed read); the fields above are then empty. */
  unreadable?: string;
}

type Frontmatter = Record<string, string | string[]>;

/**
 * A scalar the way YAML reads it: a quoted one up to its closing quote with
 * the escapes undone, a plain one without its trailing ` # comment`, and `~`
 * or `null` as empty.
 */
const scalar = (s: string) => {
  const double = /^"((?:[^"\\]|\\.)*)"/.exec(s);
  // ponytail: `\x` becomes `x`, which is right for `\"` and `\\` only; `\n` and
  // `\u00e9` need the `yaml` package named below.
  if (double) return double[1].replace(/\\(.)/g, '$1');
  const single = /^'((?:[^']|'')*)'/.exec(s);
  if (single) return single[1].replace(/''/g, "'");
  const plain = s.replace(/(^|\s+)#.*$/, '').trim();
  return plain === '~' || plain === 'null' ? '' : plain;
};

/**
 * Reads the frontmatter block of a Feature file, or null when there is none.
 *
 * ponytail: flat YAML only -- `key: scalar`, `key: [a, b]`, and `- item` block
 * lists, which is all `~/.claude/feature-rules.md` allows. Swap in the `yaml`
 * package if Feature files ever grow nested values or multi-line strings.
 */
export function parseFrontmatter(text: string): Frontmatter | null {
  const block = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!block) return null;

  const out: Frontmatter = {};
  let listKey: string | undefined;
  for (const raw of block[1].split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(raw);
    if (item && listKey) {
      (out[listKey] as string[]).push(scalar(item[1]));
      continue;
    }
    const pair = /^([\w-]+):\s*(.*)$/.exec(raw);
    if (!pair) continue;
    const key = pair[1];
    const inlineList = /^\[(.*?)\]/.exec(pair[2]);
    const value = scalar(pair[2]);
    listKey = undefined;
    if (inlineList) {
      out[key] = inlineList[1].split(',').map((v) => scalar(v.trim())).filter(Boolean);
    } else if (value === '') {
      out[key] = [];
      listKey = key;
    } else {
      out[key] = value;
    }
  }
  return out;
}

const text = (v: string | string[] | undefined) => (typeof v === 'string' ? v : '');
const list = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);

/**
 * A Feature from one `.features/` file, or null for the files that are not
 * Features, which is decided by name alone: `INDEX.md` and `_*`. Every other
 * `.md` is a Feature, so one that cannot be read (`readError`) or has no
 * frontmatter block stays on the board, with `unreadable` saying why.
 */
export function toFeature(path: string, content: string, readError?: string): Feature | null {
  const name = path.split(/[\\/]/).pop() ?? '';
  if (!name.endsWith('.md') || name.startsWith('_') || name === 'INDEX.md') return null;
  const fm = readError ? null : parseFrontmatter(content);
  const id = name.slice(0, -3);
  return {
    id,
    path,
    title: text(fm?.title) || id,
    kind: text(fm?.kind),
    epic: text(fm?.epic),
    branch: text(fm?.branch),
    relates: list(fm?.relates),
    mrs: list(fm?.mrs),
    source: text(fm?.source),
    unreadable: readError ?? (fm ? undefined : 'no frontmatter block'),
  };
}

/** The host's cap on one folder listing; it cuts the list there without saying so. */
const LISTING_CAP = 200;

/**
 * Every Feature in `<workspace>/.features/`, sorted by id. A workspace without
 * the folder has no Features, which is not an error. `truncated` says the
 * listing came back at the host's cap, so Feature files may be missing.
 */
export async function loadFeatures(workspacePath: string): Promise<{ features: Feature[]; truncated: boolean }> {
  // ponytail: the host caps a folder listing at 200 entries; read the folder
  // through a backend module if a repo ever holds more Feature files than that.
  const entries: Array<{ name: string; type: string; path: string }> =
    (await window.electronAPI.invoke('get-folder-contents', `${workspacePath}/.features`)) ?? [];
  const files = entries.filter((e) => e.type === 'file' && e.name.endsWith('.md'));
  const features = await Promise.all(
    files.map(async (file) => {
      const result = await window.electronAPI.invoke('read-file-content', file.path);
      // The host answers null for a file that is gone since the listing; anything else is a row.
      if (result == null) return null;
      const feature = result.success
        ? toFeature(file.path, result.content)
        : toFeature(file.path, '', result.error || 'the read failed');
      if (feature?.unreadable) console.warn('[feature-board] Feature file not readable:', file.name, feature.unreadable);
      return feature;
    }),
  );
  return {
    features: features.filter((f): f is Feature => f !== null).sort((a, b) => a.id.localeCompare(b.id)),
    truncated: entries.length >= LISTING_CAP,
  };
}

/**
 * The `feature-task` items of a tracker listing, grouped by the Feature id each
 * one names. Left out: Tasks without a `featureId`, archived Tasks unless they
 * are `done` (a done Task has run, archived or not), and items the host says
 * belong to another workspace than `workspace` (a host before 0.82.0 can
 * answer for the wrong project).
 */
export function groupTasks(items: any[], workspace?: string): Map<string, TaskFact[]> {
  const byFeature = new Map<string, TaskFact[]>();
  for (const item of items) {
    const raw = item?.customFields?.featureId;
    const featureId = typeof raw === 'string' ? raw.trim() : '';
    // Written once the way the tracker ids are, so `In Progress` and `in_progress` count as `in-progress`.
    const status = String(item?.status ?? 'to-do').trim().toLowerCase().replace(/[ _]+/g, '-');
    if (item?.type !== 'feature-task' || !featureId || (item.archived && status !== 'done')) continue;
    if (workspace && item.workspace && item.workspace !== workspace) continue;
    const task: TaskFact = {
      id: item.id,
      title: item.title ?? '',
      status,
      tags: Array.isArray(item.tags) ? item.tags : [],
      updatedAt: Date.parse(item.updated) || 0,
    };
    byFeature.set(featureId, [...(byFeature.get(featureId) ?? []), task]);
  }
  return byFeature;
}

/** Every Feature's Tasks in this workspace. The host returns an empty list when the tracker cannot be read. */
export async function loadTasks(workspacePath: string): Promise<Map<string, TaskFact[]>> {
  return groupTasks(
    (await window.electronAPI.invoke('document-service:tracker-items-list', workspacePath)) ?? [],
    workspacePath,
  );
}
