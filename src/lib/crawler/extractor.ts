/**
 * Content extraction logic that runs INSIDE the Playwright page context.
 *
 * `extractInPage` is passed directly to `page.evaluate(fn, arg)` so it
 * executes in the browser's DOM context. It must NOT reference any
 * outer-scope variables or imports - only its single argument.
 *
 * Extraction strategy (multi-strategy for robustness):
 *  1. Apply stealth patches (remove webdriver flag, etc.) — done in stealth.ts
 *  2. Dismiss cookie/consent banners if configured
 *  3. Remove noise elements (scripts, nav, footer, ads)
 *  4. Try main-content selectors: article > main > [role=main] > [id*=content]
 *  5. If that yields too little text, fall back to TEXT-DENSITY scoring:
 *     score every <div>/<section> by (text length) / (link density),
 *     pick the best-scoring block.
 *  6. Try Readability-style heuristics on the largest text container
 *  7. Return cleaned HTML + metadata + links
 */
export interface ExtractResult {
  /** HTML of the cleaned main content, ready for turndown */
  contentHtml: string;
  /** The full rendered HTML of the page (after JS execution) */
  rawHtml: string;
  /** Page metadata extracted from <head> and meta tags */
  metadata: PageMetadata;
  /** All visible links on the page (absolute URLs) */
  links: Array<{ url: string; text: string }>;
  /** Status code of the response (best-effort) */
  statusCode: number;
  /** Error message if extraction failed */
  error: string | null;
  /** Which strategy was used to find the main content */
  strategy: string;
}

export interface PageMetadata {
  title: string | null;
  description: string | null;
  language: string | null;
  keywords: string | null;
  robots: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogUrl: string | null;
  ogImage: string | null;
  ogSiteName: string | null;
  ogType: string | null;
  author: string | null;
  publishedTime: string | null;
  modifiedTime: string | null;
  sourceURL: string;
  statusCode: number;
  error: string | null;
}

export interface ExtractArgs {
  includeTags: string[];
  excludeTags: string[];
  onlyMainContent: boolean;
}

/**
 * The function that runs inside the browser page. Passed to page.evaluate().
 * NOTE: this function is serialized by Playwright and run in the page's
 * context, so it must be self-contained (no closure over outer scope).
 *
 * The readability scoring logic is inlined below (can't import helpers).
 */
