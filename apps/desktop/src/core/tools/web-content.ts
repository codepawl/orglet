type WebLink = { url: string; title: string; className: string };
const hiddenTags = new Set(['script', 'style', 'template', 'svg', 'iframe']);
const blockTags = new Set(['p', 'div', 'br', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'section', 'article', 'pre']);
const entities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—' };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[\da-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (original, entity: string) => {
    if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? original;
    const codePoint = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    return codePoint > 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
      ? String.fromCodePoint(codePoint) : '�';
  });
}

function plainText(value: string): string {
  return decodeEntities(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[ \t\r]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function tagEnd(html: string, start: number): number {
  let quote = '';
  for (let offset = start + 1; offset < Math.min(html.length, start + 8192); offset++) {
    const character = html[offset];
    if (quote) {
      if (character === quote) quote = '';
    } else if (character === '"' || character === "'") quote = character;
    else if (character === '>') return offset;
  }
  return -1;
}

function attributes(tag: string): Record<string, string> {
  const values: Record<string, string> = Object.create(null);
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    values[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4]);
  }
  return values;
}

/** Bounded text extraction, not a browser or HTML sanitizer. The result remains untrusted plain text. */
export function extractWebDocument(html: string) {
  const text: string[] = [];
  const title: string[] = [];
  const links: WebLink[] = [];
  let activeLink: (WebLink & { fragments: string[] }) | undefined;
  let inTitle = false;
  let cursor = 0;
  const lower = html.toLowerCase();
  const append = (fragment: string) => {
    text.push(fragment);
    if (inTitle) title.push(fragment);
    activeLink?.fragments.push(fragment);
  };
  while (cursor < html.length) {
    const start = html.indexOf('<', cursor);
    if (start < 0) {
      append(html.slice(cursor));
      break;
    }
    append(html.slice(cursor, start));
    if (html.startsWith('<!--', start)) {
      const end = html.indexOf('-->', start + 4);
      cursor = end < 0 ? html.length : end + 3;
      continue;
    }
    const end = tagEnd(html, start);
    if (end < 0) {
      // Treat a malformed suffix as text rather than repeatedly rescanning it.
      append(html.slice(start));
      break;
    }
    const raw = html.slice(start + 1, end);
    const match = /^\s*(\/?)\s*([\w:-]+)/.exec(raw);
    cursor = end + 1;
    if (!match) continue;
    const closing = !!match[1];
    const name = match[2].toLowerCase();
    if (!closing && hiddenTags.has(name)) {
      const close = lower.indexOf(`</${name}`, cursor);
      cursor = close < 0 ? html.length : close;
      continue;
    }
    if (name === 'title') inTitle = !closing;
    if (name === 'a') {
      if (activeLink && links.length < 100) {
        links.push({ url: activeLink.url, className: activeLink.className, title: plainText(activeLink.fragments.join('')).slice(0, 2000) });
      }
      activeLink = undefined;
      if (!closing) {
        const values = attributes(raw);
        if (values.href?.length <= 4096) activeLink = { url: values.href, className: values.class ?? '', title: '', fragments: [] };
      }
    }
    if (blockTags.has(name)) append('\n');
  }
  return { text: plainText(text.join('')), title: plainText(title.join('')).slice(0, 500), links };
}
