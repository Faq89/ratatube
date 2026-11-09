import { describe, it, expect } from 'vitest';
import {
  normalizeManifestUrl,
  getDefaultInstalledAddons,
  aggregateStremioStreams
} from '../index';

describe('Sistema de Addons Basado en Stremio (@ratatube/addon-sdk)', () => {
  it('convierte protocolos stremio:// a https:// y bloquea intentos SSRF de metadatos cloud', () => {
    expect(normalizeManifestUrl('stremio://v3-cinemeta.strem.io/manifest.json')).toBe(
      'https://v3-cinemeta.strem.io/manifest.json'
    );

    expect(() =>
      normalizeManifestUrl('http://169.254.169.254/latest/meta-data/manifest.json')
    ).toThrow(/SSRF/);
  });

  it('agrega streams de múltiples proveedores y prioriza Español Latino (es-419) en primer lugar', async () => {
    const addons = getDefaultInstalledAddons('family-1');
    const streams = await aggregateStremioStreams({
      type: 'movie',
      id: 'tt1254207',
      installedAddons: addons
    });

    expect(streams.length).toBeGreaterThanOrEqual(3);
    expect(streams[0].languageBucket).toBe('es-419');
    expect(streams[0].declaredAudioLabel).toContain('Español Latino');
  });

  it('marca las fuentes exclusivamente locales como no disponibles si el Agente Local se desconecta', async () => {
    const addons = getDefaultInstalledAddons('family-1');
    const streams = await aggregateStremioStreams({
      type: 'movie',
      id: 'tt1254207',
      installedAddons: addons,
      localAgentStreams: [
        {
          name: 'Archivo MKV del Portátil',
          title: 'Big.Buck.Bunny.1080p.Latino.mkv',
          url: 'http://127.0.0.1:45820/stream/local-1',
          audioLanguage: 'es-419',
          resolution: '1080p',
          localAgentOnline: false
        }
      ]
    });

    const localSource = streams.find((s) => s.sourceType === 'local-agent');
    expect(localSource).toBeDefined();
    expect(localSource?.availability).toBe('local-offline');
    expect(localSource?.connectionStatus).toBe('offline');
    // Las fuentes online siguen disponibles en primer lugar
    expect(streams[0].availability).toBe('available');
  });
});

