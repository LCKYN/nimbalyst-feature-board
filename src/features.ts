export interface Feature {
  /** File name without `.md`; the rules make this the Feature's id. */
  id: string;
  path: string;
  title: string;
  kind: string;
  branch: string;
  relates: string[];
  mrs: string[];
  source: string;
}

type Frontmatter = Record<string, string | string[]>;

/** A scalar without its quotes, or without its trailing ` # comment` when it has none. */
const scalar = (s: string) => /^(['"])(.*)\1/.exec(s)?.[2] ?? s.replace(/(^|\s+)#.*$/, '').trim();

/**
 * Reads the frontmatter block of a Feature file, or null when there is none.
 *
 * ponytail: flat YAML only -- `key: scalar`, `key: [a, b]`, and `- item` block
 * lists, which is all `~/.claude/feature-rules.md` allows. Swap in the `yaml`
 * package if Feature files ever grow nested values or multi-line strings.
 */
export function parseFrontmatter(text: string): Frontmatter | null {
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
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

/** A Feature from one `.features/` file, or null for files that are not Features (INDEX.md, _template.md). */
export function toFeature(path: string, content: string): Feature | null {
  const name = path.split(/[\\/]/).pop() ?? '';
  if (!name.endsWith('.md') || name.startsWith('_')) return null;
  const fm = parseFrontmatter(content);
  if (!fm) return null;
  const id = name.slice(0, -3);
  return {
    id,
    path,
    title: text(fm.title) || id,
    kind: text(fm.kind),
    branch: text(fm.branch),
    relates: list(fm.relates),
    mrs: list(fm.mrs),
    source: text(fm.source),
  };
}

/**
 * Every Feature in `<workspace>/.features/`, sorted by id. A workspace without
 * the folder has no Features, which is not an error.
 */
export async function loadFeatures(workspacePath: string): Promise<Feature[]> {
  // ponytail: the host caps a folder listing at 200 entries; read the folder
  // through a backend module if a repo ever holds more Feature files than that.
  const entries: Array<{ name: string; type: string; path: string }> =
    (await window.electronAPI.invoke('get-folder-contents', `${workspacePath}/.features`)) ?? [];
  const files = entries.filter((e) => e.type === 'file' && e.name.endsWith('.md'));
  const features = await Promise.all(
    files.map(async (file) => {
      const result = await window.electronAPI.invoke('read-file-content', file.path);
      return result?.success ? toFeature(file.path, result.content) : null;
    }),
  );
  return features.filter((f): f is Feature => f !== null).sort((a, b) => a.id.localeCompare(b.id));
}
