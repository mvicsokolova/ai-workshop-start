import { AtlasError, RateLimitError } from './errors.ts';
import { SKILL_ROOTS } from './find.ts';
import type { Organization, Source } from './scan.ts';

/** The part of `fetch` the core uses, so tests and the browser can pass their own. */
export type Fetch = (url: string, init?: { headers?: Record<string, string> }) => Promise<Response>;

export type GitHubOptions = {
  fetch: Fetch;
  /** With a token, skills are found through code search; without it, through the tree. */
  token?: string;
  /** Every file through the tree, also with a token: code search finds only the SKILL.md files. */
  everyFile?: boolean;
};

const API = 'https://api.github.com';
const RAW = 'https://raw.githubusercontent.com';

/** `https://github.com/owner/repo`, with or without the scheme, a trailing slash or `.git`. */
export function parseGitHubUrl(input: string): { owner: string; repo: string } | undefined {
  const match = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(input.trim());
  return match ? { owner: match[1], repo: match[2] } : undefined;
}

/** Resolves the default branch to a commit and lists the files that may be skills. */
export async function openGitHub(input: string, options: GitHubOptions): Promise<Source> {
  const name = parseGitHubUrl(input);
  if (!name) throw new AtlasError(`Not a GitHub repository URL: ${input}`);
  const github = client(options);
  const info = await github.json<RepositoryInfo>(
    `${API}/repos/${name.owner}/${name.repo}`,
    `Repository not found: https://github.com/${name.owner}/${name.repo}`,
  );
  return openRepository(github, info, options);
}

type RepositoryInfo = { full_name: string; default_branch: string };

async function openRepository(github: Client, info: RepositoryInfo, options: GitHubOptions): Promise<Source> {
  const id = info.full_name;
  const { sha } = await github.json<{ sha: string }>(`${API}/repos/${id}/commits/${encodePath(info.default_branch)}`);
  const warnings: string[] = [];
  const paths = options.token && !options.everyFile ? await searchPaths(github, id) : await treePaths(github, id, sha);
  const [organization, repo] = id.split('/');
  return {
    repository: { id, organization, name: repo, url: `https://github.com/${id}`, commit: sha },
    paths,
    warnings,
    read: (path) => github.raw(`${RAW}/${id}/${sha}/${encodePath(path)}`),
  };
}

/** A GitHub login: letters, digits and inner hyphens. */
const LOGIN = '[a-z\\d](?:[a-z\\d-]*[a-z\\d])?';

/**
 * An organization or a user: `https://github.com/<org>`, with or without the scheme, `www.` or a
 * trailing slash, or a bare `<org>`. `bare` tells the caller a local path of that name wins.
 */
export function parseGitHubOrganization(input: string): { login: string; bare: boolean } | undefined {
  const text = input.trim();
  const url = new RegExp(`^(?:https?://)?(?:www\\.)?github\\.com/(${LOGIN})/?$`, 'i').exec(text);
  if (url) return { login: url[1], bare: false };
  const bare = new RegExp(`^${LOGIN}$`, 'i').exec(text);
  return bare ? { login: bare[0], bare: true } : undefined;
}

type ListedRepository = RepositoryInfo & { archived: boolean; fork: boolean; size: number };

/**
 * Lists an organization's or a user's repositories, all pages, through the GitHub API. Archived
 * repositories, forks and empty ones are left out. Each repository is then opened through the tree:
 * per-repository code search would run into the search rate limit.
 */
export async function openOrganization(input: string, options: GitHubOptions): Promise<Organization> {
  const name = parseGitHubOrganization(input);
  if (!name) throw new AtlasError(`Not a GitHub organization URL: ${input}`);
  const github = client(options);
  const owner = await github.json<{ login: string; type: string }>(
    `${API}/users/${name.login}`,
    `Organization not found: https://github.com/${name.login}`,
  );
  const list = await repositoryList(github, owner, options.token);
  const listed: ListedRepository[] = [];
  for (let page = 1; ; page++) {
    const repositories = await github.json<ListedRepository[]>(`${list}per_page=100&page=${page}`);
    listed.push(...repositories);
    if (repositories.length < 100) break;
  }
  const kept = listed.filter((repository) => !repository.archived && !repository.fork && repository.size > 0);
  const byName = new Map(kept.map((repository) => [repository.full_name, repository]));
  return {
    id: owner.login,
    url: `https://github.com/${owner.login}`,
    repositories: [...byName.keys()],
    // A client per repository: its answers are not kept once it is scanned.
    open: (fullName) => openRepository(client(options), byName.get(fullName)!, { ...options, everyFile: true }),
  };
}

/**
 * Where an owner's repositories are listed, up to the query. With a token, an organization's list
 * holds the private repositories the token can see; a user's public list never does, so the token's
 * own user is listed through `/user/repos`. A token that cannot tell its user (an app's, say) gets
 * the public list.
 */
