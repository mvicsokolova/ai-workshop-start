// What the website shows: a scan, with each skill's owners, topics and rendered Markdown.
import { Marked, type Tokens } from 'marked';
import { skillLink, sortSkills, type Repository, type Skill } from '../core/model.ts';
import { isOrganization, scan, scanOrganization, type Organization, type Source, type Target } from '../core/scan.ts';

export type Heading = { depth: number; text: string; id: string };
export type FileLink = { path: string; link: string };

export type CatalogSkill = {
  id: string;
  /**
   * What the page calls it, unique in the catalog: the name, `<name>@<directory name>` when another
   * skill of its repository has the same name; prefixed `<repo>/` in an organization.
   */
  key: string;
  /** `owner/repo`. */
  repository: string;
  name: string;
  description: string;
  path: string;
  /** The SKILL.md at the scanned commit. */
  link: string;
  /** The skill's directory, for example `.agents/skills/commits`. */
  directory: string;
  copies: FileLink[];
  files: FileLink[];
  /** The teams in the skill's OWNERSHIP file. */
  owners: string[];
  topics: string[];
  /** The body as safe HTML: raw HTML is shown as text, relative links point at the repository. */
  html: string;
  headings: Heading[];
  /** The other skills of its repository its body links to, by key. */
  links: string[];
  /** The skills whose bodies link to it, by key. */
  linkedFrom: string[];
  /** The body without Markdown punctuation, for the full-text search. */
  text: string;
  words: number;
};

export type Facet = { name: string; count: number };

export type Catalog = {
  /** One repository, or an organization's repositories. */
  kind: 'repository' | 'organization';
  /** The repository scanned; for an organization, the organization itself, without a commit. */
  repository: Repository;
  skills: CatalogSkill[];
  warnings: string[];
  owners: Facet[];
  topics: Facet[];
  /** The repositories with skills, `owner/repo`. */
  repositories: Facet[];
  /** ISO time of the scan. */
  scannedAt: string;
};

/** Topics by what a skill's name and description say; a skill can have several or none. */
export const TOPICS: [string, RegExp][] = [
  ['Testing', /\btest(s|ing)?\b|junit|fixtures?\b/i],
  ['UI', /\bui\b|compose|swing|dialog|icons?\b|jewel|accessibility|\bdsl\b/i],
  ['Build & modules', /bazel|\bbuild\b|gradle|\.iml|modules?\b|dependenc|kmp/i],
  ['Migration', /migrat|convert|\bmove\b|\bbump\b|\bupdate\b/i],
  ['Debugging', /debug|freez|leak|diagnos|troubleshoot/i],
  ['Code quality', /style|review|audit|dead code|duplicate/i],
  ['Git & VCS', /commit|\bpush\b|\bgit\b|amend/i],
  ['Plugins', /plugin/i],
  ['Python', /python|conda|\bpy\b/i],
  ['Kotlin', /kotlin|coroutine/i],
  ['Rust', /\brust\b/i],
  ['Platform APIs', /\bapis?\b|symbol|registry|action|eel\b|jna\b|modcommand/i],
];

/** Scans the repository or the organization and prepares every skill for the page. */
export async function buildCatalog(target: Target): Promise<Catalog> {
  if (isOrganization(target)) return organizationCatalog(target);
  const { repository, skills, warnings } = await repositorySkills(target, '');
  return catalog('repository', repository, skills, warnings);
}

/** Every repository's skills in one catalog; each skill's key names its repository. */
async function organizationCatalog(organization: Organization): Promise<Catalog> {
  const { results, warnings } = await scanOrganization(organization, (source) =>
    repositorySkills(source, `${source.repository.name}/`),
  );
  const repository: Repository = {
    id: organization.id,
    organization: organization.id,
    name: organization.id,
    url: organization.url,
    commit: '',
  };
  return catalog('organization', repository, sortSkills(results.flatMap((result) => result.skills)), warnings);
}

