import { NextRequest, NextResponse } from 'next/server';
import {
  getLocalAgentRuntimeStatus,
  listTempDownloads,
  startOrResumeTempDownload,
  pauseTempDownload,
  deleteTempDownload,
  purgeAllTempFiles
} from '@ratatube/local-agent/src/server';

export async function GET() {
  const [status, downloads] = await Promise.all([
    getLocalAgentRuntimeStatus(),
    Promise.resolve(listTempDownloads())
  ]);

  return NextResponse.json({ status, downloads });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (body.action === 'pause' && body.id) {
      pauseTempDownload(body.id);
      const status = await getLocalAgentRuntimeStatus();
      return NextResponse.json({ status, downloads: listTempDownloads() });
    }

    if (body.action === 'purge-all') {
      const result = purgeAllTempFiles();
      const status = await getLocalAgentRuntimeStatus();
      return NextResponse.json({ result, status, downloads: listTempDownloads() });
    }

    const item = await startOrResumeTempDownload({
      id: body.id,
      mediaId: body.mediaId,
      title: body.title,
      episodeLabel: body.episodeLabel,
      sourceUrl: body.sourceUrl,
      category: body.category || 'temp_download'
    });

    const status = await getLocalAgentRuntimeStatus();
    return NextResponse.json({ item, status, downloads: listTempDownloads() });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (id) {
    deleteTempDownload(id);
  }
  const status = await getLocalAgentRuntimeStatus();
  return NextResponse.json({ status, downloads: listTempDownloads() });
}

