import { NextRequest, NextResponse } from 'next/server';
import { fetchStremioMeta } from '@ratatube/addon-sdk';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const type = searchParams.get('type') || 'movie';

  if (!id) {
    return NextResponse.json({ error: 'ID requerido' }, { status: 400 });
  }

  const meta = await fetchStremioMeta(type, id);
  if (!meta) {
    return NextResponse.json({ error: 'Contenido no encontrado' }, { status: 404 });
  }

  return NextResponse.json({ meta });
}

