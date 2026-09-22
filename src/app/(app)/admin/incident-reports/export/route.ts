import { NextResponse, type NextRequest } from 'next/server';

/** The CSV export moved under Informes; an old link still downloads the same file. */
export function GET(request: NextRequest) {
  const target = new URL('/admin/reports/incidents/export', request.url);
  target.search = request.nextUrl.search;
  return NextResponse.redirect(target);
}
