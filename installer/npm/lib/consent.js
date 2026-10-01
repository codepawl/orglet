/*
 * When the installer may download and run Setup. A person at a terminal is asked; `--yes` (or `-y`) answers for them.
 * Without a terminal (CI, a pipe, another program) nobody can answer, so silence is not taken as yes: Setup runs only
 * when the caller passed `--yes`.
 */

/** `yes` to install now, `ask` to prompt the person, `refuse` when nobody can answer and `--yes` was not given. */
export function installConsent(argv, interactive) {
  if (argv.includes('--yes') || argv.includes('-y')) return 'yes';
  return interactive ? 'ask' : 'refuse';
}
