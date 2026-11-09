import { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Proxy de medios same-origin por bloques (Range) para la "Descarga Temporal" en el navegador.
 * - Solo http/https, bloquea hosts locales/privados (anti-SSRF).
 * - Limita cada bloque a 16 MB para que cada invocación sea corta.
 * - No guarda nada en disco: los bytes se transmiten directamente al navegador.
 */
const MAX_CHUNK_BYTES = 16 * 1024 * 1024;

function isBlockedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) {
    return true;
  }
  if (h === '0.0.0.0' || h === '::1' || h === '[::1]') return true;
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
  }
  if (h.startsWith('[')) return true; // IPv6 literal: bloquear por seguridad
  return false;
}

export async function GET(req: NextRequest) {
  const target = req.nextUrl.searchParams.get('url');
  if (!target) {
    return new Response(JSON.stringify({ error: 'Parámetro url requerido' }), { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return new Response(JSON.stringify({ error: 'URL inválida' }), { status: 400 });
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || isBlockedHost(parsed.hostname)) {
    return new Response(JSON.stringify({ error: 'Destino no permitido' }), { status: 403 });
  }

  // Normalizar y acotar el rango solicitado
  const rangeHeader = req.headers.get('range') || 'bytes=0-';
  const rm = rangeHeader.match(/bytes=(\d+)-(\d*)/);
  const start = rm ? Number(rm[1]) : 0;
  const requestedEnd = rm && rm[2] ? Number(rm[2]) : start + MAX_CHUNK_BYTES - 1;
  const end = Math.min(requestedEnd, start + MAX_CHUNK_BYTES - 1);

  let upstream: Response;
  try {
    upstream = await fetch(parsed.toString(), {
      headers: {
        Range: `bytes=${start}-${end}`,
        'User-Agent': 'Mozilla/5.0 (Ratatube Media Proxy)'
      },
      redirect: 'follow'
    });
  } catch {
    return new Response(JSON.stringify({ error: 'No se pudo conectar con la fuente' }), { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    return new Response(JSON.stringify({ error: `La fuente respondió ${upstream.status}` }), {
      status: upstream.status === 416 ? 416 : 502
    });
  }

  const headers = new Headers();
  headers.set('Content-Type', upstream.headers.get('content-type') || 'video/mp4');
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Cache-Control', 'no-store');
  const contentRange = upstream.headers.get('content-range');
  const contentLength = upstream.headers.get('content-length');
  if (contentRange) headers.set('Content-Range', contentRange);
  if (contentLength) headers.set('Content-Length', contentLength);
  headers.set('Access-Control-Expose-Headers', 'Content-Range, Content-Length');

  return new Response(upstream.body, { status: upstream.status, headers });
}

