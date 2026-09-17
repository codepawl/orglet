// Lists Vietnamese source texts that need an English entry in apps/desktop/src/shared/locales/en.ts.
// Sources: t('...') keys in the renderer, Vietnamese constants in the renderer, and Vietnamese messages in the
// core, main process and shared code (template literals become {0}, {1} patterns).
// node scripts/i18n-keys.cjs            → prints missing keys as JSON
// node scripts/i18n-keys.cjs --unused   → also prints English entries no longer used
const ts = loadTypeScriptCompilerApi();

// The project compiles with TypeScript 7, which has no JavaScript compiler API. The 5.x copy that Electron Forge
// installs has one; where it lives depends on the pnpm node-linker (hoisted in CI and fresh clones, isolated in older
// local installs).
function loadTypeScriptCompilerApi() {
  const root = require('path').join(__dirname, '..', 'node_modules');
  const candidates = [
    require('path').join(root, '@electron-forge', 'template-webpack-typescript', 'node_modules', 'typescript'),
    require('path').join(root, '.pnpm', 'typescript@5.4.5', 'node_modules', 'typescript'),
    'typescript',
  ];
  for (const candidate of candidates) {
    try {
      const compiler = require(candidate);
      if (typeof compiler.createSourceFile === 'function') return compiler;
    } catch {
      // Not installed at this location; try the next one.
    }
  }
  throw new Error('No TypeScript 5.x compiler API found. Run pnpm install.');
}
const fs = require('fs'), path = require('path');

const src = path.join(__dirname, '..', 'apps', 'desktop', 'src');
const vietnamese = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]/;
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);

const keys = new Set();
for (const file of walk(src).filter(file => /\.tsx?$/.test(file) && !file.includes(`${path.sep}locales${path.sep}`))) {
  const source = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  // Labels shown through t() at render time may have no diacritics ("Chung"), so collect them by where they live.
  const collectStrings = node => { if (ts.isStringLiteralLike(node)) keys.add(node.text); ts.forEachChild(node, collectStrings); };
  const visit = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'translated') collectStrings(node);
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && /(tabs|labels|mascots)$/i.test(node.name.text) && node.initializer) {
      const labelValues = child => { if (ts.isPropertyAssignment(child) && ((ts.isIdentifier(child.name) && ['label', 'name'].includes(child.name.text)) || /labels$/i.test(node.name.text)) && ts.isStringLiteralLike(child.initializer)) keys.add(child.initializer.text); ts.forEachChild(child, labelValues); };
      labelValues(node.initializer);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't' && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) keys.add(node.arguments[0].text);
    else if (ts.isStringLiteralLike(node) && vietnamese.test(node.text)) keys.add(node.text);
    else if (ts.isTemplateExpression(node)) {
      const key = node.head.text + node.templateSpans.map((span, index) => `{${index}}${span.literal.text}`).join('');
      if (vietnamese.test(key)) keys.add(key);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

const enFile = path.join(src, 'shared', 'locales', 'en.ts');
const existing = fs.existsSync(enFile) ? fs.readFileSync(enFile, 'utf8') : '';
const defined = new Set();
if (existing) {
  const sf = ts.createSourceFile(enFile, existing, ts.ScriptTarget.Latest, true);
  const visit = node => { if (ts.isPropertyAssignment(node) && ts.isStringLiteralLike(node.name)) defined.add(node.name.text); ts.forEachChild(node, visit); };
  visit(sf);
}
const missing = [...keys].filter(key => !defined.has(key)).sort();
console.log(JSON.stringify(missing, null, 1));
console.error(`${keys.size} keys, ${defined.size} translated, ${missing.length} missing`);
if (process.argv.includes('--unused')) console.error('Unused:', JSON.stringify([...defined].filter(key => !keys.has(key)), null, 1));
process.exitCode = missing.length ? 1 : 0;
