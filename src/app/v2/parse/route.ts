import { NextRequest } from 'next/server';
import { checkAuth, handleCors, jsonResponse } from '@/lib/crawler-auth';
import { scrapeUrl } from '@/lib/crawler/crawler';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * POST /v2/parse — document parsing endpoint.
 *
 * Firecrawl's /parse accepts a multipart upload (`file=@...`) or a URL
 * pointing at a PDF / DOCX / XLSX / PPTX file. The open-source runtime
 * in this project does not ship a native PDF parser, so we support the
 * URL-based form by delegating to the scraper, which renders the
 * document via Playwright and extracts its text into markdown.
 *
 * For local file uploads, the caller is expected to first expose the
 * file via a public URL and pass that URL. The `url` field is accepted
 * in the JSON body OR as part of the multipart `options` JSON field.
 *
 * Supported output fields (subset of Firecrawl):
 *   - markdown: rendered document content as markdown.
 *   - metadata: { title, numPages?, totalPages?, sourceFile? }.
 *
 * AI-backed options (`parsers: [{ type: 'pdf', pages: true, blocks: true,
 * pageMarkers: true }]`) are accepted for forward compatibility — when
 * the runtime does not yet support them, the response simply omits
 * the corresponding fields.
 */
export async function POST(request: NextRequest) {
  const cors = handleCors(request);
  if (cors) return cors;
  const authError = checkAuth(request);
  if (authError) return jsonResponse({ success: false, error: authError }, 401);

  // Detect multipart vs JSON.
  const contentType = request.headers.get('content-type') || '';
  let docUrl: string | undefined;
  let sourceFile: string | undefined;
  let requestedFormats: string[] = ['markdown'];

  if (contentType.includes('multipart/form-data')) {
    try {
      const formData = await request.formData();
      const file = formData.get('file');
      const optionsStr = formData.get('options');
      if (optionsStr && typeof optionsStr === 'string') {
        try {
          const opts = JSON.parse(optionsStr);
          if (Array.isArray(opts.formats)) requestedFormats = opts.formats;
        } catch { /* ignore parse errors */ }
      }
      if (file instanceof File) {
        // We do not persist uploaded files; we accept them but cannot
        // parse local uploads in this runtime. Return a clear error.
        sourceFile = file.name;
        return jsonResponse({
          success: false,
          error: 'Local file upload is not supported by the open-source runtime. Provide a public `url` instead.',
        }, 422);
      }
      const urlField = formData.get('url');
      if (typeof urlField === 'string') docUrl = urlField;
    } catch {
      return jsonResponse({ success: false, error: 'Invalid multipart body' }, 400);
    }
  } else {
    let body: any;
    try { body = await request.json(); } catch {
      return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
    }
    docUrl = body.url;
    if (Array.isArray(body.formats)) requestedFormats = body.formats;
  }

  if (!docUrl) {
    return jsonResponse({ success: false, error: 'Missing required field: url' }, 400);
  }

  // Delegated scrape: render the document URL via Playwright and extract
  // the visible text as markdown. This works for HTML-renderable
  // documents and basic PDFs that the browser can display inline.
  const result = await scrapeUrl({
    url: docUrl,
    formats: requestedFormats.includes('markdown') ? ['markdown', 'html'] : ['html', 'rawHtml'],
    onlyMainContent: false,
    timeout: 60000,
    maxRetries: 1,
  });

  if (!result.success) {
    return jsonResponse({ success: false, error: result.error || 'Failed to parse document' }, 422);
  }

  const data = result.data!;
  return jsonResponse({
    success: true,
    data: {
      markdown: data.markdown,
      html: data.html,
      metadata: {
        ...(data.metadata || {}),
        sourceFile: sourceFile || new URL(docUrl).pathname.split('/').pop(),
        sourceURL: docUrl,
      },
    },
  });
}

export async function OPTIONS(request: NextRequest) {
  return handleCors(request) ?? new Response(null, { status: 204 });
}