function catalog(kind: Catalog['kind'], repository: Repository, skills: CatalogSkill[], warnings: string[]): Catalog {
  return {
    kind,
    repository,
    skills,
    warnings,
    owners: facets(skills.flatMap((skill) => skill.owners)),
    topics: facets(skills.flatMap((skill) => skill.topics)),
    repositories: facets(skills.map((skill) => skill.repository)),
    scannedAt: new Date().toISOString(),
  };
}

/** One repository's skills, keyed `<prefix><name>` (see `skillKeys`); links between skills stay in the repository. */
async function repositorySkills(
  source: Source,
  prefix: string,
): Promise<{ repository: Repository; skills: CatalogSkill[]; warnings: string[] }> {
  const result = await scan(source);
  const { repository } = result;
  const keys = skillKeys(result.skills, prefix);
  const byPath = new Map<string, string>();
  result.skills.forEach((skill, index) => {
    for (const path of [skill.path, ...skill.copies]) {
      byPath.set(path, keys[index]);
      byPath.set(path.slice(0, path.lastIndexOf('/')), keys[index]);
    }
  });
  const skillAt = (path: string) => byPath.get(path.replace(/\/$/, ''));
  const skills = await Promise.all(
    result.skills.map((skill, index) => catalogSkill(source, repository, skill, keys[index], skillAt)),
  );
  for (const skill of skills) {
    for (const key of skill.links) skills.find((other) => other.key === key)?.linkedFrom.push(skill.key);
  }
  return { repository, skills, warnings: result.warnings };
}

/**
 * Each skill's key: its name, unless another skill of the repository declares the same name; then
 * every one of them is `<name>@<directory name>`, which is unique, as skills are grouped by directory.
 */
function skillKeys(skills: Skill[], prefix: string): string[] {
  const counts = new Map<string, number>();
  for (const skill of skills) counts.set(skill.name, (counts.get(skill.name) ?? 0) + 1);
  return skills.map((skill) => {
    if (counts.get(skill.name) === 1) return prefix + skill.name;
    const directory = skill.path.slice(0, skill.path.lastIndexOf('/'));
    return `${prefix}${skill.name}@${directory.slice(directory.lastIndexOf('/') + 1)}`;
  });
}

async function catalogSkill(
  source: Source,
  repository: Repository,
  skill: Skill,
  key: string,
  skillAt: (path: string) => string | undefined,
): Promise<CatalogSkill> {
  const directory = skill.path.slice(0, skill.path.lastIndexOf('/'));
  const link = (path: string) => skillLink(repository, { ...skill, path });
  const ownership = skill.files.includes('OWNERSHIP') ? await source.read(`${directory}/OWNERSHIP`) : undefined;
  const { html, headings, links } = renderMarkdown(skill.body, { ...fileBase(repository, skill, directory), skillAt });
  const text = plainText(skill.body);
  return {
    id: skill.id,
    key,
    repository: skill.repository,
    name: skill.name,
    description: skill.description,
    path: skill.path,
    link: link(skill.path),
    directory,
    copies: skill.copies.map((path) => ({ path, link: link(path) })),
    files: skill.files.map((path) => ({ path, link: link(`${directory}/${path}`) })),
    owners: ownership ? parseOwners(new TextDecoder().decode(ownership)) : [],
    topics: TOPICS.filter(([, pattern]) => pattern.test(`${skill.name.replace(/-/g, ' ')} ${skill.description}`)).map(
      ([topic]) => topic,
    ),
    html,
    headings,
    links: links.filter((other) => other !== key),
    linkedFrom: [],
    text,
    words: text.split(/\s+/).filter(Boolean).length,
  };
}

/** `owner 'IJPL Editor'` lines; the quotes are optional. */
export function parseOwners(text: string): string[] {
  const owners = text.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*owner\s+(?:'([^']*)'|"([^"]*)"|(.+?))\s*$/.exec(line);
    const owner = match && (match[1] ?? match[2] ?? match[3]).trim();
    return owner ? [owner] : [];
  });
  return [...new Set(owners)];
}

function facets(values: string[]): Facet[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
}

/** How a SKILL.md's links reach other files: the repository root as pages and as raw files, and its directory. */
export type LinkBase = {
  page: string;
  raw: string;
  directory: string;
  /** The skill a repository path belongs to: its SKILL.md, a copy, or its directory. */
  skillAt?(path: string): string | undefined;
};

