import http from 'http';
import os from 'os';
import path from 'path';
import fs from 'fs';
import { spawn, execFile } from 'child_process';
import { LocalAgentStatus, TempDownloadItem } from '@ratatube/shared';

const TEMP_ROOT = path.join(os.tmpdir(), 'ratatube-ephemeral-cache');
const DEFAULT_QUOTA_BYTES =
  (Number(process.env.LOCAL_AGENT_TEMP_QUOTA_MB) || 8192) * 1024 * 1024;

export function ensureTempDirectory(): string {
  if (!fs.existsSync(TEMP_ROOT)) {
    fs.mkdirSync(TEMP_ROOT, { recursive: true });
  }
  return TEMP_ROOT;
}

export function getTempDirectoryUsageBytes(): number {
  if (!fs.existsSync(TEMP_ROOT)) return 0;
  let total = 0;
  for (const entry of fs.readdirSync(TEMP_ROOT)) {
    try {
      const stat = fs.statSync(path.join(TEMP_ROOT, entry));
      if (stat.isFile()) total += stat.size;
    } catch {
      // Ignorar archivos ya eliminados
    }
  }
  return total;
}

export function purgeAllTempFiles(): { removedFiles: number; freedBytes: number } {
  if (!fs.existsSync(TEMP_ROOT)) return { removedFiles: 0, freedBytes: 0 };
  let removedFiles = 0;
  let freedBytes = 0;

  for (const entry of fs.readdirSync(TEMP_ROOT)) {
    const fullPath = path.join(TEMP_ROOT, entry);
    try {
      const stat = fs.statSync(fullPath);
      if (stat.isFile()) {
        freedBytes += stat.size;
        fs.unlinkSync(fullPath);
        removedFiles++;
      }
    } catch {
      // Ignorar si ya fue liberado
    }
  }
  return { removedFiles, freedBytes };
}

export async function probeFfmpegVersion(): Promise<{
  available: boolean;
  version?: string;
}> {
  return new Promise((resolve) => {
    execFile('ffmpeg', ['-version'], { timeout: 3000 }, (err, stdout) => {
      if (err || !stdout) {
        resolve({ available: false });
        return;
      }
      const firstLine = stdout.split(/\r?\n/)[0] || 'FFmpeg detectado';
      resolve({ available: true, version: firstLine.trim() });
    });
  });
}

interface InternalTempDownload extends TempDownloadItem {
  tempFilePath: string;
  abortController?: AbortController;
}

const activeTempDownloads = new Map<string, InternalTempDownload>();

export function listTempDownloads(): TempDownloadItem[] {
  return Array.from(activeTempDownloads.values()).map(({ tempFilePath, abortController, ...publicItem }) => publicItem);
}

export async function startOrResumeTempDownload(input: {
  id?: string;
  mediaId: string;
  title: string;
  episodeLabel?: string;
  sourceUrl: string;
  category?: 'temp_download' | 'stream_cache';
}): Promise<TempDownloadItem> {
  ensureTempDirectory();
  const id = input.id || `tempdl-${Date.now()}`;
  const existing = activeTempDownloads.get(id);

  const safeFileName = `${id.replace(/[^a-zA-Z0-9_-]/g, '')}.mp4.part`;
  const tempFilePath = existing?.tempFilePath || path.join(TEMP_ROOT, safeFileName);
  const startByte = fs.existsSync(tempFilePath) ? fs.statSync(tempFilePath).size : 0;

  const expiresAt = new Date(Date.now() + 12 * 3600 * 1000).toISOString(); // Expira en 12h automáticamente
  const controller = new AbortController();

  const item: InternalTempDownload = existing || {
    id,
    mediaId: input.mediaId,
    title: input.title,
    episodeLabel: input.episodeLabel,
    sourceUrl: input.sourceUrl,
    category: input.category || 'temp_download',
    status: 'downloading',
    bytesDownloaded: startByte,
    totalBytes: 0,
    progressPct: 0,
    speedBps: 0,
    playableLocalUrl: `/api/temp-downloads/stream?id=${encodeURIComponent(id)}`,
    expiresAt,
    createdAt: new Date().toISOString(),
    tempFilePath
  };

  item.status = 'downloading';
  item.abortController = controller;
  activeTempDownloads.set(id, item);

  // Ejecutar descarga asíncrona con soporte de reanudación por Range
  (async () => {
    try {
      const headers: Record<string, string> = {};
      if (startByte > 0) {
        headers['Range'] = `bytes=${startByte}-`;
      }
      const res = await fetch(input.sourceUrl, {
        headers,
        signal: controller.signal
      });
      if (!res.ok || !res.body) {
        item.status = 'error';
        return;
      }

      const contentLen = Number(res.headers.get('content-length') || 0);
      item.totalBytes = startByte + contentLen;

      const fileStream = fs.createWriteStream(tempFilePath, {
        flags: startByte > 0 ? 'a' : 'w'
      });

      const reader = res.body.getReader();
      let lastTick = Date.now();
      let bytesSinceTick = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          fileStream.write(Buffer.from(value));
          item.bytesDownloaded += value.byteLength;
          bytesSinceTick += value.byteLength;
          if (item.totalBytes > 0) {
            item.progressPct = Math.min(100, Math.round((item.bytesDownloaded / item.totalBytes) * 100));
          }
          const now = Date.now();
          if (now - lastTick >= 500) {
            item.speedBps = Math.round((bytesSinceTick * 1000) / (now - lastTick));
            bytesSinceTick = 0;
            lastTick = now;
          }
        }
      }

      fileStream.end();
      item.status = 'ready';
      item.progressPct = 100;
      item.speedBps = 0;
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        item.status = 'paused';
        item.speedBps = 0;
      } else {
        item.status = 'error';
        item.speedBps = 0;
      }
    }
  })();

  const { tempFilePath: _, abortController: __, ...publicItem } = item;
  return publicItem;
}

