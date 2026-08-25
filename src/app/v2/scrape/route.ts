import { NextRequest } from 'next/server';
import { checkAuth, handleCors, jsonResponse } from '@/lib/crawler-auth';
import { scrapeUrl } from '@/lib/crawler/crawler';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const cors = handleCors(request);
  if (cors) return cors;
  const authError = checkAuth(request);
  if (authError) return jsonResponse({ success: false, error: authError }, 401);

  let body: any;
  try { body = await request.json(); } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
  }
  if (!body?.url) return jsonResponse({ success: false, error: 'Missing required field: url' }, 400);

  // Parse `formats` array, supporting both string formats (markdown/html/...)
  // and object formats ({type: 'screenshot', fullPage: ...}, {type: 'json', ...},
  // {type: 'attributes', selectors: ...}). We only forward the string formats
  // and the screenshot/attributes sub-options; AI-backed formats (json,
  // question, highlights, summary, branding, product, audio, video) are
  // acknowledged but not implemented in the open-source runtime — they are
  // silently dropped, matching Firecrawl's "self-host without LLM service"
  // behaviour described in their docs.
  const rawFormats: any[] = Array.isArray(body.formats) ? body.formats : ['markdown'];
  const stringFormats: string[] = [];
  let screenshotOpts: any = undefined;
  let attributesOpts: any = undefined;
  for (const f of rawFormats) {
    if (typeof f === 'string') {
      // Skip AI-only formats we don't support; keep them in the array so
      // the response shape mirrors Firecrawl (the format simply returns
      // nothing in the payload).
      stringFormats.push(f);
    } else if (f && typeof f === 'object' && f.type) {
      stringFormats.push(f.type);
      if (f.type === 'screenshot') {
        screenshotOpts = {
          fullPage: f.fullPage,
          quality: f.quality,
          viewport: f.viewport,
        };
      } else if (f.type === 'attributes' && Array.isArray(f.selectors)) {
        // Firecrawl uses `selectors: [{ selector, attribute }]`.
        attributesOpts = f.selectors;
      }
      // json / question / highlights / changeTracking: forwarded as format
      // name only — no LLM-backed extraction in the open-source runtime.
    }
  }

  const result = await scrapeUrl({
    url: body.url,
    formats: stringFormats,
    onlyMainContent: body.onlyMainContent ?? true,
    includeTags: body.includeTags,
    excludeTags: body.excludeTags,
    timeout: body.timeout,
    waitFor: body.waitFor,
    removeBase64Images: body.removeBase64Images,
    maxRetries: body.maxRetries,
    waitForSelector: body.waitForSelector,
    device: body.device,
    mobile: body.mobile,
    cookies: body.cookies,
    userAgent: body.userAgent,
    actions: body.actions,
    location: body.location,
    headers: body.headers,
    maxAge: body.maxAge,
    screenshot: screenshotOpts,
    attributes: attributesOpts,
    ignoreRobotsTxt: body.ignoreRobotsTxt === true ? true : undefined,
  });
  return jsonResponse(result, result.success ? 200 : 422);
}

export async function OPTIONS(request: NextRequest) {
  return handleCors(request) ?? new Response(null, { status: 204 });
}
