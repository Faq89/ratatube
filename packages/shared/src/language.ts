import {
  EnrichedStreamSource,
  LanguageBucket,
  LanguageFilterMode,
  StremioRawStream
} from './types';

export const DEFAULT_LANGUAGE_PRIORITY: LanguageBucket[] = [
  'es-419',
  'es-ES',
  'orig-sub-es',
  'orig-other'
];

/**
 * Clasifica el idioma de audio y subtítulos declarados por un stream de Stremio o del Agente Local.
 * REGLA OBLIGATORIA: Nunca inventa ni asume idiomas si el proveedor no incluye etiquetas o metadatos explícitos.
 */
export function classifyStreamLanguage(
  raw: StremioRawStream,
  hasExternalSpanishSubtitles = false
): {
  bucket: LanguageBucket;
  audioLabel: string;
  subtitlesLabels: string[];
} {
  const subtitlesLabels: string[] = [];

  // 1. Revisar subtítulos declarados dentro del propio stream
  let streamHasSpanishSub = hasExternalSpanishSubtitles;
  if (Array.isArray(raw.subtitles)) {
    for (const sub of raw.subtitles) {
      const lang = (sub.lang || '').toLowerCase();
      if (lang === 'es-419' || lang === 'spl' || lang === 'es-mx' || lang.includes('lat')) {
        subtitlesLabels.push('Español Latino');
        streamHasSpanishSub = true;
      } else if (lang === 'es-es' || lang.includes('cast')) {
        subtitlesLabels.push('Español Castellano');
        streamHasSpanishSub = true;
      } else if (lang === 'es' || lang === 'spa' || lang === 'spanish') {
        subtitlesLabels.push('Español');
        streamHasSpanishSub = true;
      } else if (lang) {
        subtitlesLabels.push(sub.label || sub.lang.toUpperCase());
      }
    }
  }

  // 2. Revisar pistas de audio estructuradas (ej. FFprobe del Agente Local o proveedor enriquecido)
  const explicitLangs: string[] = [];
  if (raw.audioLanguage) {
    explicitLangs.push(raw.audioLanguage.toLowerCase().trim());
  }
  if (Array.isArray(raw.audioTracks)) {
    for (const track of raw.audioTracks) {
      if (track.lang) explicitLangs.push(track.lang.toLowerCase().trim());
      if (track.label) explicitLangs.push(track.label.toLowerCase().trim());
    }
  }

  for (const tag of explicitLangs) {
    if (
      tag === 'es-419' ||
      tag === 'es-mx' ||
      tag === 'es-ar' ||
      tag === 'es-co' ||
      tag === 'es-cl' ||
      tag === 'spl' ||
      tag.includes('latino') ||
      tag.includes('latam')
    ) {
      return {
        bucket: 'es-419',
        audioLabel: 'Español Latino (es-419)',
        subtitlesLabels
      };
    }
    if (
      tag === 'es-es' ||
      tag.includes('castellano') ||
      tag.includes('españa')
    ) {
      return {
        bucket: 'es-ES',
        audioLabel: 'Español Castellano (es-ES)',
        subtitlesLabels
      };
    }
  }

  // 3. Revisar metadatos descriptivos de addons Stremio (name / title / description)
  // Solo se evalúan marcadores explícitos de idioma que usan los addons de Stremio (banderas, tags [LAT], [CAST], etc.)
  const descriptorText = [raw.name || '', raw.title || '', raw.description || ''].join(' ');

  const hasLatinoMarker =
    /🇲🇽|🇦🇷|🇨🇴|🇨🇱|🇵🇪|🇻🇪/i.test(descriptorText) ||
    /(?:^|[\s_.\-\(\[\{])(es-419|es-la|es-mx|es-ar|latino|latam|audio[\s_.-]*latino|esp[\s_.-]*latino|dual[\s_.-]*lat(?:ino)?|lat|spa-lat)(?:$|[\s_.\-\)\]\}])/i.test(
      descriptorText
    );
  const hasCastellanoMarker =
    /🇪🇸/i.test(descriptorText) ||
    /(?:^|[\s_.\-\(\[\{])(es-es|castellano|cast|esp-es|audio[\s_.-]*castellano|esp[\s_.-]*castellano)(?:$|[\s_.\-\)\]\}])/i.test(
      descriptorText
    );
  const hasSpanishSubMarker =
    /\b(sub\s*esp|subs?\s*español|subtitulado\s*es|vose)\b/i.test(descriptorText);

  if (hasSpanishSubMarker && !subtitlesLabels.includes('Español')) {
    subtitlesLabels.push('Español');
    streamHasSpanishSub = true;
  }

  if (hasLatinoMarker) {
    return {
      bucket: 'es-419',
      audioLabel: 'Español Latino (es-419)',
      subtitlesLabels: hasCastellanoMarker
        ? [...new Set([...subtitlesLabels, 'Dual (Incluye Castellano)'])]
        : subtitlesLabels
    };
  }

  if (hasCastellanoMarker) {
    return {
      bucket: 'es-ES',
      audioLabel: 'Español Castellano (es-ES)',
      subtitlesLabels
    };
  }

  // 4. Español genérico declarado explícitamente sin región (no se confunde con Latino ni Castellano)
  for (const tag of explicitLangs) {
    if (tag === 'es' || tag === 'spa' || tag === 'spanish' || tag === 'español') {
      return {
        bucket: 'es-neutral',
        audioLabel: 'Español (Región no especificada)',
        subtitlesLabels
      };
    }
  }

  // 5. Audio original explícito (Inglés, Japonés, Coreano, Francés, etc.)
  const hasOriginalAudioExplicit =
    explicitLangs.some((t) =>
      ['en', 'eng', 'english', 'ja', 'jpn', 'japanese', 'ko', 'kor', 'fr', 'fra', 'pt', 'de', 'it', 'original'].includes(t)
    ) ||
    /🇬🇧|🇺🇸|🇯🇵|🇰🇷|\b(english|ingl[eé]s|japanese|japon[eé]s|vose|multi-sub|audio\s*original)\b/i.test(
      descriptorText
    );

  if (hasOriginalAudioExplicit) {
    const origLangName = explicitLangs.find((l) => l.startsWith('ja') || l.startsWith('jp'))
      ? 'Japonés (Original)'
      : explicitLangs.find((l) => l.startsWith('en'))
      ? 'Inglés (Original)'
      : 'Audio Original';

    if (streamHasSpanishSub) {
      return {
        bucket: 'orig-sub-es',
        audioLabel: `${origLangName} + Subtítulos ES`,
        subtitlesLabels: subtitlesLabels.length ? subtitlesLabels : ['Español (Disponible)']
      };
    }

    return {
      bucket: 'orig-other',
      audioLabel: origLangName,
      subtitlesLabels
    };
  }

  // 6. Si el proveedor no declaró el idioma de audio, NO se inventa
  return {
    bucket: 'unknown',
    audioLabel: 'No especificado por el proveedor',
    subtitlesLabels
  };
}