export function pauseTempDownload(id: string): TempDownloadItem | null {
  const item = activeTempDownloads.get(id);
  if (!item) return null;
  if (item.abortController) {
    item.abortController.abort();
  }
  item.status = 'paused';
  item.speedBps = 0;
  const { tempFilePath: _, abortController: __, ...publicItem } = item;
  return publicItem;
}

export function deleteTempDownload(id: string): boolean {
  const item = activeTempDownloads.get(id);
  if (!item) return false;
  if (item.abortController) {
    item.abortController.abort();
  }
  try {
    if (fs.existsSync(item.tempFilePath)) {
      fs.unlinkSync(item.tempFilePath);
    }
  } catch {
    // Ignorar error de borrado
  }
  activeTempDownloads.delete(id);
  return true;
}

export function getTempDownloadFilePath(id: string): string | null {
  const item = activeTempDownloads.get(id);
  if (!item || !fs.existsSync(item.tempFilePath)) return null;
  return item.tempFilePath;
}

export async function getLocalAgentRuntimeStatus(): Promise<LocalAgentStatus> {
  ensureTempDirectory();
  const ff = await probeFfmpegVersion();
  const usedBytes = getTempDirectoryUsageBytes();
  return {
    isOnline: true,
    deviceName: os.hostname() || 'Portátil Windows Local',
    endpointUrl: `http://127.0.0.1:${process.env.LOCAL_AGENT_PORT || 45820}`,
    ffmpegAvailable: ff.available,
    ffmpegVersion: ff.version,
    tempDir: TEMP_ROOT,
    tempUsedBytes: usedBytes,
    tempQuotaBytes: DEFAULT_QUOTA_BYTES,
    indexedFilesCount: 0,
    activeDownloadsCount: Array.from(activeTempDownloads.values()).filter(
      (d) => d.status === 'downloading'
    ).length,
    lastHeartbeatAt: new Date().toISOString()
  };
}

/**
 * Crea el servidor HTTP del Agente Local (para remux en vivo con FFmpeg y streaming Range 206).
 */
export function createLocalAgentHttpServer(): http.Server {
  return http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', 'http://127.0.0.1');

    if (url.pathname === '/status') {
      const status = await getLocalAgentRuntimeStatus();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status));
      return;
    }

    // Remultiplexado al vuelo con FFmpeg (MKV / AC3 -> fMP4 sin recodificar vídeo)
    if (url.pathname === '/remux') {
      const source = url.searchParams.get('source');
      if (!source) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Parámetro source requerido' }));
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'video/mp4',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-store'
      });

      const ffArgs = [
        '-i', source,
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-f', 'mp4',
        '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
        'pipe:1'
      ];

      const ffProc = spawn('ffmpeg', ffArgs, { stdio: ['ignore', 'pipe', 'ignore'] });
      ffProc.stdout.pipe(res);
      req.on('close', () => {
        ffProc.kill('SIGKILL');
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Ruta no encontrada en Agente Local' }));
  });
}

// Si se ejecuta directamente como demonio en Windows
if (process.argv[1] && process.argv[1].endsWith('server.ts')) {
  const port = Number(process.env.LOCAL_AGENT_PORT) || 45820;
  const server = createLocalAgentHttpServer();
  server.listen(port, '127.0.0.1', async () => {
    const st = await getLocalAgentRuntimeStatus();
    console.log(`[Ratatube Local Agent] Activo en ${st.endpointUrl}`);
    console.log(`[Ratatube Local Agent] Carpeta Temporal Volátil: ${st.tempDir}`);
    console.log(`[Ratatube Local Agent] FFmpeg: ${st.ffmpegVersion || 'No detectado'}`);
  });

  const cleanExit = () => {
    purgeAllTempFiles();
    process.exit(0);
  };
  process.on('SIGINT', cleanExit);
  process.on('SIGTERM', cleanExit);
}
