import { AgeRating, FamilyProfile, StremioMetaItem } from './types';

const RATING_HIERARCHY: Record<AgeRating, number> = {
  G: 1,
  PG: 2,
  'PG-13': 3,
  R: 4,
  ALL: 5
};

const KID_BLOCKED_GENRES = [
  'horror',
  'terror',
  'crime',
  'crimen',
  'thriller',
  'erotic',
  'adult'
];

const KID_SAFE_GENRES = [
  'animation',
  'animación',
  'family',
  'familia',
  'kids',
  'infantil',
  'adventure',
  'aventura',
  'comedy',
  'comedia',
  'fantasy',
  'fantasía'
];

/**
 * Normaliza una certificación de IMDb / TMDB / Stremio a nuestra escala AgeRating.
 */
export function normalizeCertification(cert?: string): AgeRating {
  if (!cert) return 'PG-13';
  const c = cert.toUpperCase().trim();
  if (['G', 'TV-Y', 'TV-G', 'ATP', 'AA', 'A', '0+', 'ALL'].includes(c)) return 'G';
  if (['PG', 'TV-Y7', 'TV-PG', '7+', '10+', 'B'].includes(c)) return 'PG';
  if (['PG-13', 'TV-14', '12+', '13+', '14+', 'B-15'].includes(c)) return 'PG-13';
  if (['R', 'NC-17', 'TV-MA', '16+', '18+', 'C', 'D'].includes(c)) return 'R';
  return 'PG-13';
}

/**
 * Determina si un elemento del catálogo está permitido para el perfil familiar activo.
 */
export function isMediaAllowedForProfile(
  item: StremioMetaItem,
  profile: Pick<FamilyProfile, 'isKid' | 'maxAgeRating'>
): boolean {
  const genres = (item.genres || []).map((g) => g.toLowerCase());

  if (profile.isKid) {
    // Bloquear inmediatamente géneros de terror/crimen/thriller/adultos
    if (genres.some((g) => KID_BLOCKED_GENRES.includes(g))) {
      return false;
    }
    // Si tiene certificación explícita R o PG-13, bloquear en perfil infantil
    if (item.certification) {
      const normalized = normalizeCertification(item.certification);
      if (RATING_HIERARCHY[normalized] > RATING_HIERARCHY['PG']) {
        return false;
      }
    }
    // Si tiene géneros declarados, priorizar que pertenezca a géneros aptos para niños/familia
    if (genres.length > 0 && !genres.some((g) => KID_SAFE_GENRES.includes(g))) {
      return false;
    }
    return true;
  }

  if (profile.maxAgeRating === 'ALL') {
    return true;
  }

  const maxLevel = RATING_HIERARCHY[profile.maxAgeRating] || 5;
  const itemLevel = item.certification
    ? RATING_HIERARCHY[normalizeCertification(item.certification)]
    : genres.some((g) => KID_BLOCKED_GENRES.includes(g))
    ? RATING_HIERARCHY['R']
    : RATING_HIERARCHY['PG-13'];

  return itemLevel <= maxLevel;
}

export function filterCatalogForProfile(
  items: StremioMetaItem[],
  profile?: Pick<FamilyProfile, 'isKid' | 'maxAgeRating'> | null
): StremioMetaItem[] {
  if (!profile) return items;
  return items.filter((item) => isMediaAllowedForProfile(item, profile));
}

