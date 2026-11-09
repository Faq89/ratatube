'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Hls from 'hls.js';
import {
  EnrichedStreamSource,
  FamilyProfile,
  LanguageFilterMode,
  StremioMetaItem,
  StremioSubtitleTrack,
  SubtitleVisualStyle,
  WatchProgressEntry,
  filterAndSortStreams
} from '@ratatube/shared';
import {
  SubtitleCue,
  SubtitleSyncParams,
  FPS_DRIFT_PRESETS,
  parseAndValidateSubtitles,
  getActiveSubtitleCues,
  calculateProgressiveSyncFromTwoPoints
} from '@ratatube/subtitle-engine';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Maximize2,
  Minimize2,
  Subtitles,
  Layers,
  Sliders,
  Download,
  CheckCircle2,
  AlertTriangle,
  SkipForward,
  Upload,
  Sparkles,
  X,
  Volume2,
  VolumeX,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

interface VideoPlayerModalProps {
  meta: StremioMetaItem;
  season?: number;
  episode?: number;
  initialPositionSeconds?: number;
  activeProfile: FamilyProfile;
  agentOnline: boolean;
  onClose: () => void;
  onSelectEpisode?: (season: number, episode: number) => void;
  onProgressSaved?: (entry?: WatchProgressEntry) => void;
  onSubtitleStyleChange?: (newStyle: SubtitleVisualStyle) => void;
  onTempDownloadStarted?: () => void;
}

