/**
 * A small tokenizer for colouring code in a preview. It knows the shapes most languages share (comments, strings,
 * numbers, keywords, tags in markup, keys in data files) and nothing more: enough for the eye to find its way
 * around a file, with no grammar, no dependency and no script run on the content. Tokens never change the text,
 * so a cited line reads exactly as it was written.
 */
export type TokenKind = 'plain' | 'comment' | 'string' | 'number' | 'keyword' | 'tag' | 'attribute' | 'key' | 'punctuation';
export type Token = { kind: TokenKind; text: string };

export type Language = 'javascript' | 'python' | 'shell' | 'powershell' | 'sql' | 'css' | 'markup' | 'yaml' | 'json' | 'toml' | 'c-family' | 'go' | 'rust' | 'ruby' | 'text';

type Grammar = {
  lineComments: string[];
  blockComment?: [string, string];
  /** Quote characters that open a string; a triple quote is one entry of three characters. */
  quotes: string[];
  keywords: Set<string>;
  caseInsensitiveKeywords?: boolean;
  /** Markup: `<name` and `</name` become tags, `name=` inside a tag becomes an attribute. */
  tags?: boolean;
  /** Data files: an identifier followed by `:` (YAML) or `=` (TOML) at the start of a line is a key. */
  keyPattern?: RegExp;
};

const cLike = ['if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return', 'new', 'delete', 'try', 'catch', 'finally', 'throw', 'class', 'extends', 'this', 'super', 'static', 'public', 'private', 'protected', 'void', 'null', 'true', 'false', 'import', 'export', 'from', 'as'];

