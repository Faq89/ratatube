import { NextRequest, NextResponse } from 'next/server';
import { fetchStremioCatalog } from '@ratatube/addon-sdk';
import { getProfileFromMemory } from '@ratatube/database';
import { AgeRating, filterCatalogForProfile } from '@ratatube/shared';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const category = (searchParams.get('category') || 'movies') as any;
  const genre = searchParams.get('genre') || undefined;
  const search = searchParams.get('search') || undefined;
  const profileId = searchParams.get('profileId') || undefined;
  const maxRatingParam = searchParams.get('maxRating') as AgeRating | null;
  const isKidParam = searchParams.get('isKid');

  const rawItems = await fetchStremioCatalog({ category, genre, search });
  const memProfile = getProfileFromMemory(profileId);
  const filterRule = {
    isKid: isKidParam !== null ? isKidParam === 'true' : memProfile.isKid,
    maxAgeRating: maxRatingParam || memProfile.maxAgeRating || 'ALL'
  };

  const filtered = filterCatalogForProfile(rawItems, filterRule);

  return NextResponse.json({
    items: filtered,
    totalUnfiltered: rawItems.length,
    profileApplied: memProfile.name
  });
}

