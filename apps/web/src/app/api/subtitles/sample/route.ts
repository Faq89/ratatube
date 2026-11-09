import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lang = searchParams.get('lang') || 'es-419';
  const format = searchParams.get('format') || 'srt';

  if (format === 'ass') {
    const assContent = `[Script Info]
Title: Subtítulos Español Latino (ASS Estilizado)
ScriptType: v4.00+

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.20,0:00:04.50,Default,,0,0,0,,{\\an8}[Audio e Idioma priorizado: Español Latino es-419]
Dialogue: 0,0:00:04.60,0:00:09.50,Default,,0,0,0,,¡Todo parece tranquilo en el bosque esta mañana!\\N(Puedes ajustar el tiempo en vivo con ±100ms, ±250ms o ±500ms)
Dialogue: 0,0:00:09.70,0:00:15.50,Default,,0,0,0,,Si notas que el subtítulo se retrasa poco a poco,\\Nactiva la Sincronización Progresiva (Escala Temporal).
Dialogue: 0,0:00:15.70,0:00:24.00,Default,,0,0,0,,Cada ajuste visual y de sincronización se guarda en tu perfil familiar en Supabase.
Dialogue: 0,0:00:24.20,0:00:35.00,Default,,0,0,0,,Disfruta de la reproducción directa sin almacenar archivos permanentes en tu equipo.
`;
    return new NextResponse(assContent, {
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }

  const isCastellano = lang.toLowerCase() === 'es-es';
  const srtContent = isCastellano
    ? `1
00:00:00,300 --> 00:00:04,500
[Subtítulos en Español Castellano (es-ES) activados]

2
00:00:04,700 --> 00:00:09,800
¡Menuda mañana hace hoy! Todo está listo para reproducir vuestro contenido.

3
00:00:10,000 --> 00:00:16,000
Podéis adelantar o retrasar los subtítulos en tiempo real desde el panel inferior.

4
00:00:16,300 --> 00:00:25,000
También podéis corregir el desfase progresivo si la versión del vídeo tiene distinto framerate.
`
    : `1
00:00:00,300 --> 00:00:04,500
[Subtítulos en Español Latino (es-419) activados]

2
00:00:04,700 --> 00:00:09,800
¡Qué gran mañana! Todo está listo para disfrutar la película en Español Latino.

3
00:00:10,000 --> 00:00:16,000
Puedes adelantar o retrasar los subtítulos en tiempo real (±100 ms, ±250 ms, ±500 ms).

4
00:00:16,300 --> 00:00:25,000
Si el desfase aumenta con los minutos, usa la Sincronización Progresiva (Escala Temporal).

5
00:00:25,500 --> 00:00:40,000
Tus ajustes visuales de fuente, color, borde y posición se mantienen en todos los proveedores.
`;

  return new NextResponse(srtContent, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  });
}

