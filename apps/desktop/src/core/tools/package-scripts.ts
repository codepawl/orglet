import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path';

/**
 * Package scripts inside the command sandbox (COD-269). The sandbox has only the bundled Node runtime and Windows
 * system tools, so `npm test` used to fail with "not recognized" and, under the hand-in rule, blocked a run whose
 * work was done. The workspace helper puts small `.cmd` shims for node, npm, pnpm, yarn and npx on the command's
 * PATH. The package-manager shims come back into the helper, which runs the working copy's package.json scripts and
 * the binaries already in node_modules/.bin with the bundled Node. Installing or downloading packages is refused
 * with a plain reason: commands have no network.
 */

export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'npx'] as const;
export type PackageManager = typeof PACKAGE_MANAGERS[number];

/** The environment variables the shims read. The helper sets them before it starts a command. */
export const SHIM_RUNTIME_VARIABLE = 'ORGLET_NODE';
export const SHIM_HELPER_VARIABLE = 'ORGLET_HELPER';
export const SHIM_ROOT_VARIABLE = 'ORGLET_WORKSPACE_ROOT';
export const PACKAGE_MANAGER_FLAG = '--package-manager';

type PackageManifest = { name?: unknown; version?: unknown; scripts?: unknown };

export type PackageRequest = {
  manager: PackageManager;
  /** A directory given with --prefix, -C or --dir, relative to where the command runs. */
  directory?: string;
  silent: boolean;
  ifPresent: boolean;
  warnings: string[];
  action:
    | { kind: 'script'; name: string; arguments: string[]; orBinary: boolean }
    | { kind: 'binary'; binary: string; arguments: string[] }
    | { kind: 'list' }
    | { kind: 'version' }
    | { kind: 'refused'; message: string };
};

const INSTALL_COMMANDS = new Set([
  'install', 'i', 'in', 'ins', 'inst', 'insta', 'instal', 'isnt', 'isnta', 'isntal', 'isntall', 'add', 'ci',
  'clean-install', 'install-clean', 'ic', 'install-test', 'it', 'cit', 'update', 'up', 'upgrade', 'udpate',
  'uninstall', 'un', 'unlink', 'remove', 'rm', 'r', 'link', 'ln', 'dlx', 'create', 'init', 'rebuild', 'dedupe',
  'prune', 'audit', 'outdated', 'publish', 'pack', 'import', 'fetch', 'patch', 'patch-commit',
]);
const TEST_ALIASES = new Set(['test', 't', 'tst']);
const RUN_ALIASES = new Set(['run', 'run-script', 'rum', 'urn']);
const EXEC_ALIASES = new Set(['exec', 'x']);
const LIFECYCLE_COMMANDS = new Set(['start', 'stop']);

export function installRefusal(manager: PackageManager, command: string): string {
  return `${manager} ${command}: packages cannot be installed or downloaded here, because commands in Orglet's working copy have no network. Use the packages the copy already has, or ask the person to install them in their own folder.`;
}

function unsupported(manager: PackageManager, command: string): string {
  return `${manager} ${command} is not available in Orglet's working copy. Only package.json scripts (${manager === 'npx' ? 'npm test, npm start, npm run <name>' : `${manager} test, ${manager} start, ${manager} run <name>`}) and binaries already in node_modules/.bin (npx <name>) run here, with the bundled Node and no network.`;
}

/**
 * Reads a package-manager command line into what to run. It follows each manager where they differ: npm keeps an
 * unknown --flag before `--` for itself, pnpm and yarn hand every later argument to the script, and pnpm and yarn run
 * a script or a binary named directly (`pnpm vitest`).
 */