function fileBase(repository: Repository, skill: Skill, directory: string): LinkBase {
  if (!skill.commit) return { page: `${repository.url}/`, raw: `${repository.url}/`, directory };
  return {
    page: `${repository.url}/blob/${skill.commit}/`,
    raw: `https://raw.githubusercontent.com/${repository.id}/${skill.commit}/`,
    directory,
  };
}

const SAFE_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * A link the page can follow, never `javascript:`. A relative one is a file in the repository: from
 * the skill's directory, or from the root with a leading `/`; it cannot climb above the root.
 */
export function resolveLink(href: string, base: LinkBase, raw = false): string | undefined {
  if (href.startsWith('#')) return href;
  if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) {
    try {
      const url = new URL(href, 'https://example.invalid/');
      return SAFE_PROTOCOLS.has(url.protocol) ? url.href : undefined;
    } catch {
      return undefined;
    }
  }
  const { path, rest } = repositoryPath(href, base.directory);
  return `${raw ? base.raw : base.page}${path.split('/').map((s) => encodeURIComponent(s)).join('/')}${rest}`;
}

/** A relative link as a path from the repository root, and the query or fragment after it. */
function repositoryPath(href: string, directory: string): { path: string; rest: string } {
  const [, path = '', rest = ''] = /^([^?#]*)(.*)$/.exec(href) ?? [];
  const segments = path.startsWith('/') ? [] : directory.split('/').filter(Boolean);
  for (const segment of path.split('/')) {
    if (segment === '..') segments.pop();
    else if (segment && segment !== '.') segments.push(decodeSafely(segment));
  }
  return { path: segments.join('/'), rest };
}

/** A link to another skill of the same repository opens it in the atlas. */
function atlasLink(href: string, base: LinkBase): string | undefined {
  if (!base.skillAt || href.startsWith('#') || /^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) return undefined;
  const { path, rest } = repositoryPath(href, base.directory);
  if (rest.startsWith('?')) return undefined;
  return base.skillAt(path);
}

function decodeSafely(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function renderMarkdown(body: string, base: LinkBase): { html: string; headings: Heading[]; links: string[] } {
  const headings: Heading[] = [];
  const links = new Set<string>();
  const used = new Map<string, number>();
  const marked = new Marked({
    gfm: true,
    renderer: {
      // SKILL.md files are not trusted to run anything in the page: raw HTML is shown as text.
      html({ text }) {
        return escapeHtml(text);
      },
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const text = inner.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').trim();
        const slug = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'section';
        const seen = used.get(slug) ?? 0;
        used.set(slug, seen + 1);
        const id = `h-${seen ? `${slug}-${seen}` : slug}`;
        headings.push({ depth, text, id });
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
      },
      link({ href, title, tokens }: Tokens.Link) {
        const inner = this.parser.parseInline(tokens);
        const skill = atlasLink(href, base);
        if (skill) {
          links.add(skill);
          const atlas = `#/?skill=${encodeURIComponent(skill)}`;
          return `<a href="${escapeHtml(atlas)}" data-skill="${escapeHtml(skill)}" class="skill-link"${
            title ? ` title="${escapeHtml(title)}"` : ''
          }>${inner}</a>`;
        }
        const url = resolveLink(href, base);
        if (!url) return inner;
        const external = !url.startsWith('#');
        return `<a href="${escapeHtml(url)}"${title ? ` title="${escapeHtml(title)}"` : ''}${
          external ? ' target="_blank" rel="noopener noreferrer"' : ''
        }>${inner}</a>`;
      },
      image({ href, title, text }: Tokens.Image) {
        const url = resolveLink(href, base, true);
        if (!url || url.startsWith('#')) return escapeHtml(text);
        return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text)}"${title ? ` title="${escapeHtml(title)}"` : ''} loading="lazy">`;
      },
    },
  });
  const html = marked.parse(body, { async: false });
  return { html, headings, links: [...links].sort() };
}

function plainText(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_>#|~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
