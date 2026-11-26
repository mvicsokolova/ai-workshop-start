// Loaded with `node --import` before the CLI: GitHub answers from the recording in SKILL_ATLAS_RECORDING.
import { readFileSync } from 'node:fs';
import { replay } from '../src/core/replay.ts';

globalThis.fetch = replay(JSON.parse(readFileSync(process.env.SKILL_ATLAS_RECORDING!, 'utf8'))) as typeof fetch;
