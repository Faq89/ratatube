export type LanguageBucket =
  | 'es-419'      // 1. Audio español latino
  | 'es-ES'       // 2. Audio español castellano
  | 'orig-sub-es' // 3. Audio original con subtítulos en español
  | 'orig-other'  // 4. Audio original con subtítulos en otros idiomas
  | 'es-neutral'  // Español declarado sin región específica
  | 'unknown';    // Idioma no declarado por el proveedor

export type LanguageFilterMode =
  | 'all'
  | 'es-419-only'
  | 'es-any'
  | 'sub-es'
  | 'original';

export type AgeRating = 'ALL' | 'G' | 'PG' | 'PG-13' | 'R';

export interface SubtitleVisualStyle {
  fontSize: number;          // px, ej. 18 - 44
  fontFamily: string;        // 'Inter, sans-serif' | 'Roboto Mono, monospace' | 'Georgia, serif' | 'Arial Black, sans-serif'
  textColor: string;         // Hex ej. '#FFFFFF' | '#FFFF00' | '#00FFFF'
  backgroundColor: string;   // Hex ej. '#000000'
  backgroundOpacity: number; // 0.0 a 1.0
  verticalOffsetPct: number; // % desde el borde inferior (2 a 35)
  outlineWidth: number;      // 0 a 4 px
  outlineColor: string;      // Hex ej. '#000000'
  shadow: boolean;
}

export interface UserPersonalInfo {
  firstName?: string;
  lastName?: string;
  phone?: string;
  country?: string;
  birthDate?: string;
}

export interface FamilyProfile {
  id: string;
  accountId: string;
  name: string;
  avatar: string;
  avatarColor: string;
  isAdmin: boolean;
  isKid: boolean;
  isGuest?: boolean;
  maxAgeRating: AgeRating;
  pinCode?: string | null;
  languagePriority: LanguageBucket[];
  defaultLanguageFilter: LanguageFilterMode;
  subtitleStyle: SubtitleVisualStyle;
  personalInfo?: UserPersonalInfo;
  createdAt: string;
}

export interface FamilyAccount {
  id: string;
  email: string;
  familyName: string;
  inviteCode: string;
  isGuest?: boolean;
  personalInfo?: UserPersonalInfo;
  createdAt: string;
}

export interface StremioCatalogDescriptor {
  type: string;
  id: string;
  name: string;
  extra?: Array<{
    name: string;
    isRequired?: boolean;
    options?: string[];
  }>;
}

export interface StremioManifest {
  id: string;
  version: string;
  name: string;
  description?: string;
  logo?: string;
  background?: string;
  types: string[];
  resources: Array<string | { name: string; types?: string[]; idPrefixes?: string[] }>;
  catalogs: StremioCatalogDescriptor[];
  idPrefixes?: string[];
  behaviorHints?: {
    adult?: boolean;
    p2p?: boolean;
    configurable?: boolean;
    configurationRequired?: boolean;
  };
}

export interface InstalledAddon {
  id: string;
  accountId: string;
  addonId: string;
  name: string;
  version: string;
  description: string;
  manifestUrl: string;
  logo?: string;
  types: string[];
  resources: string[];
  manifest: StremioManifest;
  isEnabled: boolean;
  isOfficial: boolean;
  healthStatus: 'healthy' | 'degraded' | 'offline';
  lastError?: string;
  lastCheckedAt: string;
}

export interface StremioEpisodeVideo {
  id: string;          // ej. "tt0903747:1:1"
  name?: string;
  title?: string;
  season: number;
  episode: number;
  released?: string;
  overview?: string;
  description?: string;
  thumbnail?: string;
}

export interface StremioMetaItem {
  id: string;          // ej. "tt1234567" o "kitsu:123"
  type: 'movie' | 'series' | 'anime' | 'documentary' | string;
  name: string;
  originalName?: string;
  poster?: string;
  background?: string;
  logo?: string;
  description?: string;
  releaseInfo?: string;
  year?: string | number;
  runtime?: string;
  imdbRating?: string;
  genres?: string[];
  cast?: string[];
  director?: string[];
  country?: string;
  language?: string;
  certification?: string;
  videos?: StremioEpisodeVideo[];
  trailers?: Array<{ source: string; type: string }>;
  availableLanguages?: string[];
  availableSubtitles?: string[];
}

