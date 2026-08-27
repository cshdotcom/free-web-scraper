import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/status
 *
 * Public endpoint that tells the client whether API key auth is
 * enabled, and what the public base URL is. This lets the test
 * console show the right UX (warn that a key is required vs.
 * show a green "auth disabled" badge) without leaking the actual
 * keys themselves.
 */
export async function GET() {
  const csv = process.env.CRAWLER_API_KEYS || '';
  const single = process.env.CRAWLER_API_KEY || '';
  const apiKeys = csv
    ? csv.split(',').map((s) => s.trim()).filter(Boolean)
    : single
      ? [single]
      : [];

  const publicBaseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.CRAWLER_PUBLIC_URL ||
    'http://localhost:3000';

  return NextResponse.json({
    requiresAuth: apiKeys.length > 0,
    publicBaseUrl,
    brand: process.env.CRAWLER_BRAND_NAME || 'NodeByte Crawl',
    version: '4.0.7',
  });
}