/**
 * Extrae la resolución declarada por el proveedor sin inventarla cuando no está presente.
 */
export function extractDeclaredResolution(raw: StremioRawStream): string {
  if (raw.resolution) {
    return raw.resolution;
  }
  const text = [
    raw.name || '',
    raw.title || '',
    raw.description || '',
    raw.behaviorHints?.filename || ''
  ].join(' ');

  if (/\b(2160p|4k|uhd)\b/i.test(text)) return '4K (2160p)';
  if (/\b(1440p|2k)\b/i.test(text)) return '1440p (2K)';
  if (/\b(1080p|fhd|full\s*hd)\b/i.test(text)) return '1080p';
  if (/\b(720p|hd)\b/i.test(text)) return '720p';
  if (/\b(480p|sd)\b/i.test(text)) return '480p';

  return 'No declarada';
}

/**
 * Calcula la puntuación de prioridad de una fuente según el orden de preferencias del perfil activo.
 */
export function calculateStreamPriorityScore(
  bucket: LanguageBucket,
  resolution: string,
  availability: EnrichedStreamSource['availability'],
  userPriorityOrder: LanguageBucket[] = DEFAULT_LANGUAGE_PRIORITY
): number {
  if (availability === 'local-offline') {
    return -1000;
  }

  let score = 0;
  const idx = userPriorityOrder.indexOf(bucket);
  if (idx === 0) score += 400;      // 1º Preferido (ej. Español Latino)
  else if (idx === 1) score += 300; // 2º Preferido (ej. Español Castellano)
  else if (idx === 2) score += 200; // 3º Preferido (ej. Original + Sub ES)
  else if (idx === 3) score += 100; // 4º Preferido (ej. Original + Otros)
  else if (bucket === 'es-neutral') score += 250; // Español sin región entre 2º y 3º
  else score += 20;                 // Idioma no declarado por el proveedor

  // Bonificación secundaria por resolución declarada
  if (resolution.includes('2160p') || resolution.includes('4K')) score += 40;
  else if (resolution.includes('1080p')) score += 30;
  else if (resolution.includes('720p')) score += 20;
  else if (resolution.includes('480p')) score += 10;

  // Bonificación por disponibilidad directa en navegador web sin requerir motor P2P local
  if (availability === 'available') score += 150;
  else if (availability === 'requires-agent') score -= 50;

  return score;
}

/**
 * Filtra y ordena la lista de fuentes según el filtro activo y el orden de idiomas del perfil.
 */
export function filterAndSortStreams(
  streams: EnrichedStreamSource[],
  filterMode: LanguageFilterMode,
  userPriorityOrder: LanguageBucket[] = DEFAULT_LANGUAGE_PRIORITY
): EnrichedStreamSource[] {
  const recalculated = streams.map((s) => ({
    ...s,
    priorityScore: calculateStreamPriorityScore(
      s.languageBucket,
      s.declaredResolution,
      s.availability,
      userPriorityOrder
    )
  }));

  const filtered = recalculated.filter((s) => {
    switch (filterMode) {
      case 'es-419-only':
        return s.languageBucket === 'es-419';
      case 'es-any':
        return (
          s.languageBucket === 'es-419' ||
          s.languageBucket === 'es-ES' ||
          s.languageBucket === 'es-neutral'
        );
      case 'sub-es':
        return (
          s.languageBucket === 'orig-sub-es' ||
          s.declaredSubtitles.some((sub) => sub.toLowerCase().includes('español'))
        );
      case 'original':
        return s.languageBucket === 'orig-sub-es' || s.languageBucket === 'orig-other';
      case 'all':
      default:
        return true;
    }
  });

  return filtered.sort((a, b) => b.priorityScore - a.priorityScore);
}