export function parsePackageCommand(manager: PackageManager, raw: readonly string[]): PackageRequest {
  const request: PackageRequest = { manager, silent: false, ifPresent: false, warnings: [], action: { kind: 'list' } };
  const words = [...raw];
  while (words.length > 0 && words[0].startsWith('-') && words[0] !== '--') {
    const option = words.shift()!;
    if (option === '-v' || option === '--version') {
      request.action = { kind: 'version' };
      return request;
    }
    if (option === '-s' || option === '--silent' || option === '--loglevel=silent') request.silent = true;
    else if (option === '--if-present') request.ifPresent = true;
    else if (option === '--prefix' || option === '-C' || option === '--dir') request.directory = words.shift();
    else if (option.startsWith('--prefix=') || option.startsWith('--dir=')) request.directory = option.slice(option.indexOf('=') + 1);
    else if (option === '-y' || option === '--yes' || option === '--no' || option === '--no-install' || option === '-q' || option === '--quiet') continue;
    else if (option === '-p' || option === '--package') words.shift();
    else if (option.startsWith('--package=')) continue;
    else if (option === '-r' || option === '--recursive' || option === '-w' || option === '--workspace-root' || option === '--filter' || option.startsWith('--filter=') || option === '--workspaces' || option === '-ws') {
      request.action = { kind: 'refused', message: `${manager} ${option}: runs across a whole workspace are not supported here. Change into the package's folder and run its script there.` };
      return request;
    } else request.warnings.push(`${manager}: ignoring option ${option}`);
  }
  if (words[0] === '--') words.shift();
  if (manager === 'npx') {
    const binary = words.shift();
    request.action = binary ? { kind: 'binary', binary, arguments: words } : { kind: 'refused', message: 'npx needs the name of a binary from node_modules/.bin.' };
    return request;
  }
  const command = words.shift();
  if (command === undefined) {
    request.action = manager === 'yarn' ? { kind: 'refused', message: installRefusal(manager, 'install') } : { kind: 'list' };
    return request;
  }
  if (INSTALL_COMMANDS.has(command)) {
    request.action = { kind: 'refused', message: installRefusal(manager, command) };
    return request;
  }
  if (EXEC_ALIASES.has(command)) {
    const rest = words[0] === '--' ? words.slice(1) : words;
    const binary = rest.shift();
    request.action = binary ? { kind: 'binary', binary, arguments: rest } : { kind: 'refused', message: `${manager} ${command} needs the name of a binary from node_modules/.bin.` };
    return request;
  }
  let name: string;
  let orBinary = false;
  if (TEST_ALIASES.has(command)) name = 'test';
  else if (LIFECYCLE_COMMANDS.has(command)) name = command;
  else if (RUN_ALIASES.has(command)) {
    while (words.length > 0 && words[0].startsWith('-') && words[0] !== '--') {
      const option = words.shift()!;
      if (option === '--if-present') request.ifPresent = true;
      else if (option === '-s' || option === '--silent') request.silent = true;
      else request.warnings.push(`${manager}: ignoring option ${option}`);
    }
    const scriptName = words.shift();
    if (scriptName === undefined) {
      request.action = { kind: 'list' };
      return request;
    }
    name = scriptName;
    orBinary = manager !== 'npm';
  } else if (manager === 'npm') {
    request.action = { kind: 'refused', message: unsupported(manager, command) };
    return request;
  } else {
    name = command;
    orBinary = true;
  }
  request.action = { kind: 'script', name, arguments: scriptArguments(request, words), orBinary };
  return request;
}

/** npm keeps --flags before `--` as its own settings (and warns); pnpm and yarn pass everything on. */
function scriptArguments(request: PackageRequest, words: string[]): string[] {
  if (request.manager !== 'npm') return words[0] === '--' ? words.slice(1) : words;
  const separator = words.indexOf('--');
  const before = separator === -1 ? words : words.slice(0, separator);
  const after = separator === -1 ? [] : words.slice(separator + 1);
  const kept: string[] = [];
  for (const word of before) {
    if (word === '--if-present') request.ifPresent = true;
    else if (word === '-s' || word === '--silent') request.silent = true;
    else if (word.startsWith('-')) request.warnings.push(`npm: ${word} is read by npm, not passed to the script. Put it after -- to pass it (npm test -- ${word}).`);
    else kept.push(word);
  }
  return [...kept, ...after];
}

