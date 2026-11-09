import { NextRequest, NextResponse } from 'next/server';
import { aggregateStremioStreams } from '@ratatube/addon-sdk';
import { getProfileFromMemory, getInstalledAddons } from '@ratatube/database';
import { LanguageBucket } from '@ratatube/shared';
import { listTempDownloads } from '@ratatube/local-agent/src/server';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const type = searchParams.get('type') || 'movie';
  const season = searchParams.get('season') ? Number(searchParams.get('season')) : undefined;
  const episode = searchParams.get('episode') ? Number(searchParams.get('episode')) : undefined;
  const profileId = searchParams.get('profileId') || undefined;
  const langPriorityParam = searchParams.get('langPriority');
  const agentOnlineParam = searchParams.get('agentOnline');

  if (!id) {
    return NextResponse.json({ error: 'ID requerido' }, { status: 400 });
  }

  const installedAddons = await getInstalledAddons();
  const activeProfile = getProfileFromMemory(profileId);
  const parsedPriority = langPriorityParam
    ? (langPriorityParam.split(',').filter(Boolean) as LanguageBucket[])
    : activeProfile.languagePriority;
  const isAgentOnline = agentOnlineParam !== 'false';

  // Incluir descargas temporales listas o en curso del Agente Local para este mediaId
  const tempDownloads = listTempDownloads().filter((d) => d.mediaId === id);
  const localStreams = tempDownloads.map((d) => ({
    name: 'Agente Local (Descarga Temporal)',
    title: `${d.title} • Caché Temporal (${d.progressPct}%) • 🇲🇽 Español Latino [es-419] 1080p`,
    url: d.playableLocalUrl,
    audioLanguage: 'es-419',
    resolution: '1080p',
    isLocalAgent: true,
    localAgentOnline: isAgentOnline,
    behaviorHints: {
      videoSize: d.totalBytes || d.bytesDownloaded
    }
  }));

  const streams = await aggregateStremioStreams({
    type,
    id,
    season,
    episode,
    installedAddons,
    userLanguagePriority: parsedPriority,
    localAgentStreams: localStreams
  });

  return NextResponse.json({ streams });
}

