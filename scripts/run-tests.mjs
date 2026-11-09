import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const tmpOutDir = path.join(os.tmpdir(), `ratatube-test-build-${Date.now()}`);

console.log('===================================================================');
console.log(' RATATUBE HYBRID MEDIA HUB — SUITE DE PRUEBAS INTEGRAL (FASES 1–8)');
console.log('===================================================================');

try {
  // Compilar los paquetes TypeScript hacia una carpeta temporal volátil en os.tmpdir()
  const tscBin = path.resolve('node_modules', 'typescript', 'bin', 'tsc');
  const tempTsConfig = path.join(tmpOutDir, 'tsconfig.test.json');
  fs.mkdirSync(tmpOutDir, { recursive: true });

  fs.writeFileSync(
    tempTsConfig,
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          module: 'CommonJS',
          moduleResolution: 'node',
          esModuleInterop: true,
          strict: false,
          skipLibCheck: true,
          outDir: tmpOutDir,
          rootDir: path.resolve('.'),
          baseUrl: path.resolve('.'),
          typeRoots: [path.resolve('node_modules/@types').replace(/\\/g, '/')],
          types: ['node'],
          paths: {
            '@ratatube/shared': ['packages/shared/src/index.ts'],
            '@ratatube/subtitle-engine': ['packages/subtitle-engine/src/index.ts'],
            '@ratatube/addon-sdk': ['packages/addon-sdk/src/index.ts'],
            '@ratatube/database': ['packages/database/src/index.ts']
          }
        },
        include: [
          path.resolve('packages/shared/src/**/*.ts').replace(/\\/g, '/'),
          path.resolve('packages/subtitle-engine/src/**/*.ts').replace(/\\/g, '/'),
          path.resolve('packages/addon-sdk/src/**/*.ts').replace(/\\/g, '/'),
          path.resolve('packages/database/src/**/*.ts').replace(/\\/g, '/'),
          path.resolve('apps/local-agent/src/server.ts').replace(/\\/g, '/')
        ],
        exclude: [path.resolve('**/*.test.ts').replace(/\\/g, '/')]
      },
      null,
      2
    )
  );

  execSync(`node "${tscBin}" -p "${tempTsConfig}"`, { stdio: 'inherit' });

  // Crear enlaces de resolución de módulos en tmpOutDir/node_modules/@ratatube/*
  const nmScope = path.join(tmpOutDir, 'node_modules', '@ratatube');
  fs.mkdirSync(nmScope, { recursive: true });
  for (const pkg of ['shared', 'subtitle-engine', 'addon-sdk', 'database']) {
    const dest = path.join(nmScope, pkg);
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(
      path.join(dest, 'index.js'),
      `module.exports = require(${JSON.stringify(
        path.join(tmpOutDir, 'packages', pkg, 'src', 'index.js')
      )});`
    );
  }

  const shared = await import(
    pathToFileURL(path.join(tmpOutDir, 'packages', 'shared', 'src', 'index.js')).href
  );
  const subEngine = await import(
    pathToFileURL(path.join(tmpOutDir, 'packages', 'subtitle-engine', 'src', 'index.js')).href
  );
  const addonSdk = await import(
    pathToFileURL(path.join(tmpOutDir, 'packages', 'addon-sdk', 'src', 'index.js')).href
  );
  const db = await import(
    pathToFileURL(path.join(tmpOutDir, 'packages', 'database', 'src', 'index.js')).href
  );
  const localAgent = await import(
    pathToFileURL(path.join(tmpOutDir, 'apps', 'local-agent', 'src', 'server.js')).href
  );

  let passed = 0;
  const runTest = async (phaseName, testName, fn) => {
    await fn();
    passed++;
    console.log(`  ✓ [${phaseName}] ${testName}`);
  };

  // FASE 1 y 7: Perfiles familiares, aislamiento de privacidad y controles parentales
  await runTest(
    'FASE 1 & 7',
    'Aislamiento estricto de progreso y favoritos entre perfiles familiares en Supabase/RAM',
    async () => {
      const { profiles } = await db.getFamilyAccountAndProfiles();
      assert.ok(profiles.length >= 3, 'Deben existir los perfiles iniciales');

      const customProfile = await db.createOrUpdateProfile({
        name: 'Perfil Test Aislado',
        avatar: '🦁',
        isKid: false
      });

      await db.saveWatchProgress({
        profileId: customProfile.id,
        mediaId: 'tt1254207',
        mediaType: 'movie',
        title: 'Big Buck Bunny',
        positionSeconds: 240,
        durationSeconds: 600
      });

      const customProg = await db.getWatchProgressForProfile(customProfile.id);
      const kidsProg = await db.getWatchProgressForProfile(db.KIDS_PROFILE_ID);
      assert.equal(customProg.length, 1);
      assert.equal(customProg[0].positionSeconds, 240);
      assert.equal(kidsProg.length, 0, 'El perfil infantil no debe ver el historial de otro perfil');

      // Verificar Modo Invitado (Sin sesión): 0 datos guardados en historial o biblioteca
      await db.saveWatchProgress({
        profileId: db.GUEST_PROFILE_ID,
        mediaId: 'tt1727587',
        mediaType: 'movie',
        title: 'Sintel',
        positionSeconds: 300,
        durationSeconds: 888
      });
      const guestProg = await db.getWatchProgressForProfile(db.GUEST_PROFILE_ID);
      const guestLib = await db.getLibraryForProfile(db.GUEST_PROFILE_ID);
      assert.equal(guestProg.length, 0, 'Modo Invitado debe tener historial 100% limpio');
      assert.equal(guestLib.length, 0, 'Modo Invitado debe tener biblioteca 100% limpia');
    }
  );

  await runTest(
    'FASE 1 & 7',
    'Filtro de Control Parental bloquea terror/clasificación R en perfiles infantiles',
    async () => {
      const horrorItem = {
        id: 'tt0063350',
        type: 'movie',
        name: 'Night of the Living Dead',
        genres: ['Horror', 'Thriller'],
        certification: 'R'
      };
      const familyItem = {
        id: 'tt1254207',
        type: 'movie',
        name: 'Big Buck Bunny',
        genres: ['Animation', 'Family'],
        certification: 'G'
      };

      assert.equal(
        shared.isMediaAllowedForProfile(horrorItem, { isKid: true, maxAgeRating: 'PG' }),
        false
      );
      assert.equal(
        shared.isMediaAllowedForProfile(familyItem, { isKid: true, maxAgeRating: 'PG' }),
        true
      );
    }
  );

  // FASE 2 y 3: Catálogo Stremio (Cinemeta), Sistema de Addons y Priorización de Idiomas
  await runTest(
    'FASE 2 & 3',
    'Normalización de enlaces stremio:// y bloqueo anti-SSRF de metadatos internos',
    async () => {
      assert.equal(
        addonSdk.normalizeManifestUrl('stremio://v3-cinemeta.strem.io/manifest.json'),
        'https://v3-cinemeta.strem.io/manifest.json'
      );
      assert.throws(() => {
        addonSdk.normalizeManifestUrl('http://169.254.169.254/latest/meta-data/manifest.json');
      });
    }
  );

  await runTest(
    'FASE 3 & 7',
    'Clasificador de idiomas distingue Español Latino (es-419) de Castellano (es-ES) y NO inventa datos',
    async () => {
      const lat = shared.classifyStreamLanguage({
        name: 'Stream 1080p',
        title: 'Película 🇲🇽 Audio Español Latino [es-419] 1080p'
      });
      assert.equal(lat.bucket, 'es-419');

      const cast = shared.classifyStreamLanguage({
        name: 'Stream 1080p',
        title: 'Película 🇪🇸 Audio Castellano [es-ES] 1080p'
      });
      assert.equal(cast.bucket, 'es-ES');

      const undeclared = shared.classifyStreamLanguage({
        name: 'HTTP Server',
        title: 'video_final_x264.mp4'
      });
      assert.equal(undeclared.bucket, 'unknown');
      assert.equal(undeclared.audioLabel, 'No especificado por el proveedor');
      assert.equal(
        shared.extractDeclaredResolution({ name: 'HTTP Server', title: 'video_final_x264.mp4' }),
        'No declarada'
      );
    }
  );

  await runTest(
    'FASE 3 & 4',
    'Agregador Stremio prioriza 1º Español Latino, 2º Castellano, 3º Original+Sub ES y degrada fuentes locales desconectadas',
    async () => {
      const addons = addonSdk.getDefaultInstalledAddons('family-test');
      const streams = await addonSdk.aggregateStremioStreams({
        type: 'movie',
        id: 'tt1254207',
        installedAddons: addons,
        localAgentStreams: [
          {
            name: 'Portátil Local',
            title: 'BigBuckBunny.mkv • 🇲🇽 Latino',
            url: 'http://127.0.0.1:45820/stream/1',
            audioLanguage: 'es-419',
            resolution: '1080p',
            localAgentOnline: false
          }
        ]
      });

      assert.ok(streams.length >= 3);
      assert.equal(streams[0].languageBucket, 'es-419');
      assert.equal(streams[0].availability, 'available');

      const offlineLocal = streams.find((s) => s.sourceType === 'local-agent');
      assert.ok(offlineLocal);
      assert.equal(offlineLocal.availability, 'local-offline');
    }
  );

  // FASE 5: Motor Avanzado de Subtítulos (SRT, VTT, ASS, SSA + Sync Inicial, Manual y Progresiva)
  await runTest(
    'FASE 5',
    'Motor de Subtítulos parsea SRT/VTT/ASS/SSA y aplica sincronización manual y progresiva en tiempo real',
    async () => {
      const srt = `1\n00:01:00,000 --> 00:01:04,000\nLínea en minuto 1\n\n2\n00:11:00,000 --> 00:11:04,000\nLínea en minuto 11`;
      const parsed = subEngine.parseAndValidateSubtitles(srt, 'movie.srt', 60250);
      assert.equal(parsed.isValid, true);
      assert.equal(parsed.cues.length, 2);
      assert.equal(parsed.autoSyncSuggestedOffsetMs, 250);

      // Ajuste progresivo entre 2 puntos (minuto 1 en 60000ms y minuto 11 desfasado +6000ms en 666000ms)
      const progParams = subEngine.calculateProgressiveSyncFromTwoPoints(
        { subtitleCueMs: 60000, actualVideoSpeechMs: 60000 },
        { subtitleCueMs: 660000, actualVideoSpeechMs: 666000 }
      );
      assert.equal(subEngine.computeSyncedTimestampMs(660000, progParams), 666000);
      const activeAt11m06s = subEngine.getActiveSubtitleCues(parsed.cues, 666500, progParams);
      assert.equal(activeAt11m06s.length, 1);
    }
  );

  // FASE 6: Agente Local Windows (Solo almacenamiento temporal os.tmpdir() + FFmpeg)
  await runTest(
    'FASE 6 & 8',
    'Agente Local utiliza exclusivamente carpeta temporal (os.tmpdir) y purga el 100% de archivos temporales',
    async () => {
      const tempDir = localAgent.ensureTempDirectory();
      assert.ok(tempDir.startsWith(os.tmpdir()), 'Debe usar exclusivamente os.tmpdir()');

      fs.writeFileSync(path.join(tempDir, 'sample-temp.part'), Buffer.alloc(4096));
      assert.ok(localAgent.getTempDirectoryUsageBytes() >= 4096);

      const purged = localAgent.purgeAllTempFiles();
      assert.ok(purged.removedFiles >= 1);
      assert.equal(localAgent.getTempDirectoryUsageBytes(), 0);

      const status = await localAgent.getLocalAgentRuntimeStatus();
      assert.equal(status.isOnline, true);
    }
  );

  console.log('-------------------------------------------------------------------');
  console.log(` ✅ TODAS LAS PRUEBAS SUPERADAS CON ÉXITO (${passed}/${passed} tests pasados)`);
  console.log('===================================================================');
} finally {
  // Limpiar siempre la carpeta temporal de compilación de tests
  try {
    fs.rmSync(tmpOutDir, { recursive: true, force: true });
  } catch {}
}
