import { NextRequest, NextResponse } from 'next/server';
import { getLibraryForProfile, upsertLibraryItem } from '@ratatube/database';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const profileId = searchParams.get('profileId') || 'profile-admin';
  const items = await getLibraryForProfile(profileId);
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const item = await upsertLibraryItem(body);
    const items = await getLibraryForProfile(body.profileId || 'profile-admin');
    return NextResponse.json({ item, items });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}

