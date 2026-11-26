import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { AtlasError } from './core/errors.ts';
import { openGitHub, openOrganization, parseGitHubOrganization, parseGitHubUrl, type GitHubOptions } from './core/github.ts';
import type { Source, Target } from './core/scan.ts';

/**
 * What the Node CLI scans: a GitHub repository URL, an organization URL, or a directory. A bare
 * `<org>` is an organization unless a local path of that name exists: the path wins.
 */
export function openInput(input: string, options: GitHubOptions): Promise<Target> {
  if (parseGitHubUrl(input)) return openGitHub(input, options);
  const organization = parseGitHubOrganization(input);
  if (organization && !(organization.bare && existsSync(input))) return openOrganization(input, options);
  return openDirectory(input);
}

/** Never part of a repository's own files. */
const SKIPPED = new Set(['.git', 'node_modules']);

/** A local checkout as a repository: named after its directory, linked with file:// URLs. */
export async function openDirectory(input: string): Promise<Source> {
  const root = resolve(input);
  const name = basename(root);
  let paths: string[];
  try {
    paths = await walk(root, '');
  } catch {
    throw new AtlasError(`Not a GitHub URL or a readable directory: ${input}`);
  }
  return {
    repository: { id: name, organization: 'local', name, url: pathToFileURL(root).href, commit: '' },
    paths,
    warnings: [],
    read: (path) => readFile(join(root, path)).then((bytes) => new Uint8Array(bytes), () => undefined),
  };
}

/** Every regular file under the directory, as a path relative to the root. */
async function walk(root: string, directory: string, paths: string[] = []): Promise<string[]> {
  // One list for the whole walk: a large repository has more files than a spread can pass.
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = directory ? `${directory}/${entry.name}` : entry.name;
    if (entry.isDirectory() && !SKIPPED.has(entry.name)) await walk(root, path, paths);
    else if (entry.isFile()) paths.push(path);
  }
  return paths;
}
