export type SubtitleFormat = 'srt' | 'vtt' | 'ass' | 'ssa';

export interface SubtitleCue {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
  rawText: string;
  alignment?: 'bottom' | 'top';
  customColor?: string;
}

export interface SubtitleSyncParams {
  initialOffsetMs: number;    // Desfase manual o inicial en ms (+ adelanta/retrasa aparición, ej. +500ms o -250ms)
  driftScaleFactor: number;   // Velocidad temporal de los subtítulos (1.0 = normal)
  referencePointMs: number;   // Punto temporal de referencia en ms
}

export interface SubtitleParseResult {
  format: SubtitleFormat;
  cues: SubtitleCue[];
  isValid: boolean;
  warnings: string[];
  autoSyncSuggestedOffsetMs: number;
  firstDialogueMs: number;
  lastDialogueMs: number;
}

export const FPS_DRIFT_PRESETS: Array<{ label: string; scale: number; description: string }> = [
  { label: 'Estándar (1.00000x — Sin desfase progresivo)', scale: 1.0, description: 'Velocidad original 1:1' },
  { label: '23.976 fps → 25 fps (PAL Speedup 0.95904x)', scale: 23.976 / 25, description: 'Subtítulo se retrasa progresivamente' },
  { label: '25 fps → 23.976 fps (PAL a NTSC 1.04271x)', scale: 25 / 23.976, description: 'Subtítulo se adelanta progresivamente' },
  { label: '23.976 fps → 24 fps (Cine 0.99900x)', scale: 23.976 / 24, description: 'Corrección fina NTSC a Cine 24p' },
  { label: '24 fps → 23.976 fps (Cine a NTSC 1.00100x)', scale: 24 / 23.976, description: 'Corrección fina Cine 24p a NTSC' }
];

export const DEFAULT_SYNC_PARAMS: SubtitleSyncParams = {
  initialOffsetMs: 0,
  driftScaleFactor: 1.0,
  referencePointMs: 0
};

/**
 * Detecta el formato de subtítulo por contenido o nombre de archivo.
 */
export function detectSubtitleFormat(rawContent: string, filename = ''): SubtitleFormat {
  const lowerName = filename.toLowerCase();
  if (lowerName.endsWith('.ass')) return 'ass';
  if (lowerName.endsWith('.ssa')) return 'ssa';
  if (lowerName.endsWith('.vtt')) return 'vtt';

  const trimmed = rawContent.trimStart();
  if (trimmed.startsWith('WEBVTT')) return 'vtt';
  if (/\[Script Info\]/i.test(trimmed) || /\[Events\]/i.test(trimmed)) {
    return /ScriptType:\s*v4\.00\+/i.test(trimmed) ? 'ass' : 'ssa';
  }
  return 'srt';
}

/**
 * Convierte marcas temporales SRT/VTT (HH:MM:SS,mmm o HH:MM:SS.mmm o MM:SS.mmm) a milisegundos.
 */
export function parseSrtVttTimeToMs(timeStr: string): number {
  const clean = timeStr.trim().replace(',', '.');
  const parts = clean.split(':');
  if (parts.length === 3) {
    const hours = parseInt(parts[0], 10) || 0;
    const minutes = parseInt(parts[1], 10) || 0;
    const secParts = parts[2].split('.');
    const seconds = parseInt(secParts[0], 10) || 0;
    const msStr = (secParts[1] || '0').padEnd(3, '0').slice(0, 3);
    const ms = parseInt(msStr, 10) || 0;
    return ((hours * 3600 + minutes * 60 + seconds) * 1000) + ms;
  }
  if (parts.length === 2) {
    const minutes = parseInt(parts[0], 10) || 0;
    const secParts = parts[1].split('.');
    const seconds = parseInt(secParts[0], 10) || 0;
    const msStr = (secParts[1] || '0').padEnd(3, '0').slice(0, 3);
    const ms = parseInt(msStr, 10) || 0;
    return ((minutes * 60 + seconds) * 1000) + ms;
  }
  return NaN;
}

/**
 * Convierte marcas temporales ASS/SSA (H:MM:SS.cc en centésimas de segundo) a milisegundos.
 */
export function parseAssTimeToMs(timeStr: string): number {
  const clean = timeStr.trim();
  const parts = clean.split(':');
  if (parts.length !== 3) return NaN;
  const hours = parseInt(parts[0], 10) || 0;
  const minutes = parseInt(parts[1], 10) || 0;
  const secParts = parts[2].split('.');
  const seconds = parseInt(secParts[0], 10) || 0;
  const centis = parseInt((secParts[1] || '0').padEnd(2, '0').slice(0, 2), 10) || 0;
  return ((hours * 3600 + minutes * 60 + seconds) * 1000) + (centis * 10);
}