async function repositoryList(github: Client, owner: { login: string; type: string }, token?: string): Promise<string> {
  if (owner.type === 'Organization') return `${API}/orgs/${owner.login}/repos?`;
  const users = `${API}/users/${owner.login}/repos?`;
  if (!token) return users;
  try {
    const me = await github.json<{ login: string }>(`${API}/user`);
    return me.login.toLowerCase() === owner.login.toLowerCase() ? `${API}/user/repos?affiliation=owner&` : users;
  } catch (error) {
    if (error instanceof RateLimitError) throw error;
    return users;
  }
}

/** Code search looks at the whole default branch, 100 results a page. */
async function searchPaths(github: Client, id: string): Promise<string[]> {
  const paths = new Set<string>(); // pages can repeat a result
  // GitHub returns at most 1000 results: ten pages.
  for (let page = 1; page <= 10; page++) {
    const result = await github.json<{ total_count: number; items: { path: string }[] }>(
      `${API}/search/code?q=filename:SKILL.md+repo:${id}&per_page=100&page=${page}`,
    );
    for (const item of result.items) paths.add(item.path);
    if (result.items.length < 100 || page * 100 >= result.total_count) break;
  }
  return [...paths];
}

type Tree = { truncated: boolean; tree: { path: string; mode: string; type: string; sha: string }[] };

/** The whole tree at once, or the skill roots when it is too large for one answer. */
async function treePaths(github: Client, id: string, sha: string): Promise<string[]> {
  const tree = await github.json<Tree>(`${API}/repos/${id}/git/trees/${sha}?recursive=1`);
  if (!tree.truncated) return files(tree);
  // Too large for one answer: the skill roots, the only places a skill can be, one by one.
  const paths: string[] = [];
  for (const root of SKILL_ROOTS) {
    const rootSha = await directory(github, id, sha, root);
    if (!rootSha) continue;
    const subtree = await github.json<Tree>(`${API}/repos/${id}/git/trees/${rootSha}?recursive=1`);
    paths.push(...files(subtree).map((path) => `${root}/${path}`));
  }
  return paths;
}

/** Walks down one level at a time; the directory's tree, or undefined if it does not exist. */
async function directory(github: Client, id: string, sha: string, path: string): Promise<string | undefined> {
  let current = sha;
  for (const segment of path.split('/')) {
    const tree = await github.json<Tree>(`${API}/repos/${id}/git/trees/${current}`);
    const entry = tree.tree.find((item) => item.path === segment && item.type === 'tree');
    if (!entry) return undefined;
    current = entry.sha;
  }
  return current;
}

/** Regular files only: a symbolic link's content is its target, not a SKILL.md. */
function files(tree: Tree): string[] {
  return tree.tree.filter((item) => item.type === 'blob' && item.mode !== '120000').map((item) => item.path);
}

type Client = ReturnType<typeof client>;

function client({ fetch, token }: GitHubOptions) {
  const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const answers = new Map<string, Promise<unknown>>(); // the root tree is asked for once per skill root

  async function get(url: string, init?: { headers: Record<string, string> }): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (error) {
      throw new AtlasError(`Cannot reach GitHub: ${describe(error)}`);
    }
  }

  async function request(url: string, notFound: string): Promise<unknown> {
    const response = await get(url, { headers });
    if (response.ok) return response.json();
    const body: unknown = await response.json().catch(() => undefined);
    const message = (body as { message?: unknown } | undefined)?.message;
    const text = typeof message === 'string' ? message : '';
    if (response.status === 404) throw new AtlasError(notFound);
    if ((response.status === 403 || response.status === 429) && /rate limit/i.test(text)) {
      throw new RateLimitError(`GitHub rate limit reached; ${token ? 'try again in a minute' : 'set GITHUB_TOKEN'}`);
    }
    if (response.status === 401) throw new AtlasError('GitHub rejected the token in GITHUB_TOKEN');
    throw new AtlasError(`GitHub answered ${response.status} for ${url}${text && `: ${text}`}`);
  }

  return {
    /** A GitHub API answer; `notFound` explains a 404. */
    json<T>(url: string, notFound = `Not found on GitHub: ${url}`): Promise<T> {
      if (!answers.has(url)) answers.set(url, request(url, notFound));
      return answers.get(url) as Promise<T>;
    },
    /** A file's bytes at the scanned commit, or undefined if it is not there. */
    async raw(url: string): Promise<Uint8Array | undefined> {
      const response = await get(url);
      if (response.status === 404) return undefined;
      if (!response.ok) throw new AtlasError(`GitHub answered ${response.status} for ${url}`);
      return new Uint8Array(await response.arrayBuffer());
    },
  };
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function describe(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  return error.cause instanceof Error ? `${error.message} (${error.cause.message})` : error.message;
}
