import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import { getTempDownloadFilePath } from '@ratatube/local-agent/src/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'ID requerido' }, { status: 400 });
  }

  const filePath = getTempDownloadFilePath(id);
  if (!filePath || !fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'Archivo temporal no disponible o expirado' }, { status: 404 });
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.get('range');

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = end - start + 1;
    const buffer = Buffer.alloc(chunksize);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buffer, 0, chunksize, start);
    fs.closeSync(fd);

    return new NextResponse(buffer, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunksize),
        'Content-Type': 'video/mp4'
      }
    });
  }

  const data = fs.readFileSync(filePath);
  return new NextResponse(data, {
    status: 200,
    headers: {
      'Content-Length': String(fileSize),
      'Content-Type': 'video/mp4',
      'Accept-Ranges': 'bytes'
    }
  });
}

