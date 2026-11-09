import { describe, it, expect } from 'vitest';
import {
  parseAndValidateSubtitles,
  computeSyncedTimestampMs,
  getActiveSubtitleCues,
  calculateProgressiveSyncFromTwoPoints
} from '../index';

describe('Motor Avanzado de Subtítulos (@ratatube/subtitle-engine)', () => {
  it('parsea correctamente subtítulos en formato SRT y calcula aproximación inicial', () => {
    const sampleSrt = `1
00:00:00,100 --> 00:00:01,000
Subtítulos descargados de opensubtitles.org

2
00:00:05,200 --> 00:00:08,500
¡Hola, bienvenidos a Ratatube en español latino!

3
00:00:10,000 --> 00:00:12,400
Segunda línea de diálogo.`;

    const parsed = parseAndValidateSubtitles(sampleSrt, 'test.srt', 5500);
    expect(parsed.isValid).toBe(true);
    expect(parsed.format).toBe('srt');
    expect(parsed.cues).toHaveLength(3);
    // Ignora el crédito en t=100ms y toma el primer diálogo real en 5200ms -> delta con 5500ms = +300ms
    expect(parsed.firstDialogueMs).toBe(5200);
    expect(parsed.autoSyncSuggestedOffsetMs).toBe(300);
  });

  it('parsea correctamente subtítulos ASS/SSA con etiquetas de posicionamiento {\\an8} y saltos \\N', () => {
    const sampleAss = `[Script Info]
Title: Ejemplo Anime ASS
ScriptType: v4.00+

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:02.50,0:00:05.00,Default,,0,0,0,,{\\an8}{\\i1}Nota superior\\NTraducido al español`;

    const parsed = parseAndValidateSubtitles(sampleAss, 'episode1.ass');
    expect(parsed.format).toBe('ass');
    expect(parsed.cues).toHaveLength(1);
    expect(parsed.cues[0].startMs).toBe(2500);
    expect(parsed.cues[0].endMs).toBe(5000);
    expect(parsed.cues[0].alignment).toBe('top');
    expect(parsed.cues[0].text).toBe('Nota superior\nTraducido al español');
  });

  it('aplica sincronización manual (+100ms, -250ms, +500ms) y sincronización progresiva (drift)', () => {
    const sampleVtt = `WEBVTT

00:01:00.000 --> 00:01:03.000
Diálogo en el minuto 1.

00:11:00.000 --> 00:11:03.000
Diálogo en el minuto 11.`;

    const { cues } = parseAndValidateSubtitles(sampleVtt, 'movie.vtt');

    // 1. Ajuste manual de +500ms (retrasa la aparición 500ms)
    const manualSync = { initialOffsetMs: 500, driftScaleFactor: 1.0, referencePointMs: 0 };
    expect(getActiveSubtitleCues(cues, 60200, manualSync)).toHaveLength(0);
    expect(getActiveSubtitleCues(cues, 60600, manualSync)).toHaveLength(1);

    // 2. Corrección progresiva de 2 puntos:
    // En el minuto 1 (60000ms) el subtítulo coincide con el audio en 60000ms.
    // En el minuto 11 (660000ms) el audio real ocurre 6 segundos después (666000ms).
    const progressiveParams = calculateProgressiveSyncFromTwoPoints(
      { subtitleCueMs: 60000, actualVideoSpeechMs: 60000 },
      { subtitleCueMs: 660000, actualVideoSpeechMs: 666000 }
    );

    expect(progressiveParams.driftScaleFactor).toBeCloseTo(1.01, 4);
    expect(computeSyncedTimestampMs(660000, progressiveParams)).toBe(666000);
    expect(getActiveSubtitleCues(cues, 666500, progressiveParams)).toHaveLength(1);
  });
});