const grammars: Record<Language, Grammar> = {
  javascript: { lineComments: ['//'], blockComment: ['/*', '*/'], quotes: ['"', "'", '`'], keywords: new Set([...cLike, 'const', 'let', 'var', 'function', 'async', 'await', 'yield', 'of', 'in', 'typeof', 'instanceof', 'undefined', 'interface', 'type', 'enum', 'implements', 'readonly', 'declare', 'namespace', 'keyof', 'satisfies', 'abstract', 'override']) },
  python: { lineComments: ['#'], quotes: ['"""', "'''", '"', "'"], keywords: new Set(['def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'in', 'not', 'and', 'or', 'is', 'None', 'True', 'False', 'import', 'from', 'as', 'with', 'try', 'except', 'finally', 'raise', 'lambda', 'yield', 'pass', 'break', 'continue', 'global', 'nonlocal', 'assert', 'del', 'async', 'await', 'self']) },
  shell: { lineComments: ['#'], quotes: ['"', "'"], keywords: new Set(['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'in', 'function', 'return', 'export', 'local', 'set', 'echo', 'exit']) },
  powershell: { lineComments: ['#'], blockComment: ['<#', '#>'], quotes: ['"', "'"], keywords: new Set(['if', 'else', 'elseif', 'foreach', 'for', 'while', 'do', 'switch', 'function', 'param', 'return', 'try', 'catch', 'finally', 'throw', 'begin', 'process', 'end', 'in']), caseInsensitiveKeywords: true },
  sql: { lineComments: ['--'], blockComment: ['/*', '*/'], quotes: ["'", '"'], keywords: new Set(['select', 'from', 'where', 'and', 'or', 'not', 'in', 'as', 'join', 'left', 'right', 'inner', 'outer', 'on', 'group', 'by', 'order', 'having', 'limit', 'offset', 'insert', 'into', 'values', 'update', 'set', 'delete', 'create', 'table', 'drop', 'alter', 'index', 'primary', 'key', 'null', 'is', 'distinct', 'union', 'all', 'case', 'when', 'then', 'else', 'end', 'with', 'exists', 'between', 'like', 'asc', 'desc', 'count', 'sum', 'avg', 'min', 'max']), caseInsensitiveKeywords: true },
  css: { lineComments: [], blockComment: ['/*', '*/'], quotes: ['"', "'"], keywords: new Set(['important', 'media', 'import', 'keyframes', 'supports', 'font-face', 'property']), keyPattern: /^\s*[-\w]+(?=\s*:)/ },
  markup: { lineComments: [], blockComment: ['<!--', '-->'], quotes: ['"', "'"], keywords: new Set(), tags: true },
  yaml: { lineComments: ['#'], quotes: ['"', "'"], keywords: new Set(['true', 'false', 'null', 'yes', 'no']), keyPattern: /^\s*-?\s*[^\s:#"'][^:#]*?(?=\s*:(\s|$))/ },
  json: { lineComments: [], quotes: ['"'], keywords: new Set(['true', 'false', 'null']) },
  toml: { lineComments: ['#', ';'], quotes: ['"', "'"], keywords: new Set(['true', 'false']), keyPattern: /^\s*[\w.-]+(?=\s*=)/ },
  'c-family': { lineComments: ['//'], blockComment: ['/*', '*/'], quotes: ['"', "'"], keywords: new Set([...cLike, 'int', 'char', 'float', 'double', 'long', 'short', 'unsigned', 'struct', 'union', 'enum', 'typedef', 'const', 'sizeof', 'namespace', 'using', 'template', 'virtual', 'override', 'final', 'var', 'string', 'bool', 'boolean', 'byte', 'auto', 'nullptr', 'include', 'define', 'pragma', 'package', 'interface', 'implements', 'final', 'fun', 'val', 'let', 'func', 'guard', 'nil', 'echo', 'foreach', 'function']) },
  go: { lineComments: ['//'], blockComment: ['/*', '*/'], quotes: ['"', '`', "'"], keywords: new Set(['func', 'package', 'import', 'var', 'const', 'type', 'struct', 'interface', 'map', 'chan', 'go', 'defer', 'return', 'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'break', 'continue', 'select', 'nil', 'true', 'false', 'string', 'int', 'int64', 'bool', 'error', 'byte', 'float64']) },
  rust: { lineComments: ['//'], blockComment: ['/*', '*/'], quotes: ['"'], keywords: new Set(['fn', 'let', 'mut', 'pub', 'use', 'mod', 'struct', 'enum', 'impl', 'trait', 'for', 'in', 'while', 'loop', 'if', 'else', 'match', 'return', 'self', 'Self', 'crate', 'super', 'as', 'ref', 'move', 'where', 'const', 'static', 'unsafe', 'async', 'await', 'dyn', 'true', 'false', 'Some', 'None', 'Ok', 'Err', 'String', 'Vec', 'Option', 'Result', 'u8', 'u32', 'u64', 'i32', 'i64', 'usize', 'f64', 'bool', 'str']) },
  ruby: { lineComments: ['#'], quotes: ['"', "'"], keywords: new Set(['def', 'end', 'class', 'module', 'if', 'elsif', 'else', 'unless', 'while', 'until', 'for', 'in', 'do', 'return', 'yield', 'begin', 'rescue', 'ensure', 'raise', 'self', 'nil', 'true', 'false', 'and', 'or', 'not', 'require', 'attr_accessor', 'puts', 'lambda', 'proc', 'then', 'case', 'when']) },
  text: { lineComments: [], quotes: [], keywords: new Set() },
};

const languagesByExtension: Record<string, Language> = {
  ts: 'javascript', tsx: 'javascript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', sh: 'shell', bash: 'shell', zsh: 'shell', bat: 'shell', cmd: 'shell', ps1: 'powershell', sql: 'sql',
  css: 'css', scss: 'css', less: 'css', html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup', vue: 'markup', svelte: 'markup',
  yaml: 'yaml', yml: 'yaml', json: 'json', jsonl: 'json', ndjson: 'json', toml: 'toml', ini: 'toml', cfg: 'toml', conf: 'toml',
  c: 'c-family', h: 'c-family', cpp: 'c-family', hpp: 'c-family', cs: 'c-family', java: 'c-family', kt: 'c-family', swift: 'c-family', php: 'c-family',
  go: 'go', rs: 'rust', rb: 'ruby',
};

export function languageOf(name: string): Language {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return 'text';
  return languagesByExtension[name.slice(dot + 1).toLowerCase()] ?? 'text';
}

const identifierStart = /[A-Za-z_$@]/;
const identifierPart = /[\w$-]/;
const numberStart = /[0-9]/;
const punctuation = /[{}()[\];,.<>=+\-*/%!&|^~?:]/;

/** Splits `text` into lines of tokens. Multi-line comments and strings carry across lines. */
export function tokenizeLines(text: string, language: Language): Token[][] {
  const grammar = grammars[language];
  const lines: Token[][] = [];
  let current: Token[] = [];
  let pending: Token | undefined;
  const push = (kind: TokenKind, piece: string) => {
    if (!piece) return;
    if (pending && pending.kind === kind) { pending.text += piece; return; }
    if (pending) current.push(pending);
    pending = { kind, text: piece };
  };
  const endLine = () => {
    if (pending) current.push(pending);
    pending = undefined;
    lines.push(current);
    current = [];
  };
  // What we are inside of when a line ends: an open block comment or an open multi-line string.
  let openBlock: { kind: 'comment' | 'string'; closer: string } | undefined;
  let insideTag = false;

  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    let index = 0;
    let lineStart = true;
    while (index < line.length) {
      if (openBlock) {
        const end = line.indexOf(openBlock.closer, index);
        if (end === -1) { push(openBlock.kind, line.slice(index)); index = line.length; break; }
        push(openBlock.kind, line.slice(index, end + openBlock.closer.length));
        index = end + openBlock.closer.length;
        openBlock = undefined;
        lineStart = false;
        continue;
      }
      const rest = line.slice(index);
      if (lineStart && grammar.keyPattern) {
        const key = grammar.keyPattern.exec(rest);
        if (key && key[0].trim()) {
          const leading = key[0].length - key[0].trimStart().length;
          push('plain', key[0].slice(0, leading));
          push('key', key[0].slice(leading));
          index += key[0].length;
          lineStart = false;
          continue;
        }
      }
      lineStart = false;
      const lineComment = grammar.lineComments.find(marker => rest.startsWith(marker));
      if (lineComment && !(language === 'javascript' && lineComment === '//' && isUrlContext(line, index))) { push('comment', rest); index = line.length; break; }
      if (grammar.blockComment && rest.startsWith(grammar.blockComment[0])) {
        const closer = grammar.blockComment[1];
        const end = rest.indexOf(closer, grammar.blockComment[0].length);
        if (end === -1) { push('comment', rest); openBlock = { kind: 'comment', closer }; index = line.length; break; }
        push('comment', rest.slice(0, end + closer.length));
        index += end + closer.length;
        continue;
      }
      const quote = grammar.quotes.find(candidate => rest.startsWith(candidate));
      if (quote) {
        const end = findStringEnd(rest, quote);
        if (end === -1) {
          push('string', rest);
          if (quote.length === 3 || quote === '`') openBlock = { kind: 'string', closer: quote };
          index = line.length;
          break;
        }
        push('string', rest.slice(0, end + quote.length));
        index += end + quote.length;
        continue;
      }
      const character = rest[0];
      if (grammar.tags && character === '<' && /^<\/?[A-Za-z!?]/.test(rest)) {
        const match = /^<\/?[A-Za-z][\w:.-]*|^<[!?][\w-]*/.exec(rest)!;
        push('tag', match[0]);
        index += match[0].length;
        insideTag = true;
        continue;
      }
      if (grammar.tags && insideTag && (character === '>' || rest.startsWith('/>') || rest.startsWith('?>'))) {
        const closer = character === '>' ? '>' : rest.slice(0, 2);
        push('tag', closer);
        index += closer.length;
        insideTag = false;
        continue;
      }
      if (numberStart.test(character) && !(index > 0 && identifierPart.test(line[index - 1]))) {
        const match = /^(0x[0-9a-fA-F_]+|\d[\d_]*(\.\d[\d_]*)?([eE][+-]?\d+)?)/.exec(rest)!;
        push('number', match[0]);
        index += match[0].length;
        continue;
      }
      if (identifierStart.test(character)) {
        const match = /^[A-Za-z_$@][\w$-]*/.exec(rest)!;
        const word = match[0];
        const lookup = grammar.caseInsensitiveKeywords ? word.toLowerCase() : word;
        if (grammar.tags && insideTag) push('attribute', word);
        else if (grammar.keywords.has(lookup)) push('keyword', word);
        else if (language === 'json' && isJsonKey(line, index + word.length)) push('key', word);
        else push('plain', word);
        index += word.length;
        continue;
      }
      if (punctuation.test(character)) { push('punctuation', character); index += 1; continue; }
      push('plain', character);
      index += 1;
    }
    endLine();
  }
  return lines;
}

/** `http://` inside a line is not a comment; a `//` right after a colon is left alone. */
function isUrlContext(line: string, index: number) {
  return index > 0 && line[index - 1] === ':';
}

function isJsonKey(line: string, after: number) {
  return /^\s*:/.test(line.slice(after));
}

/** Index of the closing quote, honouring backslash escapes; -1 when the string runs past the line. */
function findStringEnd(rest: string, quote: string): number {
  let index = quote.length;
  while (index < rest.length) {
    if (rest[index] === '\\') { index += 2; continue; }
    if (rest.startsWith(quote, index)) return index;
    index += 1;
  }
  return -1;
}
