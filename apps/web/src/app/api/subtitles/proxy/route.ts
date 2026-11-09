import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'URL de subtítulo requerida' }, { status: 400 });
  }

  try {
    if (url.startsWith('/api/')) {
      const origin = new URL(req.url).origin;
      const localRes = await fetch(`${origin}${url}`);
      const text = await localRes.text();
      return new NextResponse(text, {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    const parsed = new URL(url);
    if (parsed.hostname === '169.254.169.254' || parsed.hostname === '0.0.0.0') {
      return NextResponse.json({ error: 'URL bloqueada' }, { status: 403 });
    }

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Ratatube-Subtitle-Engine/1.0'
      }
    });
    if (!res.ok) {
      return NextResponse.json({ error: `HTTP ${res.status}` }, { status: 502 });
    }
    const text = await res.text();
    return new NextResponse(text, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Error al obtener subtítulo' }, { status: 500 });
  }
}

