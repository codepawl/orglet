// Opens every story of the static gallery (`build-storybook` first) in headless Chromium, in the light and the dark
// theme, and fails when a story does not render, throws, logs an error, or has an axe violation of WCAG 2.2 A or AA.
// A story whose `a11y` parameter says `test: 'todo'` has its violations listed as known issues rather than failures.
//
//   node scripts/check-stories.mjs                         every story, both themes
//   node scripts/check-stories.mjs --screenshots <folder>  also save a picture of each, at 1280 and 740 wide
//   node scripts/check-stories.mjs --only select           only stories whose id contains "select"
//
// Storybook's own Vitest runner needs Vitest 3 or 4 and this repository runs Vitest 5, so the gallery is checked here
// with the same axe-core the accessibility panel uses.
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const packageFolder = fileURLToPath(new URL('..', import.meta.url));
const staticFolder = join(packageFolder, 'storybook-static');
const axeScript = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
const themes = ['light', 'dark'];
const screenshotWidths = [1280, 740];
const wcagTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const renderTimeoutMs = 15_000;

function readOptions(argumentsList) {
  const options = { screenshotFolder: undefined, only: undefined };
  for (let index = 0; index < argumentsList.length; index += 1) {
    if (argumentsList[index] === '--screenshots') options.screenshotFolder = resolve(argumentsList[++index]);
    else if (argumentsList[index] === '--only') options.only = argumentsList[++index];
  }
  return options;
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
};

/** A tiny static server for the build, on a free local port. */
function serveStaticFolder(folder) {
  const server = createServer((request, response) => {
    const requestPath = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const filePath = normalize(join(folder, requestPath === '/' ? 'index.html' : requestPath));
    if (!filePath.startsWith(folder) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { 'content-type': contentTypes[extname(filePath)] ?? 'application/octet-stream' });
    createReadStream(filePath).pipe(response);
  });
  return new Promise(resolveServer => {
    server.listen(0, '127.0.0.1', () => resolveServer(server));
  });
}

/** Waits until Storybook has rendered the story and run its play function, or says why it could not. */
async function waitForStory(page) {
  await page.waitForFunction(() => {
    const phase = window.__STORYBOOK_PREVIEW__?.currentRender?.phase;
    const errorShown = document.body.classList.contains('sb-show-errordisplay');
    return errorShown || ['completed', 'finished', 'errored', 'aborted'].includes(phase);
  }, undefined, { timeout: renderTimeoutMs });
  return page.evaluate(() => ({
    phase: window.__STORYBOOK_PREVIEW__?.currentRender?.phase,
    errorShown: document.body.classList.contains('sb-show-errordisplay'),
    errorText: document.querySelector('#error-message')?.textContent?.trim(),
  }));
}

async function openStory(page, storyUrl, width) {
  await page.setViewportSize({ width, height: 800 });
  await page.goto(storyUrl);
  const state = await waitForStory(page);
  // Let entrance animations settle so axe reads final colours and a picture shows the resting state.
  await page.waitForTimeout(350);
  return state;
}

async function checkStory(page, baseUrl, story, theme, options) {
  const problems = [];
  const knownIssues = [];
  const consoleErrors = [];
  const onConsole = message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  };
  const onPageError = error => consoleErrors.push(error.message);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  try {
    const storyUrl = `${baseUrl}/iframe.html?id=${story.id}&viewMode=story&globals=theme:${theme}`;
    const state = await openStory(page, storyUrl, screenshotWidths[0]);
    if (state.errorShown || state.phase === 'errored' || state.phase === 'aborted') {
      problems.push(`did not render (${state.phase}): ${state.errorText ?? 'no message'}`);
      return { problems, knownIssues };
    }
    const screenshotPath = width => join(options.screenshotFolder, `${story.id}--${theme}--${width}.png`);
    if (options.screenshotFolder) await page.screenshot({ path: screenshotPath(screenshotWidths[0]), fullPage: true });
    await page.addScriptTag({ path: axeScript });
    // A story's `a11y` parameters mean what they mean in the accessibility panel: `config` goes to `axe.configure`,
    // `options` (such as a rule turned off) to `axe.run`, and `test: 'todo'` lists violations as known issues.
    const { violations, test } = await page.evaluate(async tags => {
      const accessibility = window.__STORYBOOK_PREVIEW__?.currentRender?.story?.parameters?.a11y ?? {};
      if (accessibility.test === 'off') return { violations: [], test: 'off' };
      if (accessibility.config) window.axe.configure(accessibility.config);
      const result = await window.axe.run(document, { runOnly: { type: 'tag', values: tags }, ...accessibility.options });
      return {
        test: accessibility.test ?? 'error',
        violations: result.violations.map(violation => ({
          id: violation.id,
          help: violation.help,
          targets: violation.nodes.slice(0, 3).map(node => node.target.join(' ')),
        })),
      };
    }, wcagTags);
    for (const violation of violations) {
      const line = `axe ${violation.id}: ${violation.help} (${violation.targets.join(', ')})`;
      if (test === 'todo') knownIssues.push(line);
      else problems.push(line);
    }
    // Each further width is a fresh load, not a resize: an open menu closes on resize, as it should.
    if (options.screenshotFolder) {
      for (const width of screenshotWidths.slice(1)) {
        await openStory(page, storyUrl, width);
        await page.screenshot({ path: screenshotPath(width), fullPage: true });
      }
    }
  } catch (error) {
    problems.push(`check failed: ${error.message.split('\n')[0]}`);
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }
  for (const text of consoleErrors) problems.push(`console error: ${text.split('\n')[0]}`);
  return { problems, knownIssues };
}

async function main() {
  const options = readOptions(process.argv.slice(2));
  if (!existsSync(join(staticFolder, 'index.json'))) {
    console.error('No static build found. Run `pnpm --filter @codepawl/orglet-ui build-storybook` first.');
    process.exit(1);
  }
  if (options.screenshotFolder) mkdirSync(options.screenshotFolder, { recursive: true });
  const index = JSON.parse(readFileSync(join(staticFolder, 'index.json'), 'utf8'));
  const stories = Object.values(index.entries)
    .filter(entry => entry.type === 'story')
    .filter(entry => !options.only || entry.id.includes(options.only));

  const server = await serveStaticFolder(staticFolder);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ reducedMotion: 'no-preference' });
  let failures = 0;
  try {
    for (const story of stories) {
      for (const theme of themes) {
        const { problems, knownIssues } = await checkStory(page, baseUrl, story, theme, options);
        if (knownIssues.length > 0) {
          console.log(`KNOWN ${story.id} (${theme})`);
          for (const issue of knownIssues) console.log(`  ${issue}`);
        }
        if (problems.length === 0) continue;
        failures += 1;
        console.log(`FAIL ${story.id} (${theme})`);
        for (const problem of problems) console.log(`  ${problem}`);
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`${stories.length} stories, ${themes.length} themes: ${failures === 0 ? 'all passed' : `${failures} failed`}`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