/**
 * Limpia etiquetas ASS/SSA y HTML inseguro, preservando saltos de línea y alineación superior ({\an8}).
 */
function sanitizeAndFormatCueText(raw: string): {
  cleanText: string;
  alignment: 'bottom' | 'top';
} {
  const alignment: 'bottom' | 'top' = /\{\\an[789]\}/.test(raw) || /\{\\a[567]\}/.test(raw)
    ? 'top'
    : 'bottom';

  const cleanText = raw
    .replace(/\\N/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\h/g, ' ')
    .replace(/\{[^}]*\}/g, '') // Elimina etiquetas de override ASS/SSA como {\pos(...)}, {\c&H...&}
    .replace(/<\/?(?:b|i|u|font)[^>]*>/gi, '') // Limpia tags HTML de formato simple para render uniforme
    .replace(/<[^>]+>/g, '') // Prevención estricta contra XSS en subtítulos externos
    .trim();

  return { cleanText, alignment };
}

/**
 * Parsea y valida cualquier archivo SRT, VTT, ASS o SSA y ejecuta la Sincronización Automática Inicial.
 */
export function parseAndValidateSubtitles(
  rawContent: string,
  filename = '',
  audioFirstSpeechMs?: number
): SubtitleParseResult {
  const normalized = rawContent.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const format = detectSubtitleFormat(normalized, filename);
  const warnings: string[] = [];
  const cues: SubtitleCue[] = [];

  if (format === 'ass' || format === 'ssa') {
    const lines = normalized.split('\n');
    let inEvents = false;
    let formatColumns: string[] = [
      'layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'
    ];

    for (const line of lines) {
      const trimmed = line.trim();
      if (/^\[Events\]/i.test(trimmed)) {
        inEvents = true;
        continue;
      }
      if (inEvents && /^\[.*\]$/.test(trimmed)) {
        inEvents = false;
        continue;
      }
      if (!inEvents) continue;

      if (/^Format:/i.test(trimmed)) {
        formatColumns = trimmed
          .replace(/^Format:\s*/i, '')
          .split(',')
          .map((c) => c.trim().toLowerCase());
      } else if (/^Dialogue:/i.test(trimmed)) {
        const payload = trimmed.replace(/^Dialogue:\s*/i, '');
        const parts: string[] = [];
        let current = '';
        let commaCount = 0;
        const maxSplits = formatColumns.length - 1;

        for (let i = 0; i < payload.length; i++) {
          if (payload[i] === ',' && commaCount < maxSplits) {
            parts.push(current);
            current = '';
            commaCount++;
          } else {
            current += payload[i];
          }
        }
        parts.push(current);

        const startIdx = formatColumns.indexOf('start');
        const endIdx = formatColumns.indexOf('end');
        const textIdx = formatColumns.indexOf('text');

        if (startIdx >= 0 && endIdx >= 0 && textIdx >= 0 && parts.length > textIdx) {
          const startMs = parseAssTimeToMs(parts[startIdx]);
          const endMs = parseAssTimeToMs(parts[endIdx]);
          const rawText = parts[textIdx];
          const { cleanText, alignment } = sanitizeAndFormatCueText(rawText);

          if (!isNaN(startMs) && !isNaN(endMs) && endMs > startMs && cleanText.length > 0) {
            cues.push({
              index: cues.length + 1,
              startMs,
              endMs,
              text: cleanText,
              rawText,
              alignment
            });
          }
        }
      }
    }
  } else {
    // Parser unificado SRT y WebVTT
    const blocks = normalized
      .replace(/^WEBVTT[^\n]*\n+/i, '')
      .split(/\n{2,}/);

    for (const block of blocks) {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
      if (lines.length === 0) continue;

      // Buscar la línea con "-->"
      const arrowLineIdx = lines.findIndex((l) => l.includes('-->'));
      if (arrowLineIdx === -1) continue;

      const timeLine = lines[arrowLineIdx];
      const [startRaw, endWithSettings] = timeLine.split('-->');
      if (!startRaw || !endWithSettings) continue;

      const endRaw = endWithSettings.trim().split(/\s+/)[0];
      const startMs = parseSrtVttTimeToMs(startRaw);
      const endMs = parseSrtVttTimeToMs(endRaw);

      if (isNaN(startMs) || isNaN(endMs) || endMs <= startMs) {
        warnings.push(`Marca temporal inválida omitida: ${timeLine}`);
        continue;
      }

      const rawText = lines.slice(arrowLineIdx + 1).join('\n');
      const { cleanText, alignment } = sanitizeAndFormatCueText(rawText);
      if (!cleanText) continue;

      cues.push({
        index: cues.length + 1,
        startMs,
        endMs,
        text: cleanText,
        rawText,
        alignment
      });
    }
  }

  // Ordenar por marca de inicio
  cues.sort((a, b) => a.startMs - b.startMs);

  // Sincronización automática inicial:
  // 1. Filtrar anuncios parásitos en t=0 (créditos de descarga web) para hallar el primer diálogo real
  const nonBannerCues = cues.filter(
    (c) =>
      !(
        c.startMs < 1500 &&
        /subdivx|opensubtitles|argenteam|subtitulos|traducido\s*por|www\.|http/i.test(c.text)
      )
  );

  const firstRealCue = nonBannerCues[0] || cues[0];
  const firstDialogueMs = firstRealCue ? firstRealCue.startMs : 0;
  const lastDialogueMs = cues.length > 0 ? cues[cues.length - 1].endMs : 0;

  // 2. Si disponemos de marca de inicio de voz del audio (ej. proporcionada por FFprobe/Agente Local),
  // calculamos una aproximación inicial conservadora si la diferencia es menor a 8 segundos.
  let autoSyncSuggestedOffsetMs = 0;
  if (typeof audioFirstSpeechMs === 'number' && firstRealCue) {
    const delta = audioFirstSpeechMs - firstRealCue.startMs;
    if (Math.abs(delta) <= 8000) {
      autoSyncSuggestedOffsetMs = Math.round(delta / 50) * 50;
    }
  }

  return {
    format,
    cues,
    isValid: cues.length > 0,
    warnings,
    autoSyncSuggestedOffsetMs,
    firstDialogueMs,
    lastDialogueMs
  };
}

