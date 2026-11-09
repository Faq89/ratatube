import { describe, it, expect } from 'vitest';
import {
  classifyStreamLanguage,
  extractDeclaredResolution,
  filterAndSortStreams,
  isMediaAllowedForProfile
} from '../index';

describe('Priorización de Idiomas y Clasificador Estricto (Español Latino vs Castellano)', () => {
  it('distingue correctamente Español Latino (es-419 / MX) de Español Castellano (es-ES)', () => {
    const latinoStream = classifyStreamLanguage({
      name: 'Ratatube 1080p',
      title: 'Película Completa 🇲🇽 Audio Latino [es-419] 1080p'
    });
    expect(latinoStream.bucket).toBe('es-419');
    expect(latinoStream.audioLabel).toContain('Español Latino');

    const castellanoStream = classifyStreamLanguage({
      name: 'Stream 1080p',
      title: 'Película 🇪🇸 Audio Castellano [es-ES]'
    });
    expect(castellanoStream.bucket).toBe('es-ES');
    expect(castellanoStream.audioLabel).toContain('Castellano');
  });

  it('NO inventa idioma ni calidad cuando el proveedor no los declara', () => {
    const unknownStream = classifyStreamLanguage({
      name: 'Servidor HTTP Directo',
      title: 'Pelicula_Archivo_Final.mp4'
    });
    expect(unknownStream.bucket).toBe('unknown');
    expect(unknownStream.audioLabel).toBe('No especificado por el proveedor');

    const resolution = extractDeclaredResolution({
      name: 'Servidor HTTP Directo',
      title: 'Pelicula_Archivo_Final.mp4'
    });
    expect(resolution).toBe('No declarada');
  });

  it('ordena las fuentes en el orden predeterminado: 1º Latino, 2º Castellano, 3º Original+Sub ES, 4º Original', () => {
    const sampleStreams: any[] = [
      {
        id: '1',
        languageBucket: 'orig-other',
        declaredResolution: '1080p',
        availability: 'available',
        declaredSubtitles: []
      },
      {
        id: '2',
        languageBucket: 'es-ES',
        declaredResolution: '1080p',
        availability: 'available',
        declaredSubtitles: []
      },
      {
        id: '3',
        languageBucket: 'es-419',
        declaredResolution: '1080p',
        availability: 'available',
        declaredSubtitles: []
      },
      {
        id: '4',
        languageBucket: 'orig-sub-es',
        declaredResolution: '1080p',
        availability: 'available',
        declaredSubtitles: ['Español']
      }
    ];

    const sorted = filterAndSortStreams(sampleStreams, 'all');
    expect(sorted.map((s) => s.languageBucket)).toEqual([
      'es-419',
      'es-ES',
      'orig-sub-es',
      'orig-other'
    ]);

    const onlyLatino = filterAndSortStreams(sampleStreams, 'es-419-only');
    expect(onlyLatino).toHaveLength(1);
    expect(onlyLatino[0].id).toBe('3');
  });
});

describe('Controles Parentales y Perfiles Infantiles', () => {
  it('bloquea contenido de terror o clasificación R en perfiles infantiles', () => {
    const horrorMovie = {
      id: 'tt001',
      type: 'movie',
      name: 'Noche de Terror',
      genres: ['Horror', 'Thriller'],
      certification: 'R'
    };
    const familyAnimation = {
      id: 'tt002',
      type: 'movie',
      name: 'Aventura Animada',
      genres: ['Animation', 'Family'],
      certification: 'G'
    };

    expect(isMediaAllowedForProfile(horrorMovie, { isKid: true, maxAgeRating: 'PG' })).toBe(false);
    expect(isMediaAllowedForProfile(familyAnimation, { isKid: true, maxAgeRating: 'PG' })).toBe(true);
  });
});