/** Quotes one argument for cmd.exe the way a person would type it. */
export function quoteForCmd(argument: string): string {
  if (/^[\w\-.,/\\:=@+]+$/.test(argument)) return argument;
  return `"${argument.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

export function scriptCommandLine(script: string, extraArguments: readonly string[]): string {
  return [script, ...extraArguments.map(quoteForCmd)].join(' ');
}

/** The nearest package.json at or above the directory, never above the working copy's root. */
export function findPackageDirectory(start: string, root: string | undefined): string | null {
  let current = resolve(start);
  for (;;) {
    if (existsSync(join(current, 'package.json'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    if (root && !isInside(root, parent)) return null;
    current = parent;
  }
}

function isInside(root: string, path: string): boolean {
  const offset = relative(resolve(root), resolve(path));
  return offset === '' || (!offset.startsWith('..') && !isAbsolute(offset));
}

/** Every node_modules/.bin from the package up to the working copy's root, nearest first, as npm puts them on PATH. */
export function binaryDirectories(packageDirectory: string, root: string | undefined): string[] {
  const directories: string[] = [];
  let current = resolve(packageDirectory);
  for (;;) {
    directories.push(join(current, 'node_modules', '.bin'));
    const parent = dirname(current);
    if (parent === current || (root && !isInside(root, parent))) return directories;
    current = parent;
  }
}

function findBinary(name: string, packageDirectory: string, root: string | undefined): string | null {
  if (/[\\/]/.test(name)) return null;
  for (const directory of binaryDirectories(packageDirectory, root)) {
    for (const candidate of [`${name}.cmd`, `${name}.exe`, `${name}.bat`]) {
      const path = join(directory, candidate);
      if (existsSync(path)) return path;
    }
  }
  return null;
}

function readManifest(directory: string): { name?: string; version?: string; scripts: Record<string, string> } {
  const parsed = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as PackageManifest;
  const scripts: Record<string, string> = {};
  if (parsed.scripts && typeof parsed.scripts === 'object') {
    for (const [key, value] of Object.entries(parsed.scripts as Record<string, unknown>)) {
      if (typeof value === 'string') scripts[key] = value;
    }
  }
  return {
    name: typeof parsed.name === 'string' ? parsed.name : undefined,
    version: typeof parsed.version === 'string' ? parsed.version : undefined,
    scripts,
  };
}

/** The shims written into the command's temporary folder. Batch files keep CRLF line ends. */
export function shimFiles(): Record<string, string> {
  const files: Record<string, string> = { 'node.cmd': `@"%${SHIM_RUNTIME_VARIABLE}%" %*\r\n` };
  for (const manager of PACKAGE_MANAGERS) {
    files[`${manager}.cmd`] = `@"%${SHIM_RUNTIME_VARIABLE}%" "%${SHIM_HELPER_VARIABLE}%" ${PACKAGE_MANAGER_FLAG} ${manager} %*\r\n`;
  }
  return files;
}

export function writeShims(directory: string): string {
  mkdirSync(directory, { recursive: true });
  for (const [name, content] of Object.entries(shimFiles())) writeFileSync(join(directory, name), content);
  return directory;
}

/** Puts the shims first on PATH and tells them where the runtime, the helper and the working copy are. */
export function toolchainEnvironment(base: NodeJS.ProcessEnv, options: { runtime: string; helper: string; root: string; shims: string }): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  let path = '';
  for (const [key, value] of Object.entries(base)) {
    if (key.toUpperCase() === 'PATH') path = value ?? '';
    else environment[key] = value;
  }
  environment.PATH = [options.shims, path].filter(Boolean).join(';');
  environment.PATHEXT = '.COM;.EXE;.BAT;.CMD';
  environment[SHIM_RUNTIME_VARIABLE] = options.runtime;
  environment[SHIM_HELPER_VARIABLE] = options.helper;
  environment[SHIM_ROOT_VARIABLE] = options.root;
  return environment;
}

type RunOptions = {
  cwd: string;
  environment: NodeJS.ProcessEnv;
  write: (stream: 'stdout' | 'stderr', text: string) => void;
  run: (commandLine: string, cwd: string, environment: NodeJS.ProcessEnv) => Promise<number>;
};

/** Runs one package-manager command and returns its exit code. */
export async function runPackageCommand(manager: PackageManager, raw: readonly string[], options: RunOptions): Promise<number> {
  const request = parsePackageCommand(manager, raw);
  for (const warning of request.warnings) options.write('stderr', `${warning}\n`);
  const action = request.action;
  if (action.kind === 'version') {
    options.write('stdout', '0.0.0-orglet\n');
    options.write('stderr', `${manager} in Orglet's working copy runs package.json scripts with the bundled Node ${process.version}; it cannot install packages.\n`);
    return 0;
  }
  if (action.kind === 'refused') {
    options.write('stderr', `${action.message}\n`);
    return 1;
  }
  const root = options.environment[SHIM_ROOT_VARIABLE];
  const start = request.directory ? resolve(options.cwd, request.directory) : options.cwd;
  const packageDirectory = findPackageDirectory(start, root);
  if (action.kind === 'binary') return runBinary(manager, action.binary, action.arguments, packageDirectory ?? start, options);
  if (!packageDirectory) {
    options.write('stderr', `${manager}: no package.json in ${start} or any folder above it in the working copy.\n`);
    return 1;
  }
  let manifest: ReturnType<typeof readManifest>;
  try { manifest = readManifest(packageDirectory); }
  catch (error) {
    options.write('stderr', `${manager}: could not read ${join(packageDirectory, 'package.json')}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  if (action.kind === 'list') {
    const names = Object.keys(manifest.scripts);
    options.write('stdout', names.length === 0 ? 'No scripts in package.json.\n' : `Scripts in package.json:\n${names.map(name => `  ${name}\n    ${manifest.scripts[name]}\n`).join('')}`);
    return 0;
  }
  let script = manifest.scripts[action.name];
  if (script === undefined && action.name === 'start' && existsSync(join(packageDirectory, 'server.js'))) script = 'node server.js';
  if (script === undefined) {
    if (action.orBinary && findBinary(action.name, packageDirectory, root)) return runBinary(manager, action.name, action.arguments, packageDirectory, options);
    if (request.ifPresent) return 0;
    const names = Object.keys(manifest.scripts);
    options.write('stderr', `${manager} error: Missing script: "${action.name}"${names.length > 0 ? `. Scripts in package.json: ${names.join(', ')}` : ''}\n`);
    return 1;
  }
  // npm runs pre<name> and post<name> around every script; pnpm and yarn run only the one named.
  const events = manager === 'npm' ? [`pre${action.name}`, action.name, `post${action.name}`] : [action.name];
  const scripts = { ...manifest.scripts, [action.name]: script };
  return runSteps(manager, request, { ...manifest, scripts }, packageDirectory, events, action.name, action.arguments, options);
}

async function runSteps(manager: PackageManager, request: PackageRequest, manifest: ReturnType<typeof readManifest>,
  packageDirectory: string, events: string[], main: string, extraArguments: string[], options: RunOptions): Promise<number> {
  const root = options.environment[SHIM_ROOT_VARIABLE];
  for (const event of events) {
    const script = manifest.scripts[event];
    if (script === undefined) continue;
    const commandLine = event === main ? scriptCommandLine(script, extraArguments) : script;
    if (!request.silent) {
      const label = [manifest.name ? `${manifest.name}${manifest.version ? `@${manifest.version}` : ''}` : '', event].filter(Boolean).join(' ');
      options.write('stdout', `\n> ${label}\n> ${commandLine}\n\n`);
    }
    const environment = scriptEnvironment(manager, options.environment, {
      event, script: commandLine, packageDirectory, root, initialDirectory: options.cwd, manifest,
    });
    const code = await options.run(commandLine, packageDirectory, environment);
    if (code !== 0) return code;
  }
  return 0;
}

async function runBinary(manager: PackageManager, name: string, extraArguments: string[], packageDirectory: string, options: RunOptions): Promise<number> {
  const root = options.environment[SHIM_ROOT_VARIABLE];
  if (name === 'node') return options.run(scriptCommandLine('node', extraArguments), options.cwd, options.environment);
  const binary = findBinary(name, packageDirectory, root);
  if (!binary) {
    options.write('stderr', `${manager}: ${name} is not in node_modules/.bin of this working copy, and it cannot be downloaded because commands have no network.\n`);
    return 1;
  }
  const environment = scriptEnvironment(manager, options.environment, { packageDirectory, root, initialDirectory: options.cwd });
  return options.run(scriptCommandLine(quoteForCmd(binary), extraArguments), options.cwd, environment);
}

function scriptEnvironment(manager: PackageManager, base: NodeJS.ProcessEnv, context: {
  event?: string; script?: string; packageDirectory: string; root: string | undefined; initialDirectory: string;
  manifest?: ReturnType<typeof readManifest>;
}): NodeJS.ProcessEnv {
  const runtime = base[SHIM_RUNTIME_VARIABLE] ?? process.execPath;
  const environment: NodeJS.ProcessEnv = {
    ...base,
    PATH: [...binaryDirectories(context.packageDirectory, context.root), base.PATH].filter(Boolean).join(';'),
    INIT_CWD: context.initialDirectory,
    NODE: runtime,
    npm_node_execpath: runtime,
    npm_config_user_agent: `${manager === 'npx' ? 'npm' : manager}/0.0.0-orglet node/${process.version} ${process.platform} ${process.arch}`,
  };
  if (context.event !== undefined) environment.npm_lifecycle_event = context.event;
  if (context.script !== undefined) environment.npm_lifecycle_script = context.script;
  if (context.manifest) {
    environment.npm_package_json = join(context.packageDirectory, 'package.json');
    if (context.manifest.name) environment.npm_package_name = context.manifest.name;
    if (context.manifest.version) environment.npm_package_version = context.manifest.version;
  }
  return environment;
}

/** Runs a script line in cmd.exe with its output going straight to the command's own output. */
export function runInCmd(commandLine: string, cwd: string, environment: NodeJS.ProcessEnv): Promise<number> {
  const systemRoot = environment.SystemRoot ?? process.env.SystemRoot ?? 'C:\\Windows';
  return new Promise(resolvePromise => {
    const child = spawn(commandLine, { shell: win32.join(systemRoot, 'System32', 'cmd.exe'), cwd, env: environment, windowsHide: true, stdio: 'inherit' });
    child.once('error', error => {
      process.stderr.write(`${error.message}\n`);
      resolvePromise(1);
    });
    child.once('close', code => resolvePromise(code ?? 1));
  });
}

export function isPackageManager(value: string | undefined): value is PackageManager {
  return (PACKAGE_MANAGERS as readonly string[]).includes(value ?? '');
}
