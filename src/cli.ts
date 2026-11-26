#!/usr/bin/env node
// The Node client: a GitHub repository through the GitHub API, or a local directory; stdout and
// stderr. Nothing is stored.
import { run } from './commands.ts';
import { openGitHub, parseGitHubUrl } from './core/github.ts';
import { openDirectory } from './local.ts';
import { exportSite } from './web/export.ts';
import { startServer } from './web/server.ts';

const token = process.env.GITHUB_TOKEN || undefined;
const open = (input: string) => (parseGitHubUrl(input) ? openGitHub(input, { fetch, token }) : openDirectory(input));
/** The website shows each skill's other files, such as OWNERSHIP: it needs every file. */
const openEveryFile = (input: string) =>
  parseGitHubUrl(input) ? openGitHub(input, { fetch, token, everyFile: true }) : openDirectory(input);

process.exitCode = await run(process.argv.slice(2), {
  open,
  print: (text) => console.log(text),
  error: (text) => console.error(text),
  async export(input, directory) {
    const { catalog, files } = await exportSite(await openEveryFile(input), directory);
    const { repository, skills } = catalog;
    console.log(`${repository.id} · ${skills.length} ${skills.length === 1 ? 'skill' : 'skills'} → ${directory}`);
    console.log(`  ${files.join(', ')}`);
    for (const warning of catalog.warnings) console.error(`warning: ${warning}`);
  },
  async serve(input, port) {
    console.error(`Scanning ${input}…`);
    const server = await startServer({ input, open: openEveryFile, port });
    const { repository, skills } = server.catalog();
    console.log(`${repository.id} · ${skills.length} ${skills.length === 1 ? 'skill' : 'skills'} at ${server.url}`);
    console.error('Press Ctrl+C to stop.');
    // Runs until stopped.
    await new Promise<void>((resolve) => {
      for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close().then(resolve));
    });
  },
});