export function extractInPage(args: ExtractArgs): ExtractResult {
  const result: ExtractResult = {
    contentHtml: '',
    rawHtml: '',
    metadata: {} as PageMetadata,
    links: [],
    statusCode: 200,
    error: null,
    strategy: 'none',
  };

  const meta = (name: string): string | null => {
    const el =
      document.querySelector('meta[name="' + name + '"]') ||
      document.querySelector('meta[property="' + name + '"]');
    return el ? el.getAttribute('content') : null;
  };

  result.metadata = {
    title: document.title || null,
    description: meta('description') || meta('og:description') || null,
    language: document.documentElement && document.documentElement.getAttribute('lang'),
    keywords: meta('keywords'),
    robots: meta('robots'),
    ogTitle: meta('og:title'),
    ogDescription: meta('og:description'),
    ogUrl: meta('og:url'),
    ogImage: meta('og:image'),
    ogSiteName: meta('og:site_name'),
    ogType: meta('og:type'),
    author: meta('author') || meta('article:author'),
    publishedTime: meta('article:published_time') || meta('date'),
    modifiedTime: meta('article:modified_time'),
    sourceURL: location.href,
    statusCode: 200,
    error: null,
  };

  // Save raw HTML before mutating the DOM.
  result.rawHtml = '<!DOCTYPE html>\n' + document.documentElement.outerHTML;

  // Collect all links (absolute, deduped).
  const seen: Set<string> = new Set();
  const links: Array<{ url: string; text: string }> = [];
  const anchors = document.querySelectorAll('a[href]');
  for (let i = 0; i < anchors.length; i++) {
    const a = anchors[i] as HTMLAnchorElement;
    try {
      const href = a.href;
      if (!href || href.indexOf('javascript:') === 0 || href.indexOf('#') === 0) continue;
      if (seen.has(href)) continue;
      seen.add(href);
      const text = ((a.innerText || a.textContent || '') + '').trim().slice(0, 200);
      links.push({ url: href, text: text });
    } catch (_e) {
      // skip
    }
  }
  result.links = links;

  // Clone the body so we can mutate without destroying the live DOM.
  const clone: HTMLElement = document.body.cloneNode(true) as HTMLElement;

  // Remove obviously-irrelevant elements from the clone.
  const noiseSelectors = [
    'script', 'style', 'noscript', 'iframe', 'svg', 'canvas',
    'nav', 'footer', 'header[role="banner"]', 'aside',
    'form', 'button', 'input', 'select', 'textarea',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    '[aria-hidden="true"]',
    '.ad', '.ads', '.adsbygoogle', '[id*="ad-"]', '[class*="advertisement"]',
    '.social-share', '.share-buttons', '.related-posts', '.comments',
    '.cookie-banner', '.cookie-consent', '.newsletter', '.subscribe',
    '.pagination', '.breadcrumb', '.sidebar',
    '#comments', '#sidebar', '#footer', '#nav', '#navigation',
    '[class*="cookie"]', '[id*="cookie"]', '[id*="consent"]',
  ];
  for (let s = 0; s < noiseSelectors.length; s++) {
    try {
      const els = clone.querySelectorAll(noiseSelectors[s]);
      for (let j = 0; j < els.length; j++) {
        const el = els[j] as HTMLElement;
        if (el.parentNode) el.parentNode.removeChild(el);
      }
    } catch (_e) {
      // skip invalid selectors
    }
  }

  // ---- Strategy 1: explicit main-content selectors ----
  let mainEl: Element | null =
    clone.querySelector('article') ||
    clone.querySelector('main') ||
    clone.querySelector('[role="main"]') ||
    clone.querySelector('[itemprop="articleBody"]') ||
    clone.querySelector('[id*="content" i]') ||
    clone.querySelector('[class*="content" i]') ||
    clone.querySelector('[id*="article" i]') ||
    clone.querySelector('[class*="article" i]') ||
    clone.querySelector('[id*="post" i]') ||
    clone.querySelector('[class*="post" i]') ||
    clone.querySelector('[id*="main" i]');

  let strategy = 'explicit-selector';

  // ---- Strategy 2: text-density scoring (Readability-style) ----
  // If the explicit selector returned very little text, score all
  // candidate containers and pick the best.
  const minTextLen = 200;
  const mainText = mainEl ? ((mainEl.textContent || '').trim()) : '';
  if (!mainEl || mainText.length < minTextLen) {
    let best: Element | null = null;
    let bestScore = 0;
    const candidates = clone.querySelectorAll('div, section, article, td');
    for (let k = 0; k < candidates.length; k++) {
      const div = candidates[k] as HTMLElement;
      // Compute score inline (can't call readabilityScore here)
      const text = (div.textContent || '').trim();
      if (text.length < minTextLen) continue;
      const linkText = Array.from(div.querySelectorAll('a'))
        .map((a) => (a.textContent || '').trim())
        .join('');
      const linkDensity = linkText.length / Math.max(text.length, 1);
      let score = Math.log(text.length + 1) * 10;
      score = score * (1 - linkDensity * 0.7);
      const pCount = div.querySelectorAll('p').length;
      score += pCount * 5;
      const hCount = div.querySelectorAll('h1,h2,h3').length;
      score += hCount * 3;
      const formEls = div.querySelectorAll('input,button,select,textarea').length;
      score -= formEls * 5;
      if (score > bestScore) {
        bestScore = score;
        best = div;
      }
    }
    if (best && bestScore > 0) {
      mainEl = best;
      strategy = 'text-density';
    }
  }

  // ---- Strategy 3: largest <article> / fallback to body ----
  if (!mainEl || ((mainEl.textContent || '').trim()).length < minTextLen) {
    const articles = clone.querySelectorAll('article');
    let largest: Element | null = null;
    let largestLen = 0;
    for (let a = 0; a < articles.length; a++) {
      const art = articles[a];
      const len = ((art.textContent || '').trim()).length;
      if (len > largestLen) {
        largestLen = len;
        largest = art;
      }
    }
    if (largest && largestLen >= minTextLen) {
      mainEl = largest;
      strategy = 'largest-article';
    } else {
      mainEl = clone;
      strategy = 'full-body-fallback';
    }
  }

  // Apply excludeTags first (remove matching elements from main content).
  if (args.excludeTags && args.excludeTags.length > 0) {
    const excludeSel = args.excludeTags.filter(Boolean).join(', ');
    if (excludeSel) {
      try {
        const els = mainEl.querySelectorAll(excludeSel);
        for (let m = 0; m < els.length; m++) {
          const el = els[m] as HTMLElement;
          if (el.parentNode) el.parentNode.removeChild(el);
        }
      } catch (_e) {
        // skip invalid selectors
      }
    }
  }

  // Apply includeTags (keep only matching elements).
  if (args.includeTags && args.includeTags.length > 0) {
    const includeSel = args.includeTags.filter(Boolean).join(', ');
    if (includeSel) {
      const kept: HTMLElement[] = [];
      try {
        const els = mainEl.querySelectorAll(includeSel);
        for (let n = 0; n < els.length; n++) {
          kept.push(els[n] as HTMLElement);
        }
      } catch (_e) {
        // skip
      }
      if (kept.length > 0) {
        const wrapper = document.createElement('div');
        for (let p = 0; p < kept.length; p++) {
          wrapper.appendChild(kept[p].cloneNode(true));
        }
        mainEl = wrapper;
        strategy = strategy + '+includeTags';
      }
    }
  }

  // Final cleanup: remove empty wrappers and excessive nesting.
  // Remove <div> elements that contain only other empty divs.
  mainEl.querySelectorAll('div:empty, span:empty, p:empty').forEach((e) => {
    const el = e as HTMLElement;
    if (el.parentNode) el.parentNode.removeChild(el);
  });

  result.contentHtml = (mainEl as HTMLElement).innerHTML;
  result.strategy = strategy;
  return result;
}

