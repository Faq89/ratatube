import { describe, it, expect } from 'vitest';
import os from 'os';
import fs from 'fs';
import path from 'path';
import {
  ensureTempDirectory,
  getTempDirectoryUsageBytes,
  purgeAllTempFiles,
  probeFfmpegVersion,
  getLocalAgentRuntimeStatus
} from '../server';

describe('Agente Local Windows (Solo Archivos Temporales y FFmpeg)', () => {
  it('almacena únicamente en la carpeta temporal del sistema operativo (os.tmpdir) y limpia al purgar', () => {
    const tempDir = ensureTempDirectory();
    expect(tempDir.startsWith(os.tmpdir())).toBe(true);

    const dummyFile = path.join(tempDir, 'test-chunk.tmp');
    fs.writeFileSync(dummyFile, Buffer.alloc(2048));
    expect(getTempDirectoryUsageBytes()).toBeGreaterThanOrEqual(2048);

    const purged = purgeAllTempFiles();
    expect(purged.removedFiles).toBeGreaterThanOrEqual(1);
    expect(getTempDirectoryUsageBytes()).toBe(0);
  });

  it('detecta el estado del Agente Local y la disponibilidad de FFmpeg en Windows', async () => {
    const ff = await probeFfmpegVersion();
    expect(typeof ff.available).toBe('boolean');

    const status = await getLocalAgentRuntimeStatus();
    expect(status.isOnline).toBe(true);
    expect(status.tempDir.startsWith(os.tmpdir())).toBe(true);
  });
});

