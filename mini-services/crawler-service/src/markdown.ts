import TurndownService from 'turndown';

/**
 * Create a configured Turndown instance for converting cleaned HTML to
 * GitHub-flavored Markdown. Handles tables, code blocks, images, links,
 * and strips noisy inline elements. Also normalizes whitespace and
 * collapses repeated blank lines so the output is compact.
 */
export function createTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '_',
    strongDelimiter: '**',
    linkStyle: 'inlined',
    linkReferenceStyle: 'full',
  });

  // ---- Custom rules ----

  // Drop elements that contribute nothing to the markdown.
  td.remove((node: any) => {
    if (!node || !node.nodeName) return false;
    const tag = node.nodeName.toLowerCase();
    return ['style', 'script', 'noscript', 'iframe', 'svg', 'canvas', 'form', 'button', 'input', 'select', 'textarea'].includes(tag);
  });

  // Preserve <pre><code> blocks with their language hint when present.
  td.addRule('fencedCodeBlock', {
    filter: (node: any) => {
      return node.nodeName === 'PRE' && !!node.querySelector('code');
    },
    replacement: (content: string, node: any) => {
      const codeEl = node.querySelector('code');
      if (!codeEl) return '```\n' + content + '\n```\n';
      const className = codeEl.getAttribute('class') || '';
      const langMatch = className.match(/(?:language-|lang-)(\S+)/);
      const lang = langMatch ? langMatch[1] : '';
      const text = codeEl.textContent || '';
      return '```' + lang + '\n' + text.replace(/\n$/, '') + '\n```\n';
    },
  });

  // Tables - Turndown's GFM plugin handles them, but we add a fallback for
  // poorly-structured tables (no thead) so they at least render as pipe rows.
  td.addRule('tableFallback', {
    filter: 'table',
    replacement: (content: string, node: any) => {
      const table = node;
      const rows = Array.from(table.querySelectorAll('tr'));
      if (rows.length === 0) return content;
      const hasHeader = table.querySelector('th') !== null;
      let out = '';
      rows.forEach((row: any, i: number) => {
        const cells = Array.from(row.querySelectorAll('td, th')).map((c: any) => (c.textContent || '').trim());
        if (i === 0 && hasHeader) {
          out += '| ' + cells.join(' | ') + ' |\n';
          out += '| ' + cells.map(() => '---').join(' | ') + ' |\n';
        } else {
          out += '| ' + cells.join(' | ') + ' |\n';
        }
      });
      return out + '\n';
    },
  });

  return td;
}

const turndown = createTurndown();

/**
 * Convert cleaned HTML to markdown with normalization for clean output:
 *  - collapse runs of blank lines (>2 newlines) to a single paragraph break
 *  - trim trailing whitespace per line
 *  - strip zero-width and other invisible unicode that causes garbled output
 *  - optionally drop base64-encoded inline images
 */
export function htmlToMarkdown(html: string, options: { removeBase64Images?: boolean } = {}): string {
  if (!html) return '';

  let cleaned = html;

  if (options.removeBase64Images) {
    cleaned = cleaned.replace(/<img[^>]*src=["']data:image\/[^"']*["'][^>]*>/gi, '');
  }

  let md: string;
  try {
    md = turndown.turndown(cleaned);
  } catch (e) {
    // If turndown throws (malformed html), fall back to stripped text.
    md = stripTags(cleaned);
  }

  // Normalize whitespace and strip invisible chars that cause garbled output.
  md = md
    .replace(/\r\n/g, '\n') // normalize line endings
    .replace(/\u200b/g, '') // zero-width space
    .replace(/\u200c/g, '') // zero-width non-joiner
    .replace(/\u200d/g, '') // zero-width joiner
    .replace(/\ufeff/g, '') // BOM
    .replace(/\u00a0/g, ' ') // non-breaking space -> regular space
    .replace(/[ \t]+\n/g, '\n') // trailing spaces
    .replace(/\n{3,}/g, '\n\n') // collapse blank lines
    .replace(/^\s+|\s+$/g, ''); // trim

  return md;
}

/**
 * Crude HTML tag stripper for the fallback path when turndown can't parse
 * the input. Decodes common entities and removes tags.
 */
function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
