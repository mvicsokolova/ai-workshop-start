import { AtlasError, RateLimitError } from './errors.ts';
import { findSkills, type SkillFile } from './find.ts';
import { sortSkills, type Repository, type Skill } from './model.ts';
import { parseSkill } from './parse.ts';

/** A repository to scan: its files, and how to read them. */
export type Source = {
  repository: Repository;
  /** Every file path, relative to the repository root. */
  paths: string[];
  /** What listing the files had to leave out. */
  warnings: string[];
  /** The file's bytes, or undefined if it is not there. */
  read(path: string): Promise<Uint8Array | undefined>;
};

/** A GitHub organization or user: its repositories, each opened on its own. */
export type Organization = {
  /** The login as GitHub spells it, for example `JetBrains`. */
  id: string;
  /** `https://github.com/<org>`. */
  url: string;
  /** `owner/repo` of each repository to scan; archived repositories and forks are left out. */
  repositories: string[];
  open(repository: string): Promise<Source>;
};

/** What a command scans: one repository, or every repository of an organization. */
export type Target = Source | Organization;

export const isOrganization = (target: Target): target is Organization => 'repositories' in target;

/** At most this many repositories of an organization are scanned at once. */
export const CONCURRENCY = 8;

export type ScanResult = { repository: Repository; skills: Skill[]; warnings: string[] };

/** fetch → find → parse. Nothing is stored: the result is all there is. */
export async function scan(source: Source): Promise<ScanResult> {
  const files = findSkills(source.paths);
  // The files are read at the same time: on GitHub, each one is a request.
  const results = await Promise.all(files.map((file) => readSkill(source, file)));
  return {
    repository: source.repository,
    skills: sortSkills(results.flatMap((result) => (result.skill ? [result.skill] : []))),
    warnings: [...source.warnings, ...results.flatMap((result) => (result.warning ? [result.warning] : []))],
  };
}

async function readSkill(source: Source, file: SkillFile): Promise<{ skill?: Skill; warning?: string }> {
  const bytes = await source.read(file.path);
  if (!bytes) return { warning: `${file.path}: listed, but not found at the scanned commit; skipped` };
  const parsed = parseSkill(new TextDecoder().decode(bytes));
  const skill: Skill = {
    id: `${source.repository.id}:${file.path}`,
    repository: source.repository.id,
    path: file.path,
    name: parsed.name ?? file.name,
    description: parsed.description,
    commit: source.repository.commit,
    copies: file.copies,
    body: parsed.body,
    files: supportingFiles(source.paths, file.path),
  };
  return { skill, warning: parsed.warning && `${file.path}: ${parsed.warning}` };
}

/** Every other file under the SKILL.md's directory, sorted; the listing may hold only SKILL.md files. */
function supportingFiles(paths: string[], skillPath: string): string[] {
  const directory = skillPath.slice(0, skillPath.lastIndexOf('/') + 1);
  return paths
    .filter((path) => path.startsWith(directory) && path !== skillPath)
    .map((path) => path.slice(directory.length))
    .sort();
}

/**
 * Scans every repository of the organization with `scanRepository`, at most CONCURRENCY at once.
 * A repository that fails is a warning, `<owner/repo>: <reason>`; its skills' warnings get the same
 * prefix. Repositories without skills are left out. The rate limit stops it all; so does a scan in
 * which no repository could be read.
 */
export async function scanOrganization<T extends { repository: Repository; skills: unknown[]; warnings: string[] }>(
  organization: Organization,
  scanRepository: (source: Source) => Promise<T>,
): Promise<{ results: T[]; warnings: string[] }> {
  const { repositories } = organization;
  const outcomes: ({ result: T } | { failure: string })[] = [];
  let next = 0;
  let stopped: unknown;
  async function worker() {
    while (next < repositories.length && stopped === undefined) {
      const index = next++;
      try {
        outcomes[index] = { result: await scanRepository(await organization.open(repositories[index])) };
      } catch (error) {
        if (error instanceof RateLimitError || !(error instanceof AtlasError)) stopped ??= error;
        else outcomes[index] = { failure: `${repositories[index]}: ${error.message}` };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, repositories.length) }, worker));
  if (stopped !== undefined) throw stopped;
  const failures = outcomes.flatMap((outcome) => ('failure' in outcome ? [outcome.failure] : []));
  if (repositories.length > 0 && failures.length === repositories.length) {
    throw new AtlasError(`No repository of ${organization.url} could be read; the first: ${failures[0]}`);
  }
  const results = outcomes.flatMap((outcome) => ('result' in outcome ? [outcome.result] : []));
  return {
    results: results.filter((result) => result.skills.length > 0),
    warnings: outcomes.flatMap((outcome) =>
      'failure' in outcome ? [outcome.failure] : outcome.result.warnings.map((warning) => `${outcome.result.repository.id}: ${warning}`),
    ),
  };
}