/**
 * Server-side fallback extractor used when Playwright is unavailable
 * or for pages where the in-browser script fails. It does a best-effort
 * regex-based cleaning on the raw HTML. This is far less accurate than
 * the in-browser extraction but guarantees we always return something.
 */
export function fallbackExtract(rawHtml: string, sourceURL: string): { contentHtml: string; metadata: Partial<PageMetadata> } {
  let html = rawHtml;
  const stripBlocks = [
    /<script[\s\S]*?<\/script>/gi,
    /<style[\s\S]*?<\/style>/gi,
    /<noscript[\s\S]*?<\/noscript>/gi,
    /<iframe[\s\S]*?<\/iframe>/gi,
    /<nav[\s\S]*?<\/nav>/gi,
    /<footer[\s\S]*?<\/footer>/gi,
    /<aside[\s\S]*?<\/aside>/gi,
    /<header[\s\S]*?<\/header>/gi,
    /<form[\s\S]*?<\/form>/gi,
  ];
  for (const re of stripBlocks) {
    html = html.replace(re, '');
  }

  let content = '';
  // Collect ALL <article> elements (not just the first one) — many news
  // sites (nature.com, nytimes, etc.) wrap each story card in its own
  // <article> tag, so matching only the first one loses 90% of the
  // content. When multiple articles are present, concatenate them
  // inside a wrapper <div> so turndown flattens them in order.
  const articleMatches = html.match(/<article[\s\S]*?<\/article>/gi);
  if (articleMatches && articleMatches.length > 0) {
    content = articleMatches.length === 1
      ? articleMatches[0]
      : `<div data-extracted="articles">\n${articleMatches.join('\n')}\n</div>`;
  } else {
    // Same for <main> — concatenate when multiple.
    const mainMatches = html.match(/<main[\s\S]*?<\/main>/gi);
    if (mainMatches && mainMatches.length > 0) {
      content = mainMatches.length === 1
        ? mainMatches[0]
        : `<div data-extracted="mains">\n${mainMatches.join('\n')}\n</div>`;
    } else {
      const bodyMatch = html.match(/<body[\s\S]*?<\/body>/i);
      content = bodyMatch ? bodyMatch[0] : html;
    }
  }

  const meta = (name: string): string | null => {
    const re = new RegExp('<meta[^>]*(?:name|property)=["\']' + name + '["\'][^>]*content=["\']([^"\']*)["\']', 'i');
    const m = html.match(re);
    return m ? m[1] : null;
  };
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);

  const metadata: Partial<PageMetadata> = {
    title: titleMatch ? titleMatch[1].trim() : null,
    description: meta('description') || meta('og:description'),
    ogTitle: meta('og:title'),
    ogDescription: meta('og:description'),
    ogImage: meta('og:image'),
    ogUrl: meta('og:url'),
    ogSiteName: meta('og:site_name'),
    sourceURL,
    statusCode: 200,
    error: null,
  };

  return { contentHtml: content, metadata };
}
