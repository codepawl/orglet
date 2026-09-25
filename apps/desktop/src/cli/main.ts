import { EXIT_CODES } from './protocol';
import { runCli, type Output } from './run';

/** The bundled `orglet-cli.cjs` starts here; `run.ts` holds everything the tests exercise. */
async function main(): Promise<void> {
  const output: Output = {
    stdout: text => process.stdout.write(`${text}\n`),
    stderr: text => process.stderr.write(`${text}\n`),
  };
  try {
    process.exitCode = await runCli(process.argv.slice(2), output);
  } catch (error) {
    output.stderr(error instanceof Error ? error.message : String(error));
    process.exitCode = EXIT_CODES.failure;
  }
}

void main();
