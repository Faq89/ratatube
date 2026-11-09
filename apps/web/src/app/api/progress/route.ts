import { NextRequest, NextResponse } from 'next/server';
import {
  getWatchProgressForProfile,
  saveWatchProgress,
  getSubtitleSyncPreset,
  saveSubtitleSyncPreset
} from '@ratatube/database';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const profileId = searchParams.get('profileId') || 'profile-admin';
  const mediaId = searchParams.get('mediaId');

  const progress = await getWatchProgressForProfile(profileId);

  if (mediaId) {
    const season = Number(searchParams.get('season') || 0);
    const episode = Number(searchParams.get('episode') || 0);
    const syncPreset = await getSubtitleSyncPreset(profileId, mediaId, season, episode);
    return NextResponse.json({ progress, syncPreset });
  }

  return NextResponse.json({ progress });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (body.action === 'save-subtitle-sync') {
      const preset = await saveSubtitleSyncPreset({
        profileId: body.profileId || 'profile-admin',
        mediaId: body.mediaId,
        season: Number(body.season || 0),
        episode: Number(body.episode || 0),
        subtitleId: body.subtitleId || 'default',
        initialOffsetMs: Number(body.initialOffsetMs || 0),
        driftScaleFactor: Number(body.driftScaleFactor || 1.0),
        referencePointMs: Number(body.referencePointMs || 0)
      });
      return NextResponse.json({ preset });
    }

    const saved = await saveWatchProgress(body);
    const progress = await getWatchProgressForProfile(body.profileId || 'profile-admin');
    return NextResponse.json({ saved, progress });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

