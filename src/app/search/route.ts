import { NextRequest } from 'next/server';
import { handleCors, jsonResponse } from '@/lib/crawler-auth';
import { searchEngines } from '@/lib/crawler/search';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const cors = handleCors(request);
  if (cors) return cors;

  // Auth: accept ?key= OR standard headers (OpenWebUI convention).
  const csv = process.env.CRAWLER_API_KEYS || '';
  const single = process.env.CRAWLER_API_KEY || '';
  const apiKeys = csv ? csv.split(',').map(s => s.trim()).filter(Boolean) : single ? [single] : [];
  if (apiKeys.length > 0) {
    const urlKey = request.nextUrl.searchParams.get('key') || '';
    const authHeader = request.headers.get('authorization') || '';
    const xApiKey = request.headers.get('x-api-key') || '';
    const bearer = authHeader.replace(/^Bearer\s+/i, '');
    if (!apiKeys.includes(urlKey) && !apiKeys.includes(bearer) && !apiKeys.includes(xApiKey)) {
      return jsonResponse({ error: 'Unauthorized: invalid or missing API key' }, 401);
    }
  }

  const q = request.nextUrl.searchParams.get('q') || '';
  const format = request.nextUrl.searchParams.get('format') || '';
  if (format !== 'json') {
    return jsonResponse({ error: 'format=json query parameter is required for JSON output' }, 400);
  }
  if (!q.trim()) return jsonResponse({ query: '', number_of_results: 0, results: [] });

  const pageno = Math.max(1, parseInt(request.nextUrl.searchParams.get('pageno') || '1', 10) || 1);
  const perPage = 20;
  const lang = request.nextUrl.searchParams.get('language') || request.nextUrl.searchParams.get('lang') || 'auto';
  const { results } = await searchEngines(q, { limit: perPage * pageno, lang });
  const start = (pageno - 1) * perPage;
  const pageResults = results.slice(start, start + perPage);
  return jsonResponse({
    query: q,
    number_of_results: results.length,
    pageno,
    results: pageResults.map(r => ({
      title: r.title,
      url: r.url,
      content: r.snippet,
      engine: r.engine,
      score: r.score,
    })),
  });
}

export async function OPTIONS(request: NextRequest) {
  return handleCors(request) ?? new Response(null, { status: 204 });
}
