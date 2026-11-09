import { NextRequest, NextResponse } from 'next/server';
import { aggregateStremioSubtitles } from '@ratatube/addon-sdk';
import { getProfileFromMemory, getInstalledAddons } from '@ratatube/database';
import { LanguageBucket } from '@ratatube/shared';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const type = searchParams.get('type') || 'movie';
  const season = searchParams.get('season') ? Number(searchParams.get('season')) : undefined;
  const episode = searchParams.get('episode') ? Number(searchParams.get('episode')) : undefined;
  const profileId = searchParams.get('profileId') || undefined;
  const langPriorityParam = searchParams.get('langPriority');

  if (!id) {
    return NextResponse.json({ error: 'ID requerido' }, { status: 400 });
  }

  const installedAddons = await getInstalledAddons();
  const activeProfile = getProfileFromMemory(profileId);
  const parsedPriority = langPriorityParam
    ? (langPriorityParam.split(',').filter(Boolean) as LanguageBucket[])
    : activeProfile.languagePriority;

  const subtitles = await aggregateStremioSubtitles({
    type,
    id,
    season,
    episode,
    installedAddons,
    userLanguagePriority: parsedPriority
  });

  return NextResponse.json({ subtitles });
}

