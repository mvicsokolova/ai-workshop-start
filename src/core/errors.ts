/** A failure explained to the user: the CLI prints the message and exits with code 1. */
export class AtlasError extends Error {}

/** GitHub's rate limit ran out: nothing more can be read, so an organization's scan stops too. */
export class RateLimitError extends AtlasError {}