export default function VideoPlayerModal({
  meta,
  season,
  episode,
  initialPositionSeconds = 0,
  activeProfile,
  agentOnline,
  onClose,
  onSelectEpisode,
  onProgressSaved,
  onSubtitleStyleChange,
  onTempDownloadStarted
}: VideoPlayerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const playerContainerRef = useRef<HTMLDivElement | null>(null);
  const topMenuHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastProgressSaveAtRef = useRef<number>(0);
  const hasEmbedTelemetryRef = useRef<boolean>(false);
  const lastCurrentTimeRef = useRef<number>(0);
  const durationRef = useRef<number>(0);
  const isGuestUser = Boolean(activeProfile.isGuest || activeProfile.id === 'guest-profile');

  // Streams y filtros de idioma
  const [allStreams, setAllStreams] = useState<EnrichedStreamSource[]>([]);
  const [loadingStreams, setLoadingStreams] = useState(true);
  const [langFilter, setLangFilter] = useState<LanguageFilterMode>(
    activeProfile.defaultLanguageFilter || 'all'
  );
  const [selectedStream, setSelectedStream] = useState<EnrichedStreamSource | null>(null);
  const [selectedAudioTrackId, setSelectedAudioTrackId] = useState<string>('default');

  // Estado del reproductor
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(
    initialPositionSeconds > 5 ? initialPositionSeconds : 0
  );
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [cinemaMode, setCinemaMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isTopHovered, setIsTopHovered] = useState(false);
  const [isTopMenuOpen, setIsTopMenuOpen] = useState(false);
  const [activeDrawer, setActiveDrawer] = useState<'none' | 'sources' | 'subtitles' | 'style'>('none');
  const [streamError, setStreamError] = useState<string | null>(null);

  // Descarga temporal en memoria del navegador
  const [tempDl, setTempDl] = useState<{
    sourceId: string;
    status: 'downloading' | 'ready' | 'error';
    loaded: number;
    total: number;
    error?: string;
  } | null>(null);
  const tempDlAbortRef = useRef<AbortController | null>(null);
  const tempBlobUrlRef = useRef<string | null>(null);

  // Subtítulos y motor de sincronización
  const [subtitleTracks, setSubtitleTracks] = useState<StremioSubtitleTrack[]>([]);
  const [selectedSubTrackId, setSelectedSubTrackId] = useState<string>('');
  const [parsedCues, setParsedCues] = useState<SubtitleCue[]>([]);
  const [subFormatInfo, setSubFormatInfo] = useState<{
    format: string;
    count: number;
    autoOffset: number;
  } | null>(null);
  const [activeCues, setActiveCues] = useState<SubtitleCue[]>([]);

  const [syncParams, setSyncParams] = useState<SubtitleSyncParams>({
    initialOffsetMs: 0,
    driftScaleFactor: 1.0,
    referencePointMs: 0
  });
  const [customOffsetInput, setCustomOffsetInput] = useState('0');
  const [syncSavedMsg, setSyncSavedMsg] = useState<string | null>(null);

  // Asistente de 2 puntos para sincronización progresiva
  const [pointA, setPointA] = useState<{ subtitleCueMs: number; actualVideoSpeechMs: number } | null>(
    null
  );

  // Estilo visual de subtítulos
  const [subStyle, setSubStyle] = useState<SubtitleVisualStyle>(activeProfile.subtitleStyle);

  // Episodios de serie para "Siguiente episodio automático"
  const currentEpisodeObj = meta.videos?.find(
    (v) => v.season === season && v.episode === episode
  );
  const nextEpisodeObj = meta.videos?.find(
    (v) =>
      (v.season === season && v.episode === (episode || 0) + 1) ||
      (v.season === (season || 0) + 1 && v.episode === 1)
  );

  // Selecciona automáticamente el mejor subtítulo según el orden de prioridad de idiomas del perfil
  const pickPreferredSubtitleTrack = (
    tracks: StremioSubtitleTrack[],
    priorityOrder: FamilyProfile['languagePriority'],
    savedSubId?: string
  ): string => {
    if (!tracks || tracks.length === 0) return '';
    if (savedSubId && savedSubId !== 'off' && tracks.some((t) => t.id === savedSubId)) {
      return savedSubId;
    }

    const isExternalTrack = (t: StremioSubtitleTrack) => !t.id.startsWith('ratatube-sub-');
    const isInternalMovie = meta.id.startsWith('ratatube-');
    const pool =
      !isInternalMovie && tracks.some(isExternalTrack)
        ? tracks.filter(isExternalTrack)
        : tracks;

    for (const bucket of priorityOrder) {
      if (bucket === 'es-419') {
        const match = pool.find(
          (t) => t.lang.toLowerCase() === 'es-419' || t.lang.toLowerCase() === 'spl'
        );
        if (match) return match.id;
      } else if (bucket === 'es-ES' || bucket === 'orig-sub-es') {
        const match = pool.find((t) =>
          ['es-es', 'spa', 'spn', 'es', 'es-419', 'spl'].includes(t.lang.toLowerCase())
        );
        if (match) return match.id;
      } else if (bucket === 'orig-other') {
        const match = pool.find((t) => ['en', 'eng', 'pt', 'pob', 'jpn'].includes(t.lang.toLowerCase()));
        if (match) return match.id;
      }
    }

    return pool[0]?.id || tracks[0].id;
  };

  // 1. Cargar fuentes (Streams) y Subtítulos desde los Addons de Stremio activos
  useEffect(() => {
    let cancelled = false;
    setLoadingStreams(true);
    setStreamError(null);

    const params = new URLSearchParams({
      id: meta.id,
      type: meta.type,
      profileId: activeProfile.id,
      langPriority: activeProfile.languagePriority.join(','),
      agentOnline: String(agentOnline)
    });
    if (season) params.set('season', String(season));
    if (episode) params.set('episode', String(episode));

    Promise.all([
      fetch(`/api/streams?${params.toString()}`).then((r) => r.json()),
      fetch(`/api/subtitles?${params.toString()}`).then((r) => r.json()),
      isGuestUser
        ? Promise.resolve(null)
        : fetch(`/api/progress?${params.toString()}&mediaId=${encodeURIComponent(meta.id)}`).then(
            (r) => r.json()
          )
    ])
      .then(([streamsRes, subsRes, progRes]) => {
        if (cancelled) return;
        const list: EnrichedStreamSource[] = streamsRes.streams || [];
        setAllStreams(list);

        // Seleccionar automáticamente la mejor fuente disponible según prioridad (Español Latino 1º)
        const firstAvailable = list.find(
          (s) => s.availability === 'available' && (s.streamUrl || s.embedUrl)
        );
        if (firstAvailable) {
          setSelectedStream(firstAvailable);
          if (firstAvailable.audioTracks?.[0]) {
            setSelectedAudioTrackId(firstAvailable.audioTracks[0].id);
          }
        }

        // Combinar subtítulos de OpenSubtitles v3 + subtítulos declarados en el stream activo
        const apiSubs: StremioSubtitleTrack[] = subsRes.subtitles || [];
        const embeddedSubs: StremioSubtitleTrack[] = (firstAvailable?.embeddedSubtitles || []).map(
          (es) => ({
            id: `stream-sub-${es.id}`,
            url: es.url,
            lang: es.lang,
            label: `🎬 ${es.label} (Incluido en fuente)`,
            format: es.url.endsWith('.vtt') ? 'vtt' : es.url.endsWith('.ass') ? 'ass' : 'srt',
            addonName: firstAvailable?.addonName || 'Stream'
          })
        );
        const mergedSubs = [...apiSubs];
        for (const emb of embeddedSubs) {
          if (!mergedSubs.some((m) => m.url === emb.url)) {
            mergedSubs.push(emb);
          }
        }

        setSubtitleTracks(mergedSubs);
        if (mergedSubs.length > 0) {
          const bestSubId = pickPreferredSubtitleTrack(
            mergedSubs,
            activeProfile.languagePriority,
            progRes?.lastStreamInfo?.subtitleId
          );
          setSelectedSubTrackId(bestSubId);
        }

        if (progRes?.syncPreset) {
          setSyncParams({
            initialOffsetMs: progRes.syncPreset.initialOffsetMs || 0,
            driftScaleFactor: progRes.syncPreset.driftScaleFactor || 1.0,
            referencePointMs: progRes.syncPreset.referencePointMs || 0
          });
          setCustomOffsetInput(String(progRes.syncPreset.initialOffsetMs || 0));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingStreams(false);
      });

    return () => {
      cancelled = true;
    };
  }, [meta.id, meta.type, season, episode, activeProfile.id, agentOnline]);

  // 2. Cargar y parsear el archivo de subtítulo seleccionado con @ratatube/subtitle-engine
  useEffect(() => {
    if (!selectedSubTrackId || selectedSubTrackId === 'off') {
      setParsedCues([]);
      setSubFormatInfo(null);
      return;
    }

    const track = subtitleTracks.find((t) => t.id === selectedSubTrackId);
    if (!track) return;

    let cancelled = false;
    fetch(`/api/subtitles/proxy?url=${encodeURIComponent(track.url)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.text();
      })
      .then((rawText) => {
        if (cancelled) return;
        const result = parseAndValidateSubtitles(rawText, track.url);
        if (result.cues.length === 0) {
          // Si una pista externa devuelve 0 líneas válidas, pasar automáticamente a la siguiente pista disponible
          const currentIndex = subtitleTracks.findIndex((t) => t.id === selectedSubTrackId);
          const nextTrack = subtitleTracks[currentIndex + 1];
          if (nextTrack) {
            setSelectedSubTrackId(nextTrack.id);
          }
          return;
        }
        setParsedCues(result.cues);
        setSubFormatInfo({
          format: result.format.toUpperCase(),
          count: result.cues.length,
          autoOffset: result.autoSyncSuggestedOffsetMs
        });
      })
      .catch(() => {
        if (cancelled) return;
        // Fallback automático a la siguiente pista si el servidor externo falla
        const currentIndex = subtitleTracks.findIndex((t) => t.id === selectedSubTrackId);
        const nextTrack = subtitleTracks[currentIndex + 1];
        if (nextTrack) {
          setSelectedSubTrackId(nextTrack.id);
        } else {
          setParsedCues([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSubTrackId, subtitleTracks]);

  // 3. Inicializar motor de vídeo (HTML5 nativo, HLS.js o reloj para Cloud Web Embed)
  useEffect(() => {
    setStreamError(null);
    hasEmbedTelemetryRef.current = false;

    if (!selectedStream) return;
    if (selectedStream.playbackMode === 'web-embed' || selectedStream.embedUrl) {
      setIsPlaying(false);
      const runtimeMinutes = parseInt(String(meta.runtime || ''), 10);
      setDuration(runtimeMinutes > 0 ? runtimeMinutes * 60 : 7200);
      if (initialPositionSeconds > 5 && currentTime === 0) {
        setCurrentTime(initialPositionSeconds);
      }
      return;
    }

    const video = videoRef.current;
    if (!video || !selectedStream.streamUrl) return;

    let hls: Hls | null = null;
    const url = selectedStream.streamUrl;

    if (url.includes('.m3u8') && Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        maxBufferLength: 60,
        backBufferLength: 60,
        maxMaxBufferLength: 120,
        lowLatencyMode: false
      });
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (initialPositionSeconds > 5) {
          video.currentTime = initialPositionSeconds;
        }
        video.play().catch(() => {});
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal) {
          setStreamError('La fuente HLS tuvo un fallo de red. Probando recuperación o cambia de proveedor.');
        }
      });
    } else {
      video.src = url;
      video.load();
      video.onloadedmetadata = () => {
        if (initialPositionSeconds > 5 && initialPositionSeconds < video.duration - 10) {
          video.currentTime = initialPositionSeconds;
        }
        video.play().catch(() => {});
      };
    }

    return () => {
      if (hls) {
        hls.destroy();
      }
    };
  }, [selectedStream?.id, selectedStream?.streamUrl, selectedStream?.playbackMode]);

  // 3b. Sincronización real bidireccional por postMessage (PLAYER_EVENT, MEDIA_DATA, PlayerJS) para Cloud Web Embed
  useEffect(() => {
    const isEmbed =
      selectedStream?.playbackMode === 'web-embed' || Boolean(selectedStream?.embedUrl);
    if (!isEmbed) return;

    const updateThrottledTime = (nextTime: number) => {
      if (Math.abs(nextTime - lastCurrentTimeRef.current) >= 0.25) {
        lastCurrentTimeRef.current = nextTime;
        setCurrentTime(nextTime);
      }
    };

    const updateThrottledDuration = (nextDur: number) => {
      if (nextDur > 0 && Math.abs(nextDur - durationRef.current) >= 1) {
        durationRef.current = nextDur;
        setDuration(nextDur);
      }
    };

    const markTelemetryReady = () => {
      if (!hasEmbedTelemetryRef.current) {
        hasEmbedTelemetryRef.current = true;
      }
    };

    const handleEmbedMessage = (event: MessageEvent) => {
      try {
        const raw = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (!raw || typeof raw !== 'object') return;

        // 1) Formato PLAYER_EVENT (VidFast HD, VidLink Pro, etc.)
        if (raw.type === 'PLAYER_EVENT' && raw.data && typeof raw.data === 'object') {
          const d = raw.data;
          markTelemetryReady();
          const ev = String(d.event || '').toLowerCase();

          if (typeof d.currentTime === 'number' && !isNaN(d.currentTime) && d.currentTime >= 0) {
            updateThrottledTime(d.currentTime);
            if (Math.floor(d.currentTime) % 45 === 0 && Math.floor(d.currentTime) > 0) {
              persistCurrentProgress(d.currentTime, d.duration || durationRef.current || 7200, false);
            }
          }
          if (typeof d.duration === 'number' && !isNaN(d.duration) && d.duration > 0) {
            updateThrottledDuration(d.duration);
          }
          if (typeof d.playing === 'boolean') {
            setIsPlaying((prev) => (prev === d.playing ? prev : d.playing));
          } else if (ev === 'play' || ev === 'timeupdate') {
            setIsPlaying((prev) => (prev ? prev : true));
          } else if (ev === 'pause' || ev === 'ended') {
            setIsPlaying((prev) => (prev ? false : prev));
          }
          return;
        }

        // 2) Formato MEDIA_DATA (progreso de reproducción emitido por servidores embed)
        if (raw.type === 'MEDIA_DATA' && raw.data && typeof raw.data === 'object') {
          const entries = Object.values(raw.data) as any[];
          for (const item of entries) {
            const watched = item?.progress?.watched;
            const dur = item?.progress?.duration;
            if (typeof watched === 'number' && watched >= 0) {
              markTelemetryReady();
              updateThrottledTime(watched);
            }
            if (typeof dur === 'number' && dur > 0) {
              updateThrottledDuration(dur);
            }
          }
          return;
        }

        // 3) Formato PlayerJS / JWPlayer / Video.js estándar
        const payload = raw.data || raw;
        const evtName = String(raw.event || raw.type || payload.event || '').toLowerCase();

        if (typeof payload.currentTime === 'number' && payload.currentTime >= 0) {
          markTelemetryReady();
          updateThrottledTime(payload.currentTime);
        } else if (typeof payload.time === 'number' && payload.time >= 0) {
          markTelemetryReady();
          updateThrottledTime(payload.time);
        }
        if (typeof payload.duration === 'number' && payload.duration > 0) {
          updateThrottledDuration(payload.duration);
        }
        if (evtName.includes('pause') || evtName.includes('ended')) {
          setIsPlaying((prev) => (prev ? false : prev));
        } else if (evtName.includes('play') || evtName.includes('timeupdate')) {
          setIsPlaying((prev) => (prev ? prev : true));
        }
      } catch {
        // Ignorar mensajes postMessage de terceros que no sean JSON de reproductor
      }
    };

    window.addEventListener('message', handleEmbedMessage);

    // Solicitar estado inicial al iframe SOLO si aún no está emitiendo telemetría continua
    // (evita interrumpir el hilo de vídeo del iframe cada segundo)
    const statusPoll = setInterval(() => {
      if (hasEmbedTelemetryRef.current) return;
      try {
        const win = iframeRef.current?.contentWindow;
        if (win) {
          win.postMessage({ command: 'getStatus' }, '*');
        }
      } catch {
        // Ignorar cross-origin
      }
    }, 2500);

    return () => {
      window.removeEventListener('message', handleEmbedMessage);
      clearInterval(statusPoll);
    };
  }, [selectedStream?.playbackMode, selectedStream?.embedUrl, selectedStream?.id]);

  // Reloj auxiliar SOLO para servidores embed antiguos que no emiten telemetría postMessage
  useEffect(() => {
    const isEmbed =
      selectedStream?.playbackMode === 'web-embed' || Boolean(selectedStream?.embedUrl);
    if (!isEmbed || !isPlaying || hasEmbedTelemetryRef.current) return;

    const timer = setInterval(() => {
      if (hasEmbedTelemetryRef.current) return;
      setCurrentTime((prev) => {
        const next = prev + 0.25 * playbackRate;
        lastCurrentTimeRef.current = next;
        return duration > 0 ? Math.min(duration, next) : next;
      });
    }, 250);

    return () => clearInterval(timer);
  }, [selectedStream?.playbackMode, selectedStream?.embedUrl, isPlaying, playbackRate, duration]);

  // 4. Evaluar subtítulos activos en tiempo real (solo actualiza el estado cuando cambia la línea activa, evitando re-renders innecesarios)
  useEffect(() => {
    const currentMs = Math.round(currentTime * 1000);
    const active = getActiveSubtitleCues(parsedCues, currentMs, syncParams);
    setActiveCues((prev) => {
      if (
        prev.length === active.length &&
        prev.every((cue, idx) => cue.index === active[idx]?.index)
      ) {
        return prev;
      }
      return active;
    });
  }, [currentTime, parsedCues, syncParams]);

  // 5. Guardar progreso automáticamente (solo si el usuario inició sesión, con throttle ligero para cuidar la BD)
  const persistCurrentProgress = async (pos: number, dur: number, force = false) => {
    if (isGuestUser) return;
    if (!dur || dur <= 0 || pos <= 2) return;
    const now = Date.now();
    if (!force && now - lastProgressSaveAtRef.current < 45_000) {
      return;
    }
    lastProgressSaveAtRef.current = now;

    const entry: WatchProgressEntry = {
      id: `wp-${activeProfile.id}-${meta.id}-${season || 0}-${episode || 0}`,
      profileId: activeProfile.id,
      mediaId: meta.id,
      mediaType: (meta.type as any) || 'movie',
      title: meta.name,
      poster: meta.poster,
      backdrop: meta.background,
      season,
      episode,
      episodeTitle: currentEpisodeObj?.name || currentEpisodeObj?.title,
      positionSeconds: Math.round(pos),
      durationSeconds: Math.round(dur),
      completed: dur > 0 && pos / dur >= 0.92,
      lastStreamInfo: {
        addonName: selectedStream?.addonName,
        streamUrl: selectedStream?.streamUrl,
        languageBucket: selectedStream?.languageBucket,
        subtitleId: selectedSubTrackId
      },
      updatedAt: new Date().toISOString()
    };

    onProgressSaved?.(entry);

    await fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    }).catch(() => {});
  };

  const adjustManualOffset = (deltaMs: number) => {
    setSyncParams((prev) => {
      const nextOffset = prev.initialOffsetMs + deltaMs;
      setCustomOffsetInput(String(nextOffset));
      return { ...prev, initialOffsetMs: nextOffset };
    });
  };

  const saveSyncPresetToCloud = async () => {
    if (isGuestUser) {
      setSyncSavedMsg('Sincronización aplicada (Inicia sesión para guardarla en tu cuenta)');
      setTimeout(() => setSyncSavedMsg(null), 3500);
      return;
    }
    await fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'save-subtitle-sync',
        profileId: activeProfile.id,
        mediaId: meta.id,
        season: season || 0,
        episode: episode || 0,
        subtitleId: selectedSubTrackId || 'default',
        ...syncParams
      })
    });
    setSyncSavedMsg('Sincronización guardada en tu cuenta');
    setTimeout(() => setSyncSavedMsg(null), 3000);
  };

  const handleLocalSubUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const content = String(reader.result || '');
      const result = parseAndValidateSubtitles(content, file.name);
      const customId = `local-file-${Date.now()}`;
      setSubtitleTracks((prev) => [
        {
          id: customId,
          url: `local://${file.name}`,
          lang: 'es-419',
          label: `📂 Archivo Local: ${file.name} (${result.format.toUpperCase()})`,
          format: result.format,
          addonName: 'Archivo Local'
        },
        ...prev
      ]);
      setSelectedSubTrackId(customId);
      setParsedCues(result.cues);
      setSubFormatInfo({
        format: result.format.toUpperCase(),
        count: result.cues.length,
        autoOffset: result.autoSyncSuggestedOffsetMs
      });
    };
    reader.readAsText(file);
  };

  // Descarga Temporal 100% en el navegador (memoria volátil, cero archivos en disco):
  // descarga por bloques vía /api/media-proxy, muestra progreso y al terminar reproduce desde un blob: URL
  const triggerTemporaryDownload = async (source: EnrichedStreamSource) => {
    if (!source.streamUrl || tempDl?.status === 'downloading') return;
    if (source.streamUrl.startsWith('blob:')) return;

    const controller = new AbortController();
    tempDlAbortRef.current?.abort();
    tempDlAbortRef.current = controller;
    setTempDl({ sourceId: source.id, status: 'downloading', loaded: 0, total: 0 });

    // Mientras descarga, reproducir la misma fuente en streaming directo para no esperar
    if (selectedStream?.id !== source.id) {
      setSelectedStream(source);
    }

    const CHUNK = 8 * 1024 * 1024;
    const MAX_TOTAL = 2 * 1024 * 1024 * 1024; // 2 GB de tope en memoria
    const parts: Uint8Array[] = [];
    let loaded = 0;
    let total = 0;
    let contentType = 'video/mp4';

    try {
      while (true) {
        const end = loaded + CHUNK - 1;
        const res = await fetch(
          `/api/media-proxy?url=${encodeURIComponent(source.streamUrl)}`,
          { headers: { Range: `bytes=${loaded}-${end}` }, signal: controller.signal }
        );
        if (res.status === 416) break;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        contentType = res.headers.get('content-type') || contentType;
        const cr = res.headers.get('content-range');
        if (cr && !total) {
          const m = cr.match(/\/(\d+)$/);
          if (m) total = Number(m[1]);
        }
        if (total > MAX_TOTAL) {
          throw new Error('El archivo supera 2 GB; usa la reproducción directa.');
        }

        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.byteLength === 0) break;
        parts.push(buf);
        loaded += buf.byteLength;
        setTempDl({ sourceId: source.id, status: 'downloading', loaded, total });

        // Servidor sin soporte de Range (200 con archivo completo) o fin del archivo
        if (res.status === 200 || (total > 0 && loaded >= total)) break;
      }

      const blob = new Blob(parts as BlobPart[], { type: contentType });
      if (tempBlobUrlRef.current) URL.revokeObjectURL(tempBlobUrlRef.current);
      const blobUrl = URL.createObjectURL(blob);
      tempBlobUrlRef.current = blobUrl;
      setTempDl({ sourceId: source.id, status: 'ready', loaded, total: total || loaded });

      // Cambiar a la copia temporal en memoria continuando desde el segundo actual
      const resumeAt = videoRef.current?.currentTime || currentTime;
      const tempStream: EnrichedStreamSource = {
        ...source,
        id: `temp-blob-${source.id}`,
        providerName: `📥 Temporal (memoria) — ${source.providerName}`,
        streamUrl: blobUrl,
        embedUrl: undefined,
        sourceType: 'http',
        playbackMode: 'direct-stream',
        availability: 'available'
      };
      setSelectedStream(tempStream);
      setTimeout(() => {
        if (videoRef.current && resumeAt > 1) {
          const v = videoRef.current;
          const seekWhenReady = () => {
            v.currentTime = resumeAt;
            v.removeEventListener('loadedmetadata', seekWhenReady);
          };
          if (v.readyState >= 1) seekWhenReady();
          else v.addEventListener('loadedmetadata', seekWhenReady);
        }
      }, 50);
      onTempDownloadStarted?.();
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setTempDl(null);
        return;
      }
      setTempDl({
        sourceId: source.id,
        status: 'error',
        loaded,
        total,
        error: err?.message || 'No se pudo descargar temporalmente esta fuente.'
      });
    }
  };

  // Liberar memoria de la descarga temporal al cerrar el reproductor
  useEffect(() => {
    return () => {
      tempDlAbortRef.current?.abort();
      if (tempBlobUrlRef.current) URL.revokeObjectURL(tempBlobUrlRef.current);
    };
  }, []);

  const visibleStreams = useMemo(
    () =>
      filterAndSortStreams(allStreams, langFilter, activeProfile.languagePriority),
    [allStreams, langFilter, activeProfile.languagePriority]
  );

  const availableTopServers = useMemo(
    () => allStreams.filter((s) => s.availability === 'available').slice(0, 6),
    [allStreams]
  );

  const formatTime = (sec: number) => {
    if (!sec || isNaN(sec)) return '00:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const isEmbedMode =
    selectedStream?.playbackMode === 'web-embed' || Boolean(selectedStream?.embedUrl);
  const activeSubTrack = subtitleTracks.find((t) => t.id === selectedSubTrackId);

  // Detectar modo pantalla completa
  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Tiempo efectivo actual de la barra de subtítulos en segundos
  const effectiveSubTimeSec = Math.max(
    0,
    Math.min(
      duration || 7200,
      currentTime + syncParams.initialOffsetMs / 1000
    )
  );

  // Índice de la frase de diálogo actual o inmediatamente siguiente
  const roundedMovieSec = Math.floor(currentTime);
  const currentOrNextCueIndex = useMemo(
    () =>
      parsedCues.findIndex(
        (c) => c.endMs + syncParams.initialOffsetMs >= roundedMovieSec * 1000
      ),
    [parsedCues, syncParams.initialOffsetMs, roundedMovieSec]
  );

  const jumpToDialogueCue = (cueIndex: number) => {
    if (cueIndex < 0 || cueIndex >= parsedCues.length) return;
    const targetCue = parsedCues[cueIndex];
    // Sincronizar el subtítulo para que esta frase coincida exactamente con el segundo actual
    const newOffsetMs = Math.round(currentTime * 1000) - targetCue.startMs;
    setSyncParams((prev) => ({ ...prev, initialOffsetMs: newOffsetMs }));
    setCustomOffsetInput(String(newOffsetMs));
  };

  const resolvedEmbedSrc = selectedStream?.embedUrl || selectedStream?.streamUrl || '';

  const handleTopMouseEnter = () => {
    if (topMenuHideTimerRef.current) clearTimeout(topMenuHideTimerRef.current);
    setIsTopHovered(true);
  };

  const handleTopMouseLeave = () => {
    if (!isTopMenuOpen) {
      setIsTopHovered(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      {/* Barra superior del reproductor */}
      <div className="flex items-center justify-between border-b border-white/10 bg-[#0b0e17] px-6 py-3">
        <div className="flex items-center gap-4">
          <button
            onClick={() => {
              persistCurrentProgress(currentTime, duration, true);
              onClose();
            }}
            className="flex items-center gap-2 rounded-lg bg-white/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-white/20"
          >
            <X className="h-4 w-4" /> Volver al catálogo
          </button>
          <div>
            <h2 className="text-base font-bold text-white">
              {meta.name}
              {season && episode ? (
                <span className="ml-2 rounded bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-300">
                  T{season}:E{episode}{' '}
                  {currentEpisodeObj?.name || currentEpisodeObj?.title
                    ? `— ${currentEpisodeObj.name || currentEpisodeObj.title}`
                    : ''}
                </span>
              ) : null}
            </h2>
            <p className="text-xs text-gray-400">
              Proveedor activo:{' '}
              <span className="font-medium text-emerald-400">
                {selectedStream?.providerName || 'Cargando...'}
              </span>{' '}
              • Audio:{' '}
              <span className="text-emerald-400">
                {selectedStream?.declaredAudioLabel || 'Verificando'}
              </span>{' '}
              • Calidad:{' '}
              <span className="text-sky-400">
                {selectedStream?.declaredResolution || 'Auto'}
              </span>{' '}
              • Subtítulos:{' '}
              <span className="font-medium text-emerald-300">
                {selectedSubTrackId === 'off'
                  ? 'Desactivados'
                  : activeSubTrack
                  ? `${activeSubTrack.label}${
                      subFormatInfo ? ` (${subFormatInfo.count} líneas)` : ''
                    }`
                  : 'Cargando pista preferida...'}
              </span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() =>
              setActiveDrawer(activeDrawer === 'sources' ? 'none' : 'sources')
            }
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
              activeDrawer === 'sources'
                ? 'bg-emerald-500 text-black'
                : 'bg-white/10 text-gray-200 hover:bg-white/20'
            }`}
          >
            <Layers className="h-4 w-4" />
            Fuentes e Idiomas ({visibleStreams.length})
          </button>

          <button
            onClick={() =>
              setActiveDrawer(activeDrawer === 'subtitles' ? 'none' : 'subtitles')
            }
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
              activeDrawer === 'subtitles'
                ? 'bg-emerald-500 text-black'
                : 'bg-white/10 text-gray-200 hover:bg-white/20'
            }`}
          >
            <Subtitles className="h-4 w-4" />
            Sincronizar Subtítulos (
            {syncParams.initialOffsetMs >= 0
              ? `+${syncParams.initialOffsetMs}ms`
              : `${syncParams.initialOffsetMs}ms`}
            )
          </button>

          <button
            onClick={() =>
              setActiveDrawer(activeDrawer === 'style' ? 'none' : 'style')
            }
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
              activeDrawer === 'style'
                ? 'bg-emerald-500 text-black'
                : 'bg-white/10 text-gray-200 hover:bg-white/20'
            }`}
          >
            <Sliders className="h-4 w-4" />
            Estilo Visual Subtítulos
          </button>

          <button
            onClick={() => setCinemaMode(!cinemaMode)}
            className="rounded-lg bg-white/10 px-3 py-2 text-xs text-gray-300 hover:bg-white/20"
            title="Alternar Modo Cine"
          >
            {cinemaMode ? 'Salir Modo Cine' : 'Modo Cine'}
          </button>
        </div>
      </div>

      {/* Área central: Reproductor de Vídeo + Barras Auto-Ocultables + Panel Lateral */}
      <div className="relative flex flex-1 overflow-hidden">
        <div
          ref={playerContainerRef}
          className={`relative flex flex-1 flex-col items-center justify-center bg-black ${
            cinemaMode || isFullscreen ? 'p-0' : 'p-3'
          }`}
        >
          {/* Zona sensora superior para revelar el botón central al acercar el mouse arriba */}
          <div
            onMouseEnter={handleTopMouseEnter}
            onMouseMove={handleTopMouseEnter}
            onMouseLeave={handleTopMouseLeave}
            className="absolute inset-x-0 top-0 z-30 h-10"
          />

          {/* Botón central discreto que aparece al acercar el mouse a la parte superior */}
          {isTopHovered && !isTopMenuOpen && (
            <div
              onMouseEnter={handleTopMouseEnter}
              className="absolute top-2.5 left-1/2 -translate-x-1/2 z-40 transition-all duration-200"
            >
              <button
                onClick={() => setIsTopMenuOpen(true)}
                onMouseEnter={() => setIsTopMenuOpen(true)}
                className="flex items-center gap-1.5 rounded-full border border-emerald-500/50 bg-[#0c101b]/95 px-4 py-1.5 text-xs font-bold text-emerald-300 shadow-2xl backdrop-blur-md hover:bg-emerald-500 hover:text-black transition-all"
                title="Abrir controles de servidores y subtítulos"
              >
                <span>⚡ Servidores & Subtítulos</span>
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Menú Superior Completo Desplegable: Fila 1 Servidores Rápidos + Fila 2 Subtítulos y Controles */}
          {isTopMenuOpen && (
            <div
              onMouseEnter={() => {
                if (topMenuHideTimerRef.current) clearTimeout(topMenuHideTimerRef.current);
              }}
              onMouseLeave={() => {
                if (topMenuHideTimerRef.current) clearTimeout(topMenuHideTimerRef.current);
                topMenuHideTimerRef.current = setTimeout(() => {
                  setIsTopMenuOpen(false);
                  setIsTopHovered(false);
                }, 800);
              }}
              className="absolute inset-x-3 top-2.5 z-40 flex flex-col gap-2 rounded-2xl border border-white/15 bg-[#0c101b]/95 p-3 shadow-2xl backdrop-blur-md transition-all duration-200"
            >
              {/* FILA 1: SERVIDORES RÁPIDOS */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-xs font-bold text-emerald-400">
                    ⚡ Servidores rápidos:
                  </span>
                  {availableTopServers.map((srv, idx) => {
                    const isSelected = selectedStream?.id === srv.id;
                    return (
                      <button
                        key={srv.id}
                        onClick={() => setSelectedStream(srv)}
                        className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                          isSelected
                            ? 'bg-emerald-500 text-black shadow'
                            : 'bg-white/10 text-gray-200 hover:bg-white/20'
                        }`}
                      >
                        {idx + 1}. {srv.providerName.replace(/Ratatube Cloud Web #\d+\s*\((.*?)\)/, '$1')}
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setActiveDrawer('sources')}
                    className="rounded-lg bg-white/10 px-2.5 py-1 text-xs font-medium text-gray-300 hover:bg-white/20"
                  >
                    Ver todas las fuentes ({allStreams.length})
                  </button>
                  <button
                    onClick={() => {
                      setIsTopMenuOpen(false);
                      setIsTopHovered(false);
                    }}
                    className="flex items-center gap-1 rounded-lg bg-white/10 px-2 py-1 text-xs text-gray-400 hover:bg-white/20 hover:text-white"
                    title="Ocultar menú"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                    <span>Ocultar</span>
                  </button>
                </div>
              </div>

              {/* FILA 2: BARRA DE TIEMPO DE SUBTÍTULOS Y CONTROLES (EN PARALELO ARRIBA) */}
              {selectedSubTrackId !== 'off' && (
                <div className="flex items-center gap-3 pt-0.5">
                  <span className="w-24 shrink-0 text-[11px] font-bold uppercase tracking-wider text-emerald-400">
                    💬 Subtítulo
                  </span>
                  <span className="w-12 text-xs font-mono text-emerald-300">
                    {formatTime(effectiveSubTimeSec)}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={duration || 5400}
                    value={effectiveSubTimeSec}
                    onChange={(e) => {
                      const newSubSec = Number(e.target.value);
                      const newOffsetMs = Math.round((newSubSec - currentTime) * 1000);
                      setSyncParams((prev) => ({
                        ...prev,
                        initialOffsetMs: newOffsetMs
                      }));
                      setCustomOffsetInput(String(newOffsetMs));
                    }}
                    className="h-1.5 flex-1 cursor-pointer accent-emerald-500"
                    title="Arrastra para adelantar o retrasar los subtítulos"
                  />
                  <button
                    onClick={() => {
                      setSyncParams((prev) => ({ ...prev, initialOffsetMs: 0 }));
                      setCustomOffsetInput('0');
                    }}
                    className="w-14 text-right font-mono text-[11px] text-emerald-400 hover:underline"
                    title="Clic para reiniciar offset a 0ms"
                  >
                    {syncParams.initialOffsetMs >= 0
                      ? `+${(syncParams.initialOffsetMs / 1000).toFixed(1)}s`
                      : `${(syncParams.initialOffsetMs / 1000).toFixed(1)}s`}
                  </button>
                </div>
              )}

              {/* FILA 3: SELECTOR DE PISTAS, FRASES DE DIÁLOGO Y BOTONES DE AJUSTE */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    value={selectedSubTrackId}
                    onChange={(e) => setSelectedSubTrackId(e.target.value)}
                    className="max-w-[220px] truncate rounded-lg border border-emerald-500/40 bg-[#171c2b] px-2 py-1 text-xs font-medium text-emerald-300"
                  >
                    <option value="off">🚫 Subtítulos: Desactivados</option>
                    {subtitleTracks.map((t) => (
                      <option key={t.id} value={t.id}>
                        💬 CC: {t.label}
                      </option>
                    ))}
                  </select>

                  {selectedSubTrackId !== 'off' && parsedCues.length > 0 && (
                    <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/40 px-1.5 py-0.5 text-xs">
                      <button
                        onClick={() =>
                          jumpToDialogueCue(
                            Math.max(0, (currentOrNextCueIndex >= 0 ? currentOrNextCueIndex : 0) - 1)
                          )
                        }
                        className="rounded bg-white/10 px-1.5 py-0.5 font-semibold text-gray-200 hover:bg-emerald-500 hover:text-black"
                        title="Frase anterior"
                      >
                        ⏮
                      </button>

                      <select
                        value={currentOrNextCueIndex >= 0 ? currentOrNextCueIndex : 0}
                        onChange={(e) => jumpToDialogueCue(Number(e.target.value))}
                        className="max-w-[210px] truncate rounded border border-white/10 bg-[#171c2b] px-1.5 py-0.5 text-xs text-gray-200"
                        title="Elige la frase que se escucha para sincronizar el subtítulo al segundo actual"
                      >
                        {parsedCues.slice(0, 400).map((cue, idx) => (
                          <option key={cue.index} value={idx}>
                            [{formatTime(cue.startMs / 1000)}] {cue.text.replace(/\n/g, ' ').slice(0, 42)}
                          </option>
                        ))}
                      </select>

                      <button
                        onClick={() =>
                          jumpToDialogueCue(
                            Math.min(
                              parsedCues.length - 1,
                              (currentOrNextCueIndex >= 0 ? currentOrNextCueIndex : 0) + 1
                            )
                          )
                        }
                        className="rounded bg-white/10 px-1.5 py-0.5 font-semibold text-gray-200 hover:bg-emerald-500 hover:text-black"
                        title="Siguiente frase"
                      >
                        ⏭
                      </button>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-black/50 px-2 py-0.5 text-xs">
                    <span className="text-gray-400">Sync:</span>
                    <button
                      onClick={() => adjustManualOffset(-250)}
                      className="rounded bg-white/10 px-1.5 py-0.5 hover:bg-emerald-500 hover:text-black"
                    >
                      -250ms
                    </button>
                    <button
                      onClick={() => adjustManualOffset(-100)}
                      className="rounded bg-white/10 px-1.5 py-0.5 hover:bg-emerald-500 hover:text-black"
                    >
                      -100ms
                    </button>
                    <span className="px-1 font-mono text-emerald-400">
                      {syncParams.initialOffsetMs}ms
                    </span>
                    <button
                      onClick={() => adjustManualOffset(100)}
                      className="rounded bg-white/10 px-1.5 py-0.5 hover:bg-emerald-500 hover:text-black"
                    >
                      +100ms
                    </button>
                    <button
                      onClick={() => adjustManualOffset(250)}
                      className="rounded bg-white/10 px-1.5 py-0.5 hover:bg-emerald-500 hover:text-black"
                    >
                      +250ms
                    </button>
                  </div>

                  {nextEpisodeObj && onSelectEpisode && (
                    <button
                      onClick={() =>
                        onSelectEpisode(nextEpisodeObj.season, nextEpisodeObj.episode)
                      }
                      className="flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-xs font-bold text-white hover:bg-emerald-500"
                    >
                      <SkipForward className="h-3.5 w-3.5" />
                      T{nextEpisodeObj.season}:E{nextEpisodeObj.episode}
                    </button>
                  )}

                  <button
                    onClick={() => {
                      if (!document.fullscreenElement) {
                        playerContainerRef.current?.requestFullscreen().catch(() => {});
                      } else {
                        document.exitFullscreen().catch(() => {});
                      }
                    }}
                    className="rounded-lg bg-white/10 p-1.5 text-gray-200 hover:bg-white/20"
                    title="Alternar Pantalla Completa"
                  >
                    {isFullscreen ? (
                      <Minimize2 className="h-4 w-4" />
                    ) : (
                      <Maximize2 className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Contenedor del Vídeo: 100% limpio en la parte inferior para usar controles nativos */}
          <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-xl bg-black">
            {isEmbedMode ? (
              <div className="relative h-full w-full overflow-hidden">
                <iframe
                  ref={iframeRef}
                  key={selectedStream?.id || 'embed'}
                  src={resolvedEmbedSrc}
                  title={meta.name}
                  className="w-full border-0"
                  style={{ height: '100%' }}
                  allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                  allowFullScreen
                  referrerPolicy="origin"
                />
              </div>
            ) : (
              <video
                ref={videoRef}
                controls
                className="max-h-full w-full object-contain"
                playsInline
                onPlay={() => setIsPlaying(true)}
                onPause={() => {
                  setIsPlaying(false);
                  persistCurrentProgress(currentTime, duration, true);
                }}
                onTimeUpdate={(e) => {
                  const t = e.currentTarget.currentTime;
                  if (Math.abs(t - lastCurrentTimeRef.current) >= 0.25) {
                    lastCurrentTimeRef.current = t;
                    setCurrentTime(t);
                  }
                  if (Math.floor(t) % 45 === 0 && Math.floor(t) > 0) {
                    persistCurrentProgress(t, e.currentTarget.duration || 0, false);
                  }
                }}
                onLoadedMetadata={(e) => {
                  const dur = e.currentTarget.duration || 0;
                  durationRef.current = dur;
                  setDuration(dur);
                }}
                onEnded={() => {
                  persistCurrentProgress(duration, duration, true);
                  if (nextEpisodeObj && onSelectEpisode) {
                    onSelectEpisode(nextEpisodeObj.season, nextEpisodeObj.episode);
                  }
                }}
                onError={() => {
                  const fallbackCloud = allStreams.find(
                    (s) =>
                      s.id !== selectedStream?.id &&
                      s.availability === 'available' &&
                      (s.playbackMode === 'web-embed' || s.sourceType === 'http')
                  );
                  if (selectedStream?.sourceType === 'torrent' && fallbackCloud) {
                    setSelectedStream(fallbackCloud);
                    return;
                  }
                  if (selectedStream?.sourceType === 'torrent') {
                    setStreamError(
                      'Esta fuente de Torrentio requiere el servicio P2P local (127.0.0.1:11470). Usa los Servidores Cloud Web HTTPS para reproducir directo en el navegador.'
                    );
                  } else {
                    setStreamError(
                      'No se pudo reproducir directamente esta fuente. Selecciona otro servidor en la barra superior o en el panel derecho.'
                    );
                  }
                }}
              />
            )}

            {/* OVERLAY PERSONALIZADO DE SUBTÍTULOS (Sin bloquear clics, posición cómoda sobre controles nativos) */}
            {activeCues.length > 0 && selectedSubTrackId !== 'off' && (
              <div
                className="pointer-events-none absolute inset-x-0 z-20 flex flex-col items-center px-8 text-center transition-all duration-200"
                style={{
                  bottom:
                    activeCues[0]?.alignment === 'top'
                      ? 'auto'
                      : `${Math.max(12, subStyle.verticalOffsetPct)}%`,
                  top: activeCues[0]?.alignment === 'top' ? '8%' : 'auto'
                }}
              >
                {activeCues.map((cue) => (
                  <div
                    key={cue.index}
                    className="mb-1.5 max-w-4xl whitespace-pre-line rounded-lg px-4 py-1.5 font-semibold leading-snug"
                    style={{
                      fontSize: `${subStyle.fontSize}px`,
                      fontFamily: subStyle.fontFamily,
                      color: subStyle.textColor,
                      backgroundColor: `${subStyle.backgroundColor}${Math.round(
                        subStyle.backgroundOpacity * 255
                      )
                        .toString(16)
                        .padStart(2, '0')}`,
                      WebkitTextStroke:
                        subStyle.outlineWidth > 0
                          ? `${subStyle.outlineWidth}px ${subStyle.outlineColor}`
                          : undefined,
                      textShadow: subStyle.shadow
                        ? '0 2px 6px rgba(0,0,0,0.95), 0 0 12px rgba(0,0,0,0.85)'
                        : undefined
                    }}
                  >
                    {cue.text}
                  </div>
                ))}
              </div>
            )}

            {/* Alerta de recuperación ante fallo de fuente */}
            {streamError && (
              <div className="absolute inset-x-8 top-14 z-30 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-emerald-500/40 bg-black/95 p-4 text-sm text-emerald-200 shadow-2xl">
                <div className="flex items-center gap-3">
                  <AlertTriangle className="h-5 w-5 shrink-0 text-emerald-400" />
                  <span>{streamError}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {allStreams.find((s) => s.playbackMode === 'web-embed') && (
                    <button
                      onClick={() => {
                        const cloud = allStreams.find((s) => s.playbackMode === 'web-embed');
                        if (cloud) setSelectedStream(cloud);
                      }}
                      className="rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-bold text-black hover:bg-emerald-400"
                    >
                      ⚡ Usar Servidor Cloud Web (Directo en Navegador)
                    </button>
                  )}
                  {selectedStream?.magnetUrl && (
                    <a
                      href={selectedStream.magnetUrl}
                      className="rounded-lg bg-purple-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-purple-500"
                    >
                      🧲 Abrir Magnet P2P
                    </a>
                  )}
                  <button
                    onClick={() => setActiveDrawer('sources')}
                    className="rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-bold text-black hover:bg-emerald-400"
                  >
                    Ver todos los proveedores ({allStreams.length})
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* PANEL LATERAL 1: FUENTES Y FILTROS DE IDIOMA (ESTILO STREMIO) */}
        {activeDrawer === 'sources' && (
          <div className="w-96 overflow-y-auto border-l border-white/10 bg-[#0d111a] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-400">
                Fuentes y Prioridad de Idioma
              </h3>
              <button
                onClick={() => setActiveDrawer('none')}
                className="text-xs text-gray-400 hover:text-white"
              >
                Cerrar
              </button>
            </div>

            {/* Filtros de idioma requeridos en Sección 7 */}
            <div className="mb-4 flex flex-wrap gap-1.5">
              {[
                { id: 'all', label: 'Todos los idiomas' },
                { id: 'es-419-only', label: '🇲🇽 Solo Español Latino' },
                { id: 'es-any', label: '🇲🇽/🇪🇸 Latino o Castellano' },
                { id: 'sub-es', label: 'Subtítulos en Español' },
                { id: 'original', label: 'Audio Original' }
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setLangFilter(f.id as LanguageFilterMode)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                    langFilter === f.id
                      ? 'bg-emerald-500 text-black font-bold'
                      : 'bg-white/10 text-gray-300 hover:bg-white/20'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {loadingStreams ? (
              <p className="text-xs text-gray-400">Consultando addons de Stremio activos...</p>
            ) : visibleStreams.length === 0 ? (
              <p className="rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-gray-400">
                No hay fuentes para el filtro seleccionado. Cambia a &ldquo;Todos los idiomas&rdquo;
                o instala más addons en la sección Fuentes y Addons.
              </p>
            ) : (
              <div className="space-y-3">
                {visibleStreams.map((stream) => {
                  const isSelected = selectedStream?.id === stream.id;
                  const isOfflineLocal = stream.availability === 'local-offline';
                  return (
                    <div
                      key={stream.id}
                      className={`rounded-xl border p-3.5 transition ${
                        isOfflineLocal
                          ? 'border-red-500/30 bg-red-950/20 opacity-60'
                          : isSelected
                          ? 'border-emerald-500 bg-emerald-500/10'
                          : 'border-white/10 bg-[#141926] hover:border-white/30'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-xs font-bold text-emerald-400">
                          {stream.providerName}
                        </span>
                        <span className="rounded bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-sky-300">
                          {stream.declaredResolution}
                        </span>
                      </div>

                      <p className="mt-1 text-xs text-gray-200">{stream.title}</p>

                      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                        <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-emerald-300">
                          🔊 {stream.declaredAudioLabel}
                        </span>
                        <span className="rounded bg-purple-500/20 px-2 py-0.5 text-purple-300">
                          ⚡ {stream.playbackMode}
                        </span>
                        <span
                          className={`rounded px-2 py-0.5 ${
                            isOfflineLocal
                              ? 'bg-red-500/20 text-red-300'
                              : 'bg-sky-500/20 text-sky-300'
                          }`}
                        >
                          {isOfflineLocal
                            ? '● Portátil desconectado (No disponible)'
                            : `● ${stream.connectionStatus}`}
                        </span>
                      </div>

                      <div className="mt-3 flex items-center gap-2">
                        <button
                          disabled={isOfflineLocal || (!stream.streamUrl && !stream.embedUrl)}
                          onClick={() => setSelectedStream(stream)}
                          className="flex-1 rounded-lg bg-emerald-500 py-1.5 text-xs font-bold text-black hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {isSelected ? 'Reproduciendo ahora' : 'Reproducir fuente'}
                        </button>
                        {stream.magnetUrl && (
                          <a
                            href={stream.magnetUrl}
                            className="flex items-center gap-1 rounded-lg bg-purple-500/20 px-2.5 py-1.5 text-xs font-semibold text-purple-300 hover:bg-purple-500/30"
                            title="Abrir enlace Magnet en Stremio Desktop o cliente P2P"
                          >
                            🧲 Magnet
                          </a>
                        )}
                        {stream.streamUrl &&
                          !isOfflineLocal &&
                          stream.sourceType !== 'torrent' &&
                          stream.playbackMode !== 'web-embed' &&
                          !stream.streamUrl.includes('127.0.0.1') &&
                          !stream.streamUrl.startsWith('blob:') && (
                            <button
                              onClick={() => triggerTemporaryDownload(stream)}
                              disabled={tempDl?.status === 'downloading'}
                              className="flex items-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs text-gray-200 hover:bg-white/20 disabled:opacity-60"
                              title="Descargar temporalmente en la memoria del navegador (se borra al cerrar) y reproducir sin cortes"
                            >
                              <Download className="h-3.5 w-3.5" />
                              {tempDl?.sourceId === stream.id && tempDl.status === 'downloading'
                                ? tempDl.total > 0
                                  ? `${Math.round((tempDl.loaded / tempDl.total) * 100)}%`
                                  : `${(tempDl.loaded / 1048576).toFixed(0)} MB`
                                : tempDl?.sourceId === stream.id && tempDl.status === 'ready'
                                ? 'Listo ✓'
                                : 'Temp'}
                            </button>
                          )}
                      </div>
                      {tempDl?.sourceId === stream.id && tempDl.status === 'downloading' && (
                        <div className="mt-2">
                          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                            <div
                              className="h-full bg-emerald-400 transition-all"
                              style={{
                                width: `${
                                  tempDl.total > 0
                                    ? Math.round((tempDl.loaded / tempDl.total) * 100)
                                    : 5
                                }%`
                              }}
                            />
                          </div>
                          <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
                            <span>
                              Descargando a memoria temporal: {(tempDl.loaded / 1048576).toFixed(1)} MB
                              {tempDl.total > 0 ? ` / ${(tempDl.total / 1048576).toFixed(1)} MB` : ''}
                            </span>
                            <button
                              onClick={() => tempDlAbortRef.current?.abort()}
                              className="text-rose-300 hover:underline"
                            >
                              Cancelar
                            </button>
                          </div>
                        </div>
                      )}
                      {tempDl?.sourceId === stream.id && tempDl.status === 'error' && (
                        <p className="mt-2 text-[11px] text-rose-300">⚠ {tempDl.error}</p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* PANEL LATERAL 2: SISTEMA AVANZADO DE SUBTÍTULOS (SECCIÓN 9) */}
        {activeDrawer === 'subtitles' && (
          <div className="w-[420px] overflow-y-auto border-l border-white/10 bg-[#0d111a] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-400">
                Sincronización Avanzada de Subtítulos
              </h3>
              <button
                onClick={() => setActiveDrawer('none')}
                className="text-xs text-gray-400 hover:text-white"
              >
                Cerrar
              </button>
            </div>

            {/* Selección de pista o carga de archivo externo SRT/VTT/ASS/SSA */}
            <div className="mb-4 rounded-xl border border-white/10 bg-[#141926] p-3.5">
              <label className="mb-1.5 block text-xs font-semibold text-gray-300">
                1. Pista de Subtítulos (Addons Stremio / OpenSubtitles / Local)
              </label>
              <select
                value={selectedSubTrackId}
                onChange={(e) => setSelectedSubTrackId(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-xs text-white"
              >
                <option value="off">🚫 Subtítulos desactivados</option>
                {subtitleTracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label} [{t.format.toUpperCase()}]
                  </option>
                ))}
              </select>

              <label className="mt-3 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-emerald-500/50 bg-emerald-500/10 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20">
                <Upload className="h-4 w-4" />
                Cargar archivo externo (.SRT, .VTT, .ASS, .SSA)
                <input
                  type="file"
                  accept=".srt,.vtt,.ass,.ssa"
                  onChange={handleLocalSubUpload}
                  className="hidden"
                />
              </label>

              {subFormatInfo && (
                <div className="mt-2.5 flex items-center justify-between rounded bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-300">
                  <span>
                    ✓ Formato {subFormatInfo.format} validado ({subFormatInfo.count} líneas)
                  </span>
                  <span>Sync inicial lista</span>
                </div>
              )}
            </div>

            {/* Sincronización Manual en Tiempo Real */}
            <div className="mb-4 rounded-xl border border-white/10 bg-[#141926] p-3.5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-200">
                  2. Sincronización Manual (Desfase Inicial Δt₀)
                </span>
                <span className="font-mono text-xs font-bold text-emerald-400">
                  {syncParams.initialOffsetMs} ms
                </span>
              </div>

              <div className="grid grid-cols-3 gap-1.5 text-xs">
                <button
                  onClick={() => adjustManualOffset(-500)}
                  className="rounded-lg bg-white/10 py-1.5 hover:bg-emerald-500 hover:text-black"
                >
                  -500 ms (Adelantar)
                </button>
                <button
                  onClick={() => adjustManualOffset(-250)}
                  className="rounded-lg bg-white/10 py-1.5 hover:bg-emerald-500 hover:text-black"
                >
                  -250 ms
                </button>
                <button
                  onClick={() => adjustManualOffset(-100)}
                  className="rounded-lg bg-white/10 py-1.5 hover:bg-emerald-500 hover:text-black"
                >
                  -100 ms
                </button>
                <button
                  onClick={() => adjustManualOffset(100)}
                  className="rounded-lg bg-white/10 py-1.5 hover:bg-emerald-500 hover:text-black"
                >
                  +100 ms
                </button>
                <button
                  onClick={() => adjustManualOffset(250)}
                  className="rounded-lg bg-white/10 py-1.5 hover:bg-emerald-500 hover:text-black"
                >
                  +250 ms
                </button>
                <button
                  onClick={() => adjustManualOffset(500)}
                  className="rounded-lg bg-white/10 py-1.5 hover:bg-emerald-500 hover:text-black"
                >
                  +500 ms (Retrasar)
                </button>
              </div>

              <div className="mt-2.5 flex items-center gap-2">
                <input
                  type="number"
                  value={customOffsetInput}
                  onChange={(e) => {
                    setCustomOffsetInput(e.target.value);
                    setSyncParams((prev) => ({
                      ...prev,
                      initialOffsetMs: Number(e.target.value) || 0
                    }));
                  }}
                  className="w-28 rounded-lg border border-white/10 bg-black px-2.5 py-1 text-xs text-white"
                  placeholder="Ej. -1200"
                />
                <span className="text-xs text-gray-400">ms personalizados</span>
                <button
                  onClick={() => {
                    setSyncParams({
                      initialOffsetMs: 0,
                      driftScaleFactor: 1.0,
                      referencePointMs: 0
                    });
                    setCustomOffsetInput('0');
                    setPointA(null);
                  }}
                  className="ml-auto rounded-lg bg-red-500/20 px-2.5 py-1 text-xs text-red-300 hover:bg-red-500/30"
                >
                  Restablecer
                </button>
              </div>
            </div>

            {/* Sincronización Progresiva (Corrección de Drift Temporal) */}
            <div className="mb-4 rounded-xl border border-white/10 bg-[#141926] p-3.5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-200">
                  3. Sincronización Progresiva (Escala Temporal)
                </span>
                <span className="font-mono text-xs font-bold text-sky-400">
                  {syncParams.driftScaleFactor.toFixed(5)}x
                </span>
              </div>
              <p className="mb-2.5 text-[11px] text-gray-400">
                Corrige subtítulos cuyo desfase aumenta con el paso de los minutos (ej. distinta
                velocidad de fotogramas 23.976 fps vs 25 fps).
              </p>

              <label className="mb-1 block text-[11px] text-gray-300">
                Presets de velocidad / Framerate:
              </label>
              <select
                value={syncParams.driftScaleFactor}
                onChange={(e) =>
                  setSyncParams((prev) => ({
                    ...prev,
                    driftScaleFactor: Number(e.target.value)
                  }))
                }
                className="mb-3 w-full rounded-lg border border-white/10 bg-black px-2.5 py-1.5 text-xs text-white"
              >
                {FPS_DRIFT_PRESETS.map((p) => (
                  <option key={p.label} value={p.scale}>
                    {p.label}
                  </option>
                ))}
              </select>

              <label className="mb-1 block text-[11px] text-gray-300">
                Ajuste fino de velocidad temporal ({syncParams.driftScaleFactor.toFixed(4)}x):
              </label>
              <input
                type="range"
                min={0.94}
                max={1.06}
                step={0.0005}
                value={syncParams.driftScaleFactor}
                onChange={(e) =>
                  setSyncParams((prev) => ({
                    ...prev,
                    driftScaleFactor: Number(e.target.value)
                  }))
                }
                className="w-full accent-sky-400"
              />

              <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-2.5 text-xs">
                <span className="text-gray-300">
                  Punto de referencia: {Math.round(syncParams.referencePointMs / 1000)}s
                </span>
                <button
                  onClick={() =>
                    setSyncParams((prev) => ({
                      ...prev,
                      referencePointMs: Math.round(currentTime * 1000)
                    }))
                  }
                  className="rounded bg-sky-500/20 px-2.5 py-1 text-[11px] font-semibold text-sky-300 hover:bg-sky-500/30"
                >
                  Anclar en segundo actual ({formatTime(currentTime)})
                </button>
              </div>

              {/* Calibración asistida de 2 puntos */}
              <div className="mt-3 rounded-lg bg-black/50 p-2.5 text-[11px]">
                <p className="mb-1.5 font-semibold text-gray-300">
                  Asistente automático de 2 puntos (Inicio y Final):
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const currentMs = Math.round(currentTime * 1000);
                      setPointA({
                        subtitleCueMs: currentMs - syncParams.initialOffsetMs,
                        actualVideoSpeechMs: currentMs
                      });
                    }}
                    className="flex-1 rounded bg-white/10 py-1 text-gray-200 hover:bg-white/20"
                  >
                    {pointA ? '✓ Punto A Anclado' : '1. Marcar Punto A'}
                  </button>
                  <button
                    disabled={!pointA}
                    onClick={() => {
                      if (!pointA) return;
                      const currentMs = Math.round(currentTime * 1000);
                      const calculated = calculateProgressiveSyncFromTwoPoints(pointA, {
                        subtitleCueMs: currentMs - syncParams.initialOffsetMs,
                        actualVideoSpeechMs: currentMs
                      });
                      setSyncParams(calculated);
                      setCustomOffsetInput(String(calculated.initialOffsetMs));
                    }}
                    className="flex-1 rounded bg-emerald-500/20 py-1 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40"
                  >
                    2. Marcar Punto B y Corregir
                  </button>
                </div>
              </div>
            </div>

            <button
              onClick={saveSyncPresetToCloud}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2.5 text-xs font-bold text-black hover:bg-emerald-400"
            >
              <Sparkles className="h-4 w-4" />
              Guardar sincronización para reutilizar
            </button>
            {syncSavedMsg && (
              <p className="mt-2 text-center text-xs text-emerald-400">{syncSavedMsg}</p>
            )}
          </div>
        )}

        {/* PANEL LATERAL 3: PERSONALIZACIÓN VISUAL DE SUBTÍTULOS */}
        {activeDrawer === 'style' && (
          <div className="w-96 overflow-y-auto border-l border-white/10 bg-[#0d111a] p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-400">
                Personalización Visual de Subtítulos
              </h3>
              <button
                onClick={() => setActiveDrawer('none')}
                className="text-xs text-gray-400 hover:text-white"
              >
                Cerrar
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <label className="mb-1 block text-gray-300">
                  Tamaño de letra ({subStyle.fontSize} px)
                </label>
                <input
                  type="range"
                  min={16}
                  max={48}
                  value={subStyle.fontSize}
                  onChange={(e) => {
                    const updated = { ...subStyle, fontSize: Number(e.target.value) };
                    setSubStyle(updated);
                    onSubtitleStyleChange?.(updated);
                  }}
                  className="w-full accent-emerald-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-gray-300">Fuente tipográfica</label>
                <select
                  value={subStyle.fontFamily}
                  onChange={(e) => {
                    const updated = { ...subStyle, fontFamily: e.target.value };
                    setSubStyle(updated);
                    onSubtitleStyleChange?.(updated);
                  }}
                  className="w-full rounded-lg border border-white/10 bg-black px-3 py-2 text-white"
                >
                  <option value="Inter, system-ui, sans-serif">Estándar Sans-Serif (Inter)</option>
                  <option value="'Arial Black', Impact, sans-serif">Cine Gruesa (Arial Black)</option>
                  <option value="Georgia, serif">Clásica Serif (Georgia)</option>
                  <option value="monospace">Monoespaciada (Consola)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-gray-300">Color de texto</label>
                  <div className="flex gap-1.5">
                    {['#FFFFFF', '#FFEE55', '#00FFFF', '#86EFAC'].map((color) => (
                      <button
                        key={color}
                        onClick={() => {
                          const updated = { ...subStyle, textColor: color };
                          setSubStyle(updated);
                          onSubtitleStyleChange?.(updated);
                        }}
                        className={`h-7 w-7 rounded-full border-2 ${
                          subStyle.textColor === color ? 'border-emerald-500' : 'border-white/20'
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-gray-300">Color de fondo</label>
                  <div className="flex gap-1.5">
                    {['#000000', '#111827', '#1e1b4b'].map((bg) => (
                      <button
                        key={bg}
                        onClick={() => {
                          const updated = { ...subStyle, backgroundColor: bg };
                          setSubStyle(updated);
                          onSubtitleStyleChange?.(updated);
                        }}
                        className={`h-7 w-7 rounded-full border-2 ${
                          subStyle.backgroundColor === bg ? 'border-emerald-500' : 'border-white/20'
                        }`}
                        style={{ backgroundColor: bg }}
                      />
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-gray-300">
                  Opacidad del fondo ({Math.round(subStyle.backgroundOpacity * 100)}%)
                </label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={subStyle.backgroundOpacity}
                  onChange={(e) => {
                    const updated = { ...subStyle, backgroundOpacity: Number(e.target.value) };
                    setSubStyle(updated);
                    onSubtitleStyleChange?.(updated);
                  }}
                  className="w-full accent-emerald-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-gray-300">
                  Posición vertical desde abajo ({subStyle.verticalOffsetPct}%)
                </label>
                <input
                  type="range"
                  min={2}
                  max={35}
                  value={subStyle.verticalOffsetPct}
                  onChange={(e) => {
                    const updated = { ...subStyle, verticalOffsetPct: Number(e.target.value) };
                    setSubStyle(updated);
                    onSubtitleStyleChange?.(updated);
                  }}
                  className="w-full accent-emerald-500"
                />
              </div>

              <div>
                <label className="mb-1 block text-gray-300">
                  Contorno (Borde): {subStyle.outlineWidth} px
                </label>
                <input
                  type="range"
                  min={0}
                  max={4}
                  step={1}
                  value={subStyle.outlineWidth}
                  onChange={(e) => {
                    const updated = { ...subStyle, outlineWidth: Number(e.target.value) };
                    setSubStyle(updated);
                    onSubtitleStyleChange?.(updated);
                  }}
                  className="w-full accent-emerald-500"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-gray-300">Sombra cinematográfica</span>
                <input
                  type="checkbox"
                  checked={subStyle.shadow}
                  onChange={(e) => {
                    const updated = { ...subStyle, shadow: e.target.checked };
                    setSubStyle(updated);
                    onSubtitleStyleChange?.(updated);
                  }}
                  className="h-4 w-4 accent-emerald-500"
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

