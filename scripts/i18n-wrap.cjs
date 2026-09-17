// Wraps user-facing Vietnamese text in the renderer with t(): string literals, template literals (placeholders
// become {0}, {1} params) and JSX text runs. Run from the repo root: node scripts/i18n-wrap.cjs [--dry]
// Innermost text is wrapped first; the file is re-parsed until nothing is left, so nested strings are handled.
// TypeScript 7 in this repo is native and has no JS API; use the 5.x compiler kept in the pnpm store.
const ts = require(require('path').join(__dirname, '..', 'node_modules', '.pnpm', 'typescript@5.4.5', 'node_modules', 'typescript'));
const fs = require('fs'), path = require('path');

const root = path.join(__dirname, '..', 'apps', 'desktop', 'src', 'renderer');
const skipFiles = new Set(['i18n.ts', 'api.ts']);
const vietnamese = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴÈÉẸẺẼÊỀẾỆỂỄÌÍỊỈĨÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠÙÚỤỦŨƯỪỨỰỬỮỲÝỴỶỸĐ]/;
const dry = process.argv.includes('--dry');
const quote = text => `'${text.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n')}'`;

const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]);
const isTCall = node => node && ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't';
const insideFunction = node => { for (let parent = node.parent; parent; parent = parent.parent) if (ts.isFunctionLike(parent)) return true; return false; };

const report = { files: 0, edits: 0, moduleLevel: [] };
for (const file of walk(root).filter(file => /\.tsx?$/.test(file) && !skipFiles.has(path.basename(file)))) {
  let source = fs.readFileSync(file, 'utf8');
  let changed = false;
  for (let pass = 0; pass < 20; pass++) {
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const text = node => source.slice(node.getStart(sf), node.getEnd());
    const candidates = [];
    // Returns true if the subtree contains text that still needs wrapping.
    const needs = node => {
      let found = false;
      const visit = child => { if (found) return; if (isCandidate(child)) { found = true; return; } ts.forEachChild(child, visit); };
      ts.forEachChild(node, visit);
      return found;
    };
    const isCandidate = node => {
      // Module-level constants are evaluated once; they stay Vietnamese and are translated where they are shown.
      if (!ts.isJsxText(node) && !insideFunction(node)) return false;
      if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && vietnamese.test(node.text)) {
        if (isTCall(node.parent) || ts.isImportDeclaration(node.parent) || ts.isLiteralTypeNode(node.parent)) return false;
        if (node.parent && (ts.isPropertyAssignment(node.parent) || ts.isPropertySignature(node.parent)) && node.parent.name === node) return false;
        return true;
      }
      if (ts.isTemplateExpression(node)) return vietnamese.test(node.head.text + node.templateSpans.map(span => span.literal.text).join(''));
      if (ts.isJsxText(node)) return vietnamese.test(node.text);
      return false;
    };
    const visit = node => {
      if (ts.isJsxElement(node) || ts.isJsxFragment(node)) {
        // Group JSX text with adjacent simple expressions into one sentence.
        let run = [];
        const flush = () => {
          if (run.some(child => ts.isJsxText(child) && vietnamese.test(child.text)) && !run.some(child => ts.isJsxExpression(child) && child.expression && needs(child))) candidates.push({ kind: 'jsx', nodes: run });
          run = [];
        };
        for (const child of node.children) {
          const simpleExpression = ts.isJsxExpression(child) && child.expression && !containsJsx(child.expression);
          if (ts.isJsxText(child) || simpleExpression) run.push(child); else flush();
        }
        flush();
      }
      if (isCandidate(node) && !ts.isJsxText(node) && !needs(node)) candidates.push({ kind: 'literal', node });
      ts.forEachChild(node, visit);
    };
    const containsJsx = node => { let found = false; const check = child => { if (found) return; if (ts.isJsxElement(child) || ts.isJsxSelfClosingElement(child) || ts.isJsxFragment(child)) found = true; else ts.forEachChild(child, check); }; check(node); return found; };
    visit(sf);

    const edits = [];
    for (const candidate of candidates) {
      if (candidate.kind === 'literal') {
        const node = candidate.node;
        let call;
        if (ts.isTemplateExpression(node)) {
          let key = node.head.text; const params = [];
          node.templateSpans.forEach((span, index) => { key += `{${index}}` + span.literal.text; params.push(text(span.expression)); });
          call = `t(${quote(key)}, [${params.join(', ')}])`;
        } else call = `t(${quote(node.text)})`;
        const inAttribute = node.parent && ts.isJsxAttribute(node.parent);
        edits.push({ start: node.getStart(sf), end: node.getEnd(), value: inAttribute ? `{${call}}` : call });
      } else {
        const nodes = candidate.nodes;
        let key = ''; const params = [];
        for (const child of nodes) {
          if (ts.isJsxText(child)) key += child.text.replace(/\s*\n\s*/g, ' ');
          else if (child.expression && ts.isStringLiteral(child.expression) && child.expression.text.trim() === '') key += child.expression.text;
          else { key += `{${params.length}}`; params.push(text(child.expression)); }
        }
        const leading = /^\s/.test(key) && !/^\s*\n/.test(nodes[0].getFullText(sf)) ? "{' '}" : '';
        const trailing = /\s$/.test(key) && !/\n\s*$/.test(ts.isJsxText(nodes.at(-1)) ? nodes.at(-1).text : '') ? "{' '}" : '';
        key = key.replace(/\s+/g, ' ').trim();
        const call = `{t(${quote(key)}${params.length ? `, [${params.join(', ')}]` : ''})}`;
        edits.push({ start: nodes[0].getStart(sf), end: nodes.at(-1).getEnd(), value: leading + call + trailing });
      }
    }
    if (!edits.length) break;
    // Apply from the end; drop edits overlapping one already applied.
    edits.sort((a, b) => b.start - a.start);
    let limit = Infinity;
    for (const edit of edits) {
      if (edit.end > limit) continue;
      source = source.slice(0, edit.start) + edit.value + source.slice(edit.end);
      limit = edit.start; report.edits++; changed = true;
    }
  }
  if (changed) {
    report.files++;
    if (!/import \{[^}]*\bt\b[^}]*\} from '[./]+i18n'/.test(source)) {
      const relative = path.relative(path.dirname(file), path.join(root, 'i18n')).replace(/\\/g, '/');
      const specifier = relative.startsWith('.') ? relative : `./${relative}`;
      const lastImport = [...source.matchAll(/^import [^\n]+;\n/gm)].at(-1);
      const at = lastImport ? lastImport.index + lastImport[0].length : 0;
      source = source.slice(0, at) + `import { t } from '${specifier}';\n` + source.slice(at);
    }
    if (!dry) fs.writeFileSync(file, source);
  }
}
console.log(JSON.stringify({ files: report.files, edits: report.edits }, null, 1));
if (report.moduleLevel.length) console.log('Module-level (evaluated once, fix by hand):\n' + report.moduleLevel.join('\n'));
