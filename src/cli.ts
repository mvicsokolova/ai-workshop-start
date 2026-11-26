#!/usr/bin/env node
// The Node client: a GitHub repository or organization through the GitHub API, or a local
// directory; stdout and stderr. Nothing is stored.
import { count, run } from './commands.ts';
import { openInput } from './local.ts';
import type { Catalog } from './web/catalog.ts';
import { exportSite } from './web/export.ts';
import { startServer } from './web/server.ts';

const token = process.env.GITHUB_TOKEN || undefined;
const open = (input: string) => openInput(input, { fetch, token });
/** The website shows each skill's other files, such as OWNERSHIP: it needs every file. */
const openEveryFile = (input: string) => openInput(input, { fetch, token, everyFile: true });

/** `<repo> · N skills`; `<org> · N skills in M repositories`. */
const summary = ({ kind, repository, skills, repositories }: Catalog) =>
  `${repository.id} · ${count(skills.length, 'skill', 'skills')}${
    kind === 'organization' ? ` in ${count(repositories.length, 'repository', 'repositories')}` : ''
  }`;

process.exitCode = await run(process.argv.slice(2), {
  open,
  print: (text) => console.log(text),
  error: (text) => console.error(text),
  async export(input, directory) {
    const { catalog, files } = await exportSite(await openEveryFile(input), directory);
    console.log(`${summary(catalog)} → ${directory}`);
    console.log(`  ${files.join(', ')}`);
    for (const warning of catalog.warnings) console.error(`warning: ${warning}`);
  },
  async serve(input, port) {
    console.error(`Scanning ${input}…`);
    const server = await startServer({ input, open: openEveryFile, port });
    console.log(`${summary(server.catalog())} at ${server.url}`);
    console.error('Press Ctrl+C to stop.');
    // Runs until stopped.
    await new Promise<void>((resolve) => {
      for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => server.close().then(resolve));
    });
  },
});
