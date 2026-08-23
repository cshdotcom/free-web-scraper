import { NextRequest } from 'next/server';
import { checkAuth, handleCors, jsonResponse } from '@/lib/crawler-auth';
import { searchEngines } from '@/lib/crawler/search';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
  const cors = handleCors(request);
  if (cors) return cors;
  const authError = checkAuth(request);
  if (authError) return jsonResponse({ success: false, error: authError }, 401);
  let body: any;
  try { body = await request.json(); } catch {
    return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
  }
  if (!body?.query) return jsonResponse({ success: false, error: 'Missing required field: query' }, 400);
  const limit = typeof body.limit === 'number' ? body.limit : 50;
  const engines = Array.isArray(body.engines) ? body.engines : undefined;
  const requestedLang = typeof body.lang === 'string' && body.lang.trim() ? body.lang.trim() : 'auto';
  const { results, engines: usedEngines, resolvedLang } = await searchEngines(body.query, { limit, engines, lang: requestedLang });
  return jsonResponse({
    success: true,
    query: body.query,
    total: results.length,
    engines: usedEngines,
    lang: resolvedLang || requestedLang,
    data: results,
  });
}

export async function OPTIONS(request: NextRequest) {
  return handleCors(request) ?? new Response(null, { status: 204 });
}