/**
 * Ecuación de Sincronización Manual y Progresiva:
 * Calcula el tiempo efectivo de aparición/desaparición de una marca de subtítulo.
 *
 *   t_efectivo(t) = t_ref + (t - t_ref) * S + initialOffsetMs
 */
export function computeSyncedTimestampMs(
  originalCueMs: number,
  params: SubtitleSyncParams = DEFAULT_SYNC_PARAMS
): number {
  const { initialOffsetMs = 0, driftScaleFactor = 1.0, referencePointMs = 0 } = params;
  const scaled = referencePointMs + (originalCueMs - referencePointMs) * driftScaleFactor + initialOffsetMs;
  return Math.max(0, Math.round(scaled));
}

/**
 * Devuelve las líneas de subtítulos activas para el instante actual del vídeo (en milisegundos),
 * aplicando en tiempo real la sincronización manual y la corrección progresiva.
 */
export function getActiveSubtitleCues(
  cues: SubtitleCue[],
  currentVideoTimeMs: number,
  params: SubtitleSyncParams = DEFAULT_SYNC_PARAMS
): SubtitleCue[] {
  if (!cues.length) return [];

  const active: SubtitleCue[] = [];
  for (let i = 0; i < cues.length; i++) {
    const cue = cues[i];
    const startEff = computeSyncedTimestampMs(cue.startMs, params);
    const endEff = computeSyncedTimestampMs(cue.endMs, params);

    if (currentVideoTimeMs >= startEff && currentVideoTimeMs <= endEff) {
      active.push(cue);
    }
  }
  return active;
}

/**
 * Calcula automáticamente los parámetros de Sincronización Progresiva a partir de 2 puntos de referencia
 * (ej. un diálogo al inicio de la película y otro diálogo más avanzado que se ha desfasado).
 */
export function calculateProgressiveSyncFromTwoPoints(
  pointA: { subtitleCueMs: number; actualVideoSpeechMs: number },
  pointB: { subtitleCueMs: number; actualVideoSpeechMs: number }
): SubtitleSyncParams {
  const deltaSub = pointB.subtitleCueMs - pointA.subtitleCueMs;
  const deltaVid = pointB.actualVideoSpeechMs - pointA.actualVideoSpeechMs;

  if (Math.abs(deltaSub) < 1000) {
    return {
      initialOffsetMs: Math.round(pointA.actualVideoSpeechMs - pointA.subtitleCueMs),
      driftScaleFactor: 1.0,
      referencePointMs: pointA.subtitleCueMs
    };
  }

  const driftScaleFactor = Number((deltaVid / deltaSub).toFixed(6));
  const initialOffsetMs = Math.round(pointA.actualVideoSpeechMs - pointA.subtitleCueMs);

  return {
    initialOffsetMs,
    driftScaleFactor,
    referencePointMs: pointA.subtitleCueMs
  };
}