export interface StremioRawStream {
  name?: string;
  title?: string;
  description?: string;
  url?: string;
  embedUrl?: string;
  infoHash?: string;
  fileIdx?: number;
  ytId?: string;
  externalUrl?: string;
  sources?: string[];
  subtitles?: Array<{
    id: string;
    url: string;
    lang: string;
    label?: string;
  }>;
  behaviorHints?: {
    notWebReady?: boolean;
    bingeGroup?: string;
    filename?: string;
    videoSize?: number;
    countryWhitelist?: string[];
  };
  // Campos enriquecidos opcionales de proveedores o agente local
  audioLanguage?: string;
  audioTracks?: Array<{ id: string; lang: string; label: string; codec?: string }>;
  resolution?: string;
  sourceType?: 'http' | 'hls' | 'dash' | 'web-embed' | 'local-agent' | 'torrent' | 'youtube' | 'external';
  isLocalAgent?: boolean;
  localAgentOnline?: boolean;
}

export interface EnrichedStreamSource {
  id: string;
  addonId: string;
  addonName: string;
  addonLogo?: string;
  providerName: string;
  title: string;
  streamUrl?: string;
  embedUrl?: string;
  magnetUrl?: string;
  infoHash?: string;
  fileIdx?: number;
  ytId?: string;
  externalUrl?: string;
  sourceType: 'http' | 'hls' | 'dash' | 'web-embed' | 'local-agent' | 'torrent' | 'youtube' | 'external';
  playbackMode: 'direct-stream' | 'adaptive-hls-dash' | 'web-embed' | 'local-remux' | 'torrent-temp-stream' | 'external';
  declaredResolution: string; // '4K (2160p)' | '1080p' | '720p' | '480p' | 'No declarada'
  languageBucket: LanguageBucket;
  declaredAudioLabel: string; // Ej. 'Español Latino (es-419)' o 'No especificado por el proveedor'
  declaredSubtitles: string[];
  audioTracks: Array<{ id: string; lang: string; label: string; codec?: string }>;
  embeddedSubtitles: Array<{ id: string; url: string; lang: string; label: string }>;
  availability: 'available' | 'local-offline' | 'requires-agent' | 'degraded';
  connectionStatus: 'online' | 'offline' | 'p2p-swarm';
  fileSizeBytes?: number;
  priorityScore: number;
}

export interface StremioSubtitleTrack {
  id: string;
  url: string;
  lang: string;       // Código ISO/IETF ej. 'spa', 'es-419', 'es-ES', 'eng'
  label: string;      // Ej. 'Español Latino (OpenSubtitles)'
  format: 'srt' | 'vtt' | 'ass' | 'ssa';
  addonName: string;
  isEmbedded?: boolean;
}

export interface WatchProgressEntry {
  id: string;
  profileId: string;
  mediaId: string;
  mediaType: string;
  title: string;
  poster?: string;
  backdrop?: string;
  season?: number;
  episode?: number;
  episodeTitle?: string;
  positionSeconds: number;
  durationSeconds: number;
  completed: boolean;
  lastStreamInfo?: {
    addonName?: string;
    streamUrl?: string;
    languageBucket?: LanguageBucket;
    subtitleId?: string;
  };
  updatedAt: string;
}

export interface LibraryEntry {
  id: string;
  profileId: string;
  mediaId: string;
  mediaType: string;
  title: string;
  poster?: string;
  year?: string;
  imdbRating?: string;
  isFavorite: boolean;
  inWatchlist: boolean;
  isWatched: boolean;
  customListName?: string | null;
  addedAt: string;
}

export interface SubtitleSyncPreset {
  id: string;
  profileId: string;
  mediaId: string;
  season: number;
  episode: number;
  subtitleId: string;
  initialOffsetMs: number;
  driftScaleFactor: number;
  referencePointMs: number;
  updatedAt: string;
}

export interface TempDownloadItem {
  id: string;
  mediaId: string;
  title: string;
  episodeLabel?: string;
  sourceUrl: string;
  category: 'temp_download' | 'stream_cache';
  status: 'downloading' | 'paused' | 'ready' | 'error' | 'expired';
  bytesDownloaded: number;
  totalBytes: number;
  progressPct: number;
  speedBps: number;
  playableLocalUrl?: string;
  expiresAt: string;
  createdAt: string;
}

export interface LocalAgentStatus {
  isOnline: boolean;
  deviceName: string;
  endpointUrl: string;
  ffmpegAvailable: boolean;
  ffmpegVersion?: string;
  tempDir: string;
  tempUsedBytes: number;
  tempQuotaBytes: number;
  indexedFilesCount: number;
  activeDownloadsCount: number;
  lastHeartbeatAt: string;
}

