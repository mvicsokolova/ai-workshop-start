/** A skill found in a repository: its SKILL.md, its name and its copies. */
export type SkillFile = { path: string; name: string; copies: string[] };

/** Where agents keep a repository's own skills; the first root that has a skill holds the original. */
export const SKILL_ROOTS = ['.agents/skills', '.claude/skills', '.github/skills', 'agent/skills', 'skills'];

/**
 * Every `<root>/<name>/SKILL.md`, named after its directory. The same `<name>` in several roots is
 * one skill, its other files are copies. Anything else is not a skill: a SKILL.md deeper or
 * shallower in a root, under another directory, or spelled differently.
 */
export function findSkills(paths: string[]): SkillFile[] {
  const byName = new Map<string, string[]>();
  for (const { name, path } of paths.flatMap(skillPath).sort((a, b) => a.rank - b.rank)) {
    byName.set(name, [...(byName.get(name) ?? []), path]);
  }
  return [...byName].map(([name, [path, ...copies]]) => ({ path, name, copies }));
}

function skillPath(path: string): { rank: number; name: string; path: string }[] {
  const rank = SKILL_ROOTS.findIndex((root) => path.startsWith(`${root}/`));
  if (rank < 0) return [];
  const rest = path.slice(SKILL_ROOTS[rank].length + 1).split('/');
  return rest.length === 2 && rest[0] && rest[1] === 'SKILL.md' ? [{ rank, name: rest[0], path }] : [];
}
