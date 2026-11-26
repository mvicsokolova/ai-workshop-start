// The skill-atlas commands. The same code serves the Node CLI and the browser
// terminal: everything that differs between them comes in through the context.
import { AtlasError } from './core/errors.ts';
import { skillLink, type Repository, type Skill } from './core/model.ts';
import { scan, type Source } from './core/scan.ts';

export type Context = {
  /** Opens what the user asked to scan. */
  open(input: string): Promise<Source>;
  print(text: string): void;
  /** Errors and warnings. */
  error(text: string): void;
  /** Serves the catalog as a website until stopped; only where a server can run, in Node. */
  serve?(input: string, port: number): Promise<void>;
  /** Writes the website as static files into the directory; only in Node. */
  export?(input: string, directory: string): Promise<void>;
};

export const DEFAULT_PORT = 4173;

const usage = `Usage: skill-atlas <command>

  scan <GitHub URL | directory>   find every SKILL.md in a repository and print it
  serve <GitHub URL | directory>  browse them in a local website  [--port <n>, default ${DEFAULT_PORT}]
  export <GitHub URL | directory> <out directory>
                                  the website as static files, for GitHub Pages or any host
  help                            show this help`;

/** Runs one command; returns its exit code. */
export async function run(args: string[], context: Context): Promise<number> {
  const [command = 'help', ...rest] = args;
  try {
    if (command === 'scan') await scanCommand(rest, context);
    else if (command === 'serve') await serveCommand(rest, context);
    else if (command === 'export') await exportCommand(rest, context);
    else if (command === 'help') context.print(usage);
    else throw new AtlasError(`Unknown command: ${command}\n\n${usage}`);
    return 0;
  } catch (error) {
    if (!(error instanceof AtlasError)) throw error;
    context.error(error.message);
    return 1;
  }
}

async function scanCommand(args: string[], context: Context) {
  if (args.length !== 1) throw new AtlasError('Usage: skill-atlas scan <GitHub URL | directory>');
  const result = await scan(await context.open(args[0]));
  printRepository(result.repository, result.skills, context);
  for (const warning of result.warnings) context.error(`warning: ${warning}`);
}

const serveUsage = 'Usage: skill-atlas serve <GitHub URL | directory> [--port <n>]';

async function serveCommand(args: string[], context: Context) {
  let port = DEFAULT_PORT;
  const inputs: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const value = arg === '--port' ? args[++index] : arg.startsWith('--port=') ? arg.slice('--port='.length) : undefined;
    if (value !== undefined) {
      if (!/^\d+$/.test(value) || Number(value) > 65535) throw new AtlasError(`Not a port: ${value}\n${serveUsage}`);
      port = Number(value);
    } else if (arg === '--port') throw new AtlasError(`--port needs a number\n${serveUsage}`);
    else if (arg.startsWith('--')) throw new AtlasError(`Unknown option: ${arg}\n${serveUsage}`);
    else inputs.push(arg);
  }
  if (inputs.length !== 1) throw new AtlasError(serveUsage);
  if (!context.serve) throw new AtlasError('serve runs only in the command line: ./skill-atlas serve <GitHub URL | directory>');
  await context.serve(inputs[0], port);
}

async function exportCommand(args: string[], context: Context) {
  if (args.length !== 2 || args.some((arg) => arg.startsWith('--'))) {
    throw new AtlasError('Usage: skill-atlas export <GitHub URL | directory> <out directory>');
  }
  if (!context.export) {
    throw new AtlasError('export runs only in the command line: ./skill-atlas export <GitHub URL | directory> <out directory>');
  }
  await context.export(args[0], args[1]);
}

/** `<owner>/<repo> · N skills`, then each skill's name, first sentence and link. */
function printRepository(repository: Repository, skills: Skill[], { print }: Context) {
  print(`${repository.id} · ${skills.length} ${skills.length === 1 ? 'skill' : 'skills'}`);
  for (const skill of skills) {
    print(skill.description ? `${skill.name} — ${firstSentence(skill.description)}` : skill.name);
    print(`  ${skillLink(repository, skill)}`);
    if (skill.copies.length > 0) print(`  also in ${skill.copies.join(', ')}`);
  }
}

function firstSentence(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return /^.*?[.!?](?=\s|$)/.exec(line)?.[0] ?? line;
}
