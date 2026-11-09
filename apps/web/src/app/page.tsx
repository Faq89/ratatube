'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  FamilyAccount,
  FamilyProfile,
  InstalledAddon,
  LanguageBucket,
  LibraryEntry,
  LocalAgentStatus,
  StremioMetaItem,
  SubtitleVisualStyle,
  TempDownloadItem,
  WatchProgressEntry
} from '@ratatube/shared';
import VideoPlayerModal from '@/components/VideoPlayerModal';
import MediaDetailModal from '@/components/MediaDetailModal';
import {
  Film,
  Tv,
  Sparkles,
  Library,
  PlayCircle,
  Puzzle,
  Download,
  Users,
  Settings,
  Search,
  Home,
  Play,
  Info,
  Star,
  Plus,
  Trash2,
  CheckCircle2,
  Laptop,
  Cloud,
  ShieldAlert,
  RefreshCw,
  Pause,
  Heart,
  LogIn,
  LogOut,
  UserPlus,
  Eye,
  EyeOff,
  Key,
  Copy,
  Check,
  X
} from 'lucide-react';

const AUTH_STORAGE_KEY = 'ratatube_auth_session_v1';
const ACCOUNTS_VAULT_KEY = 'ratatube_accounts_vault_v1';

const SUPABASE_RLS_UNLOCK_SQL = `ALTER TABLE public.family_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.installed_addons DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.watch_progress DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.subtitle_sync_presets DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_agents DISABLE ROW LEVEL SECURITY;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;`;

function generateSyncCode(acc: FamilyAccount, profs: FamilyProfile[]): string {
  try {
    const payload = JSON.stringify({
      id: acc.id,
      email: acc.email,
      familyName: acc.familyName,
      inviteCode: acc.inviteCode,
      personalInfo: acc.personalInfo,
      profiles: profs
    });
    return 'RT-' + btoa(encodeURIComponent(payload));
  } catch {
    return '';
  }
}

function parseSyncCode(code: string): { account: FamilyAccount; profiles: FamilyProfile[] } | null {
  try {
    const raw = code.trim().replace(/^RT-/, '');
    const json = decodeURIComponent(atob(raw));
    const parsed = JSON.parse(json);
    if (parsed.id && parsed.email && Array.isArray(parsed.profiles)) {
      return {
        account: {
          id: parsed.id,
          email: parsed.email,
          familyName: parsed.familyName || 'Mi Cuenta',
          inviteCode: parsed.inviteCode || 'RATA-SYNC',
          personalInfo: parsed.personalInfo,
          createdAt: new Date().toISOString()
        },
        profiles: parsed.profiles
      };
    }
  } catch {}
  return null;
}

const GUEST_PROFILE_CLIENT: FamilyProfile = {
  id: 'guest-profile',
  accountId: 'guest-account',
  name: 'Invitado (Sin sesión)',
  avatar: '👤',
  avatarColor: '#475569',
  isAdmin: false,
  isKid: false,
  isGuest: true,
  maxAgeRating: 'ALL',
  pinCode: null,
  languagePriority: ['es-419', 'es-ES', 'orig-sub-es', 'orig-other', 'unknown'],
  defaultLanguageFilter: 'all',
  subtitleStyle: {
    fontSize: 26,
    fontFamily: 'Inter, system-ui, sans-serif',
    textColor: '#FFFFFF',
    backgroundColor: '#000000',
    backgroundOpacity: 0.65,
    verticalOffsetPct: 8,
    outlineWidth: 2,
    outlineColor: '#000000',
    shadow: true
  },
  createdAt: ''
};

type NavSection =
  | 'inicio'
  | 'peliculas'
  | 'series'
  | 'anime'
  | 'documentales'
  | 'biblioteca'
  | 'continuar'
  | 'addons'
  | 'descargas'
  | 'perfiles'
  | 'configuracion';

const GENRES_LIST = [
  'Action',
  'Adventure',
  'Animation',
  'Comedy',
  'Crime',
  'Documentary',
  'Drama',
  'Family',
  'Fantasy',
  'History',
  'Horror',
  'Mystery',
  'Romance',
  'Sci-Fi',
  'Thriller'
];

export default function RatatubeHubPage() {
  const [activeSection, setActiveSection] = useState<NavSection>(() => {
    if (typeof window === 'undefined') return 'inicio';
    try {
      const s = localStorage.getItem('ratatube_active_section_v1');
      if (
        s &&
        [
          'inicio',
          'peliculas',
          'series',
          'anime',
          'documentales',
          'biblioteca',
          'continuar',
          'addons',
          'descargas',
          'perfiles',
          'configuracion'
        ].includes(s)
      ) {
        return s as NavSection;
      }
    } catch {}
    return 'inicio';
  });

  // Persistir la sección activa para que al pulsar F5 o refrescar permanezca exactamente donde estaba
  useEffect(() => {
    try {
      localStorage.setItem('ratatube_active_section_v1', activeSection);
    } catch {}
  }, [activeSection]);

  // Cuenta de Usuario, Perfiles y Estado Cloud Supabase (Inicializados síncronamente desde localStorage)
  const [account, setAccount] = useState<FamilyAccount | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        return p?.account || null;
      }
    } catch {}
    return null;
  });

  const [profiles, setProfiles] = useState<FamilyProfile[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        return Array.isArray(p?.profiles) ? p.profiles : [];
      }
    } catch {}
    return [];
  });

  const [activeProfile, setActiveProfile] = useState<FamilyProfile | null>(() => {
    if (typeof window === 'undefined') return GUEST_PROFILE_CLIENT;
    try {
      let savedStyle: SubtitleVisualStyle | null = null;
      try {
        const rawStyle = localStorage.getItem('ratatube_subtitle_style');
        if (rawStyle) savedStyle = JSON.parse(rawStyle);
      } catch {}

      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (p?.account && Array.isArray(p?.profiles) && p.profiles.length > 0) {
          const match = p.profiles.find((pr: FamilyProfile) => pr.id === p.activeProfileId) || p.profiles[0];
          if (match) {
            return {
              ...match,
              subtitleStyle: {
                ...match.subtitleStyle,
                ...(savedStyle || {})
              }
            };
          }
        }
      }
      if (savedStyle) {
        return {
          ...GUEST_PROFILE_CLIENT,
          subtitleStyle: {
            ...GUEST_PROFILE_CLIENT.subtitleStyle,
            ...savedStyle
          }
        };
      }
    } catch {}
    return GUEST_PROFILE_CLIENT;
  });

  // Biblioteca y Progreso del Perfil Activo (Inicializados síncronamente sin parpadeos)
  const [watchProgress, setWatchProgress] = useState<WatchProgressEntry[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        return Array.isArray(p?.watchProgress) ? p.watchProgress : [];
      }
    } catch {}
    return [];
  });

  const [libraryItems, setLibraryItems] = useState<LibraryEntry[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const raw = localStorage.getItem(AUTH_STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        return Array.isArray(p?.library) ? p.library : [];
      }
    } catch {}
    return [];
  });
  const [cloudStatus, setCloudStatus] = useState<{
    connected: boolean;
    url: string;
    mode: string;
    hasServiceKey?: boolean;
    rlsBlocked?: boolean;
  }>({
    connected: true,
    url: 'https://aejfuovgwgweipyyexjt.supabase.co',
    mode: 'supabase-cloud',
    rlsBlocked: false
  });

  // Estado del Modal de Autenticación (Iniciar Sesión / Crear Cuenta)
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'sync-code'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [showAuthPassword, setShowAuthPassword] = useState(false);
  const [authSyncCodeInput, setAuthSyncCodeInput] = useState('');
  const [authFirstName, setAuthFirstName] = useState('');
  const [authLastName, setAuthLastName] = useState('');
  const [authPhone, setAuthPhone] = useState('');
  const [authCountry, setAuthCountry] = useState('');
  const [authBirthDate, setAuthBirthDate] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(false);

  // Estados de Ajustes de Cuenta y Seguridad
  const [accountPasswordInput, setAccountPasswordInput] = useState('');
  const [showAccountPassword, setShowAccountPassword] = useState(false);
  const [accountPasswordMsg, setAccountPasswordMsg] = useState<{
    text: string;
    isError?: boolean;
  } | null>(null);

  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editCountry, setEditCountry] = useState('');
  const [editBirthDate, setEditBirthDate] = useState('');
  const [personalInfoMsg, setPersonalInfoMsg] = useState<{
    text: string;
    isError?: boolean;
  } | null>(null);

  const [copiedSyncCode, setCopiedSyncCode] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  // Catálogos Stremio
  const [moviesCatalog, setMoviesCatalog] = useState<StremioMetaItem[]>([]);
  const [seriesCatalog, setSeriesCatalog] = useState<StremioMetaItem[]>([]);
  const [animeCatalog, setAnimeCatalog] = useState<StremioMetaItem[]>([]);
  const [docsCatalog, setDocsCatalog] = useState<StremioMetaItem[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<StremioMetaItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(true);

  // Biblioteca y Filtros
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'favorites' | 'watchlist' | 'watched'>(
    'all'
  );

  // Addons Stremio
  const [installedAddons, setInstalledAddons] = useState<InstalledAddon[]>([]);
  const [stremioDirectory, setStremioDirectory] = useState<any[]>([]);
  const [newAddonUrl, setNewAddonUrl] = useState('');
  const [addonMessage, setAddonMessage] = useState<string | null>(null);

  // Agente Local Windows y Descargas Temporales
  const [agentStatus, setAgentStatus] = useState<LocalAgentStatus | null>(null);
  const [agentSimulatedOnline, setAgentSimulatedOnline] = useState(true);
  const [tempDownloads, setTempDownloads] = useState<TempDownloadItem[]>([]);

  // Modales de Detalle y Reproducción
  const [detailItem, setDetailItem] = useState<StremioMetaItem | null>(null);
  const [playingContext, setPlayingContext] = useState<{
    meta: StremioMetaItem;
    season?: number;
    episode?: number;
    initialPos?: number;
  } | null>(null);

  // Formularios de Perfiles y Configuración Supabase
  const [newProfileName, setNewProfileName] = useState('');
  const [newProfileAvatar, setNewProfileAvatar] = useState('🦊');
  const [newProfileIsKid, setNewProfileIsKid] = useState(false);
  const [supabaseUrlInput, setSupabaseUrlInput] = useState('');
  const [supabaseKeyInput, setSupabaseKeyInput] = useState('');
  const [supabaseServiceKeyInput, setSupabaseServiceKeyInput] = useState('');
  const [showSupabaseKey, setShowSupabaseKey] = useState(false);
  const [showSupabaseServiceKey, setShowSupabaseServiceKey] = useState(false);
  const [configSavedBanner, setConfigSavedBanner] = useState<string | null>(null);

  // 1. Carga inicial: Si no hay sesión iniciada en el navegador, se mantiene en Modo Invitado 100% limpio (0 consultas a Supabase)
  useEffect(() => {
    try {
      const rawSession = localStorage.getItem(AUTH_STORAGE_KEY);
      if (rawSession) {
        const parsed = JSON.parse(rawSession);
        if (parsed?.account && Array.isArray(parsed?.profiles) && parsed.profiles.length > 0) {
          setAccount(parsed.account);
          setProfiles(parsed.profiles);
          const restoredProfile =
            parsed.profiles.find((p: FamilyProfile) => p.id === parsed.activeProfileId) ||
            parsed.profiles[0];
          setActiveProfile(restoredProfile);
          if (Array.isArray(parsed.watchProgress)) {
            setWatchProgress(parsed.watchProgress);
          }
          if (Array.isArray(parsed.library)) {
            setLibraryItems(parsed.library);
          }
        }
      }
    } catch {
      // Si falla localStorage, permanece en Modo Invitado limpio
    }

    fetch('/api/addons?directory=true')
      .then((r) => r.json())
      .then((data) => {
        setInstalledAddons(data.addons || []);
        setStremioDirectory(data.directory || []);
      })
      .catch(() => {});

    refreshTempDownloadsAndAgent();
  }, []);

  useEffect(() => {
    if (account?.personalInfo) {
      setEditFirstName(account.personalInfo.firstName || '');
      setEditLastName(account.personalInfo.lastName || '');
      setEditPhone(account.personalInfo.phone || '');
      setEditCountry(account.personalInfo.country || '');
      setEditBirthDate(account.personalInfo.birthDate || '');
    }
  }, [account]);

  useEffect(() => {
    if (activeSection === 'perfiles' || activeSection === 'configuracion') {
      fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'check-rls' })
      })
        .then((r) => r.json())
        .then((d) => {
          if (d.cloudStatus) {
            setCloudStatus(d.cloudStatus);
          }
        })
        .catch(() => {});
    }
  }, [activeSection]);

  const persistSessionToBrowser = (
    acc: FamilyAccount | null,
    profs: FamilyProfile[],
    activeProf: FamilyProfile | null,
    progList = watchProgress,
    libList = libraryItems
  ) => {
    try {
      if (!acc || !activeProf || activeProf.isGuest || activeProf.id === 'guest-profile') {
        localStorage.removeItem(AUTH_STORAGE_KEY);
        return;
      }
      localStorage.setItem(
        AUTH_STORAGE_KEY,
        JSON.stringify({
          account: acc,
          profiles: profs,
          activeProfileId: activeProf.id,
          watchProgress: progList,
          library: libList
        })
      );
      const rawVault = localStorage.getItem(ACCOUNTS_VAULT_KEY);
      const vault = rawVault ? JSON.parse(rawVault) : {};
      const existingEntry = vault[acc.email.toLowerCase()] || {};
      const profileProgressMap = existingEntry.profileProgress || {};
      profileProgressMap[activeProf.id] = progList;
      const profileLibraryMap = existingEntry.profileLibrary || {};
      profileLibraryMap[activeProf.id] = libList;

      vault[acc.email.toLowerCase()] = {
        account: acc,
        profiles: profs,
        activeProfileId: activeProf.id,
        watchProgress: progList,
        library: libList,
        profileProgress: profileProgressMap,
        profileLibrary: profileLibraryMap
      };
      localStorage.setItem(ACCOUNTS_VAULT_KEY, JSON.stringify(vault));
    } catch {}
  };

  const handleLogout = () => {
    try {
      localStorage.removeItem(AUTH_STORAGE_KEY);
      localStorage.removeItem('ratatube_active_section_v1');
    } catch {}
    setAccount(null);
    setProfiles([]);
    setActiveProfile(GUEST_PROFILE_CLIENT);
    setWatchProgress([]);
    setLibraryItems([]);
    setActiveSection('inicio');
  };

  const handleRemoveWatchProgress = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setWatchProgress((prev) => {
      const next = prev.filter((p) => p.id !== id);
      persistSessionToBrowser(account, profiles, activeProfile, next, libraryItems);
      return next;
    });
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setAuthLoading(true);
    try {
      if (authMode === 'sync-code') {
        const parsed = parseSyncCode(authSyncCodeInput);
        if (!parsed) {
          setAuthError(
            'El código de vinculación no es válido. Asegúrate de copiarlo completo desde tu otro dispositivo.'
          );
          setAuthLoading(false);
          return;
        }
        setAccount(parsed.account);
        setProfiles(parsed.profiles);
        const mainProf = parsed.profiles[0] || GUEST_PROFILE_CLIENT;
        setActiveProfile(mainProf);
        persistSessionToBrowser(parsed.account, parsed.profiles, mainProf, [], []);
        setShowAuthModal(false);
        setAuthSyncCodeInput('');
        fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'sync-to-cloud',
            account: parsed.account,
            profiles: parsed.profiles
          })
        }).catch(() => {});
        return;
      }

      let vaultBackup: any = undefined;
      if (authMode === 'login') {
        try {
          const rawVault = localStorage.getItem(ACCOUNTS_VAULT_KEY);
          if (rawVault) {
            const parsedVault = JSON.parse(rawVault);
            vaultBackup = parsedVault[authEmail.trim().toLowerCase()];
          }
        } catch {}
      }

      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: authMode,
          email: authEmail,
          password: authPassword,
          vaultBackup,
          personalInfo:
            authMode === 'register'
              ? {
                  firstName: authFirstName,
                  lastName: authLastName,
                  phone: authPhone,
                  country: authCountry,
                  birthDate: authBirthDate
                }
              : undefined
        })
      });
      const data = await res.json();
      if (!res.ok) {
        setAuthError(data.error || 'No se pudo completar la operación.');
        return;
      }

      setAccount(data.account);
      setProfiles(data.profiles || []);
      const mainProf = data.activeProfile || data.profiles?.[0] || GUEST_PROFILE_CLIENT;
      setActiveProfile(mainProf);

      // Si el servidor devolvió progreso o biblioteca, o si el vault local tenía datos, restaurar el más completo
      const localVaultProg = vaultBackup?.watchProgress || [];
      const serverProg = data.watchProgress || [];
      const nextProg = serverProg.length > 0 ? serverProg : localVaultProg;

      const localVaultLib = vaultBackup?.library || [];
      const serverLib = data.library || [];
      const nextLib = serverLib.length > 0 ? serverLib : localVaultLib;

      setWatchProgress(nextProg);
      setLibraryItems(nextLib);
      if (data.cloudStatus) {
        setCloudStatus(data.cloudStatus);
      }
      persistSessionToBrowser(data.account, data.profiles || [], mainProf, nextProg, nextLib);
      setShowAuthModal(false);
      setAuthPassword('');
    } catch {
      setAuthError('Error de red al conectar con el servidor.');
    } finally {
      setAuthLoading(false);
    }
  };

  const refreshTempDownloadsAndAgent = () => {
    fetch('/api/temp-downloads')
      .then((r) => r.json())
      .then((data) => {
        setAgentStatus(data.status || null);
        setTempDownloads(data.downloads || []);
      })
      .catch(() => {});
  };

  // Refrescar estado de descargas temporales cuando se visita la pestaña Descargas
  useEffect(() => {
    if (activeSection !== 'descargas') return;
    refreshTempDownloadsAndAgent();
    const interval = setInterval(refreshTempDownloadsAndAgent, 2000);
    return () => clearInterval(interval);
  }, [activeSection]);

  // 2. Cargar Catálogo (0 consultas a BD), y si el usuario inició sesión fusionar progreso y biblioteca SIN borrar nunca lo local
  const loadProfileDataAndCatalogs = (profileId: string, genre = selectedGenre) => {
    setLoadingCatalog(true);
    const genreParam = genre ? `&genre=${encodeURIComponent(genre)}` : '';
    const isGuest = !profileId || profileId === 'guest-profile' || profileId.startsWith('guest');
    const currentProf = activeProfile?.id === profileId ? activeProfile : null;
    const ratingParam = currentProf
      ? `&maxRating=${encodeURIComponent(currentProf.maxAgeRating)}&isKid=${Boolean(
          currentProf.isKid
        )}`
      : '';

    Promise.all([
      fetch(`/api/catalog?category=movies&profileId=${profileId}${genreParam}${ratingParam}`).then(
        (r) => r.json()
      ),
      fetch(`/api/catalog?category=series&profileId=${profileId}${genreParam}${ratingParam}`).then(
        (r) => r.json()
      ),
      fetch(`/api/catalog?category=anime&profileId=${profileId}${ratingParam}`).then((r) =>
        r.json()
      ),
      fetch(`/api/catalog?category=documentaries&profileId=${profileId}${ratingParam}`).then((r) =>
        r.json()
      ),
      isGuest
        ? Promise.resolve({ progress: [] })
        : fetch(`/api/progress?profileId=${profileId}`).then((r) => r.json()).catch(() => ({ progress: [] })),
      isGuest
        ? Promise.resolve({ items: [] })
        : fetch(`/api/library?profileId=${profileId}`).then((r) => r.json()).catch(() => ({ items: [] }))
    ])
      .then(([mov, ser, ani, doc, prog, lib]) => {
        setMoviesCatalog(mov.items || []);
        setSeriesCatalog(ser.items || []);
        setAnimeCatalog(ani.items || []);
        setDocsCatalog(doc.items || []);

        if (isGuest) {
          setWatchProgress([]);
          setLibraryItems([]);
        } else {
          // Fusionar con el progreso local para que JAMÁS se pierda
          setWatchProgress((prevLocal) => {
            const remote: WatchProgressEntry[] = Array.isArray(prog?.progress) ? prog.progress : [];
            if (remote.length === 0) return prevLocal;
            const map = new Map<string, WatchProgressEntry>();
            for (const r of remote) {
              map.set(`${r.mediaId}-${r.season || 0}-${r.episode || 0}`, r);
            }
            for (const loc of prevLocal) {
              const k = `${loc.mediaId}-${loc.season || 0}-${loc.episode || 0}`;
              if (!map.has(k)) {
                map.set(k, loc);
              } else {
                const rem = map.get(k)!;
                if (new Date(loc.updatedAt).getTime() > new Date(rem.updatedAt).getTime()) {
                  map.set(k, loc);
                }
              }
            }
            const merged = Array.from(map.values()).sort(
              (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
            );
            persistSessionToBrowser(account, profiles, activeProfile, merged, libraryItems);
            return merged;
          });

          // Fusionar con la biblioteca local para que JAMÁS se pierda
          setLibraryItems((prevLib) => {
            const remote: LibraryEntry[] = Array.isArray(lib?.items) ? lib.items : [];
            if (remote.length === 0) return prevLib;
            const map = new Map<string, LibraryEntry>();
            for (const r of remote) map.set(r.mediaId, r);
            for (const loc of prevLib) {
              if (!map.has(loc.mediaId)) map.set(loc.mediaId, loc);
            }
            const merged = Array.from(map.values());
            persistSessionToBrowser(account, profiles, activeProfile, watchProgress, merged);
            return merged;
          });
        }
      })
      .finally(() => setLoadingCatalog(false));
  };

  useEffect(() => {
    if (!activeProfile) return;
    loadProfileDataAndCatalogs(activeProfile.id, selectedGenre);
  }, [activeProfile?.id, selectedGenre]);

  // 3. Buscador unificado en tiempo real sobre Cinemeta + Kitsu + Cine Abierto
  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!searchQuery.trim() || !activeProfile) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const res = await fetch(
        `/api/catalog?search=${encodeURIComponent(searchQuery.trim())}&profileId=${activeProfile.id}`
      );
      const data = await res.json();
      setSearchResults(data.items || []);
    } finally {
      setIsSearching(false);
    }
  };

  const handleToggleLibrary = async (
    meta: StremioMetaItem,
    field: 'isFavorite' | 'inWatchlist' | 'isWatched',
    customListName?: string
  ) => {
    if (!activeProfile || activeProfile.isGuest || activeProfile.id === 'guest-profile') {
      setShowAuthModal(true);
      return;
    }
    const res = await fetch('/api/library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profileId: activeProfile.id,
        mediaId: meta.id,
        mediaType: meta.type,
        title: meta.name,
        poster: meta.poster,
        year: String(meta.year || meta.releaseInfo || ''),
        imdbRating: meta.imdbRating,
        toggleField: field,
        customListName
      })
    });
    const data = await res.json();
    if (data.items) {
      setLibraryItems(data.items);
      persistSessionToBrowser(account, profiles, activeProfile, watchProgress, data.items);
    }
  };

  const handleInstallAddon = async (urlToInstall: string) => {
    setAddonMessage(null);
    const res = await fetch('/api/addons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manifestUrl: urlToInstall })
    });
    const data = await res.json();
    if (!res.ok) {
      setAddonMessage(`Error: ${data.error}`);
      return;
    }
    setInstalledAddons(data.addons || []);
    setNewAddonUrl('');
    setAddonMessage(`✓ Addon "${data.installed?.name}" instalado y activo.`);
  };

  const subStyleDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  const handleUpdateSubtitleStyle = (newStyle: SubtitleVisualStyle) => {
    try {
      localStorage.setItem('ratatube_subtitle_style', JSON.stringify(newStyle));
    } catch {}

    if (!activeProfile) return;
    const updatedProfile = { ...activeProfile, subtitleStyle: newStyle };
    setActiveProfile(updatedProfile);

    if (activeProfile.isGuest || activeProfile.id === 'guest-profile') {
      return;
    }

    const updatedProfiles = profiles.map((p) => (p.id === updatedProfile.id ? updatedProfile : p));
    setProfiles(updatedProfiles);
    persistSessionToBrowser(account, updatedProfiles, updatedProfile);

    if (subStyleDebounceTimerRef.current) {
      clearTimeout(subStyleDebounceTimerRef.current);
    }
    subStyleDebounceTimerRef.current = setTimeout(() => {
      fetch('/api/profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedProfile)
      }).catch(() => {});
    }, 600);
  };

  const heroItem = moviesCatalog[0] || seriesCatalog[0];

  // Helper para carruseles horizontales con desplazamiento suave estilo Netflix / Max
  const renderCarouselRow = (
    title: string,
    items: StremioMetaItem[],
    rowId: string,
    viewAllSection?: NavSection,
    badgeText?: string
  ) => {
    if (items.length === 0) return null;
    return (
      <section className="relative space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <h2 className="text-lg sm:text-xl font-extrabold tracking-tight text-white flex items-center gap-2">
              {title}
              {badgeText && (
                <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/30">
                  {badgeText}
                </span>
              )}
            </h2>
          </div>
          {viewAllSection && (
            <button
              onClick={() => setActiveSection(viewAllSection)}
              className="group flex items-center gap-1 text-xs font-semibold text-emerald-400 transition hover:text-emerald-300"
            >
              <span>Explorar todo</span>
              <span className="transition-transform group-hover:translate-x-1">→</span>
            </button>
          )}
        </div>

        {/* Carrusel Desplazable con botones de flecha estilo Netflix */}
        <div className="group/tray relative">
          <button
            onClick={() => {
              const el = document.getElementById(rowId);
              if (el) el.scrollBy({ left: -650, behavior: 'smooth' });
            }}
            className="absolute -left-3 top-1/2 z-20 -translate-y-1/2 rounded-full border border-white/20 bg-black/85 p-2 text-white shadow-xl backdrop-blur-md opacity-0 group-hover/tray:opacity-100 hover:bg-emerald-500 hover:text-black hover:border-emerald-500 transition-all duration-200"
            aria-label="Anterior"
          >
            ‹
          </button>

          <div
            id={rowId}
            className="flex gap-4 overflow-x-auto no-scrollbar scroll-smooth pb-3 pt-1 px-1"
          >
            {items.map((item) => {
              const libEntry = libraryItems.find((l) => l.mediaId === item.id);
              return (
                <div
                  key={item.id}
                  onClick={() => setDetailItem(item)}
                  className="group relative flex w-[155px] sm:w-[185px] md:w-[210px] flex-shrink-0 cursor-pointer flex-col overflow-hidden rounded-xl border border-white/10 bg-[#121622] transition-all duration-300 hover:scale-105 hover:border-emerald-500/60 hover:shadow-2xl hover:shadow-emerald-500/15"
                >
                  <div className="relative aspect-[2/3] w-full overflow-hidden bg-[#181f2f]">
                    {item.poster ? (
                      <img
                        src={item.poster}
                        alt={item.name}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center p-4 text-center text-xs text-gray-400">
                        {item.name}
                      </div>
                    )}

                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-black shadow-lg shadow-emerald-500/40 transition-transform group-hover:scale-110">
                        <Play className="h-6 w-6 fill-black" />
                      </span>
                      <span className="mt-2 text-[11px] font-bold text-white">Reproducir</span>
                    </div>

                    {item.imdbRating && (
                      <span className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-black/80 px-2 py-0.5 text-[11px] font-bold text-emerald-400 shadow">
                        <Star className="h-3 w-3 fill-emerald-400" /> {item.imdbRating}
                      </span>
                    )}

                    {libEntry?.isFavorite && (
                      <span className="absolute right-2 top-2 rounded-full bg-rose-600 p-1 text-white shadow">
                        <Heart className="h-3 w-3 fill-white" />
                      </span>
                    )}
                  </div>

                  <div className="flex flex-1 flex-col justify-between p-3">
                    <h4 className="line-clamp-1 text-xs font-bold text-gray-100 transition group-hover:text-emerald-400">
                      {item.name}
                    </h4>
                    <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
                      <span>{item.year || item.releaseInfo || 'Catálogo'}</span>
                      <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-emerald-300">
                        {item.type === 'series' ? 'Serie' : item.type === 'anime' ? 'Anime' : 'Cine'}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <button
            onClick={() => {
              const el = document.getElementById(rowId);
              if (el) el.scrollBy({ left: 650, behavior: 'smooth' });
            }}
            className="absolute -right-3 top-1/2 z-20 -translate-y-1/2 rounded-full border border-white/20 bg-black/85 p-2 text-white shadow-xl backdrop-blur-md opacity-0 group-hover/tray:opacity-100 hover:bg-emerald-500 hover:text-black hover:border-emerald-500 transition-all duration-200"
            aria-label="Siguiente"
          >
            ›
          </button>
        </div>
      </section>
    );
  };

  const renderMediaGrid = (items: StremioMetaItem[], emptyMessage = 'No se encontraron títulos.') => {
    if (items.length === 0) {
      return (
        <div className="rounded-2xl border border-white/10 bg-[#121623] p-8 text-center text-sm text-gray-400">
          {emptyMessage}
        </div>
      );
    }

    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {items.map((item) => {
          const libEntry = libraryItems.find((l) => l.mediaId === item.id);
          return (
            <div
              key={item.id}
              onClick={() => setDetailItem(item)}
              className="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border border-white/10 bg-[#131826] transition-all duration-300 hover:scale-105 hover:border-emerald-500/60 hover:shadow-2xl hover:shadow-emerald-500/15"
            >
              <div className="relative aspect-[2/3] w-full overflow-hidden bg-[#1a2032]">
                {item.poster ? (
                  <img
                    src={item.poster}
                    alt={item.name}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center p-4 text-center text-xs text-gray-400">
                    {item.name}
                  </div>
                )}

                <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition group-hover:opacity-100">
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-black shadow-lg shadow-emerald-500/40 transition-transform group-hover:scale-110">
                    <Play className="h-6 w-6 fill-black" />
                  </span>
                </div>

                {item.imdbRating && (
                  <span className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-black/80 px-2 py-0.5 text-[11px] font-bold text-emerald-400">
                    <Star className="h-3 w-3 fill-emerald-400" /> {item.imdbRating}
                  </span>
                )}

                {libEntry?.isFavorite && (
                  <span className="absolute right-2 top-2 rounded-full bg-rose-600 p-1 text-white">
                    <Heart className="h-3 w-3 fill-white" />
                  </span>
                )}
              </div>

              <div className="flex flex-1 flex-col justify-between p-3">
                <h4 className="line-clamp-1 text-xs font-bold text-gray-100 group-hover:text-emerald-400">
                  {item.name}
                </h4>
                <div className="mt-1 flex items-center justify-between text-[11px] text-gray-400">
                  <span>{item.year || item.releaseInfo || 'Catálogo'}</span>
                  <span className="uppercase text-emerald-400/90 font-medium">
                    {item.type === 'series' ? 'Serie' : item.type === 'anime' ? 'Anime' : 'Cine'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#090b10] text-gray-100">
      {/* BARRA DE NAVEGACIÓN SUPERIOR ESTILO STREAMING (NETFLIX / MAX) */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#090b10]/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4 px-6 py-3.5">
          {/* Identidad Visual Propia */}
          <div className="flex items-center gap-6">
            <button
              onClick={() => {
                setActiveSection('inicio');
                setSearchResults([]);
              }}
              className="group flex items-center gap-2.5 text-left"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 font-black text-black shadow-lg shadow-emerald-500/20 transition-transform group-hover:scale-105">
                RT
              </div>
              <div>
                <span className="text-lg font-black tracking-tight text-white">
                  RATA<span className="text-emerald-400">TUBE</span>
                </span>
                <span className="block text-[10px] font-semibold uppercase tracking-widest text-emerald-400/80">
                  Stremio Hybrid Hub
                </span>
              </div>
            </button>

            {/* Navegación de las secciones principales estilo Netflix / Max */}
            <nav className="hidden xl:flex items-center gap-1.5">
              {[
                { id: 'inicio', label: 'Inicio', icon: Home },
                { id: 'peliculas', label: 'Películas', icon: Film },
                { id: 'series', label: 'Series', icon: Tv },
                { id: 'anime', label: 'Anime', icon: Sparkles },
                { id: 'biblioteca', label: 'Mi Biblioteca', icon: Library },
                { id: 'continuar', label: 'Continuar Viendo', icon: PlayCircle },
                { id: 'addons', label: 'Fuentes & Addons', icon: Puzzle },
                { id: 'descargas', label: 'Descargas Temp', icon: Download },
                { id: 'perfiles', label: 'Perfiles', icon: Users },
                { id: 'configuracion', label: 'Ajustes', icon: Settings }
              ].map((nav) => {
                const Icon = nav.icon;
                const active = activeSection === nav.id;
                return (
                  <button
                    key={nav.id}
                    onClick={() => {
                      setActiveSection(nav.id as NavSection);
                      setSearchResults([]);
                    }}
                    className={`flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition ${
                      active
                        ? 'bg-emerald-500 text-black font-extrabold shadow-md shadow-emerald-500/20'
                        : 'text-gray-300 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {nav.label}
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Buscador Unificado + Indicador Agente Local + Selector Rápido de Perfil */}
          <div className="flex items-center gap-3">
            <form onSubmit={handleSearch} className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar película, serie o anime..."
                className="w-56 rounded-xl border border-white/15 bg-[#131826] py-2 pl-9 pr-3 text-xs text-white placeholder-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 sm:w-72"
              />
            </form>

            {/* Píldora de estado del Agente Local (Online/Offline) */}
            <button
              onClick={() => setAgentSimulatedOnline(!agentSimulatedOnline)}
              title="Haz clic para simular conectar/desconectar el portátil Windows"
              className={`hidden sm:flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
                agentSimulatedOnline
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300 shadow-sm shadow-emerald-500/20'
                  : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
              }`}
            >
              <Laptop className="h-3.5 w-3.5" />
              {agentSimulatedOnline ? 'Agente Local: Online' : 'Portátil: Desconectado'}
            </button>

            {/* Selector de Cuenta / Perfil o Botón Iniciar Sesión / Crear Cuenta */}
            {!account || activeProfile?.isGuest ? (
              <div className="flex items-center gap-2">
                <span className="hidden md:inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-2.5 py-1.5 text-[11px] font-medium text-gray-400">
                  👤 Modo Invitado
                </span>
                <button
                  onClick={() => {
                    setAuthError(null);
                    setShowAuthModal(true);
                  }}
                  className="flex items-center gap-2 rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-black text-black shadow-md shadow-emerald-500/20 transition hover:bg-emerald-400"
                >
                  <LogIn className="h-3.5 w-3.5" />
                  <span>Iniciar Sesión / Cuenta</span>
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {activeProfile && (
                  <button
                    onClick={() => setActiveSection('perfiles')}
                    className="flex items-center gap-2 rounded-xl border border-emerald-500/40 bg-[#131826] px-3 py-1.5 text-xs font-bold text-white hover:border-emerald-500"
                  >
                    <span className="text-base">{activeProfile.avatar}</span>
                    <span>{activeProfile.name}</span>
                    {activeProfile.isKid && (
                      <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300 font-semibold">
                        KIDS
                      </span>
                    )}
                  </button>
                )}
                <button
                  onClick={handleLogout}
                  title="Cerrar sesión y volver a modo sin rastro"
                  className="flex items-center gap-1 rounded-xl border border-white/15 bg-white/5 px-2.5 py-1.5 text-xs font-semibold text-gray-300 hover:bg-rose-500/20 hover:text-rose-300"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Salir</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Navegación móvil adaptable */}
        <div className="flex xl:hidden overflow-x-auto border-t border-white/5 px-4 py-2 gap-1.5 no-scrollbar">
          {[
            { id: 'inicio', label: 'Inicio' },
            { id: 'peliculas', label: 'Películas' },
            { id: 'series', label: 'Series' },
            { id: 'anime', label: 'Anime' },
            { id: 'biblioteca', label: 'Biblioteca' },
            { id: 'continuar', label: 'Continuar' },
            { id: 'addons', label: 'Addons' },
            { id: 'descargas', label: 'Descargas' },
            { id: 'perfiles', label: 'Perfiles' },
            { id: 'configuracion', label: 'Ajustes' }
          ].map((n) => (
            <button
              key={n.id}
              onClick={() => {
                setActiveSection(n.id as NavSection);
                setSearchResults([]);
              }}
              className={`whitespace-nowrap rounded-lg px-3 py-1 text-xs font-semibold ${
                activeSection === n.id ? 'bg-emerald-500 text-black font-bold' : 'bg-white/5 text-gray-300'
              }`}
            >
              {n.label}
            </button>
          ))}
        </div>
      </header>

      {/* CONTENIDO PRINCIPAL */}
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-6 py-6">
        {/* RESULTADOS DE BÚSQUEDA EN VIVO */}
        {searchResults.length > 0 && (
          <section className="mb-10">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xl font-extrabold text-white">
                Resultados de búsqueda para &ldquo;{searchQuery}&rdquo; ({searchResults.length})
              </h2>
              <button
                onClick={() => {
                  setSearchResults([]);
                  setSearchQuery('');
                }}
                className="rounded-lg bg-white/10 px-3 py-1 text-xs text-gray-300 hover:bg-white/20"
              >
                Limpiar búsqueda
              </button>
            </div>
            {renderMediaGrid(searchResults)}
          </section>
        )}

        {/* SECCIÓN 1: INICIO (LAYOUT TIPO NETFLIX / MAX / PRIME) */}
        {activeSection === 'inicio' && searchResults.length === 0 && (
          <div className="space-y-10">
            {/* HERO BILLBOARD CINEMATOGRÁFICO ESTILO NETFLIX / MAX */}
            {heroItem && (
              <div className="relative overflow-hidden rounded-3xl border border-white/15 bg-[#101522] shadow-2xl">
                <div className="relative h-[420px] w-full sm:h-[480px]">
                  {heroItem.background || heroItem.poster ? (
                    <img
                      src={heroItem.background || heroItem.poster}
                      alt={heroItem.name}
                      className="h-full w-full object-cover opacity-45"
                    />
                  ) : null}
                  <div className="absolute inset-0 bg-gradient-to-r from-[#090b10] via-[#090b10]/85 to-transparent" />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#090b10] via-transparent to-transparent" />

                  <div className="absolute bottom-8 left-8 right-8 max-w-2xl space-y-4">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                      <span className="rounded-md bg-emerald-500 px-2.5 py-0.5 text-black">
                        PRIORIDAD ESPAÑOL LATINO (ES-419)
                      </span>
                      <span className="rounded-md bg-white/10 px-2.5 py-0.5 text-emerald-300 border border-emerald-500/20">
                        ECOSISTEMA STREMIO ({installedAddons.filter((a) => a.isEnabled).length} ADDONS)
                      </span>
                      {heroItem.imdbRating && (
                        <span className="rounded-md bg-emerald-500/20 px-2.5 py-0.5 text-emerald-300 flex items-center gap-1">
                          <Star className="h-3 w-3 fill-emerald-400" /> IMDb {heroItem.imdbRating}
                        </span>
                      )}
                      <span className="rounded-md bg-white/10 px-2.5 py-0.5 text-gray-300">
                        1080p FULL HD
                      </span>
                    </div>

                    <h1 className="text-3xl font-black tracking-tight text-white sm:text-5xl drop-shadow-md">
                      {heroItem.name}
                    </h1>

                    <p className="line-clamp-3 text-sm text-gray-300">
                      {heroItem.description ||
                        'Descubre y reproduce películas, series y anime desde múltiples proveedores de Stremio con sincronización avanzada de subtítulos.'}
                    </p>

                    <div className="flex flex-wrap items-center gap-3 pt-2">
                      <button
                        onClick={() => setPlayingContext({ meta: heroItem })}
                        className="flex items-center gap-2 rounded-xl bg-emerald-500 px-7 py-3 text-sm font-black text-black shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400 hover:scale-105"
                      >
                        <Play className="h-5 w-5 fill-black" /> Reproducir Ahora
                      </button>
                      <button
                        onClick={() => setDetailItem(heroItem)}
                        className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-5 py-3 text-sm font-bold text-white backdrop-blur-md hover:bg-white/20"
                      >
                        <Info className="h-5 w-5" /> Ver Ficha y Fuentes
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* CARRUSEL 1: CONTINUAR VIENDO DEL PERFIL ACTIVO (CON BANDEJA DESPLAZABLE) */}
            {watchProgress.length > 0 && (
              <section className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg sm:text-xl font-extrabold tracking-tight text-white flex items-center gap-2">
                    Continuar viendo como {activeProfile?.name}
                    <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400">
                      Historial Activo
                    </span>
                  </h2>
                  <button
                    onClick={() => setActiveSection('continuar')}
                    className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition"
                  >
                    Ver historial completo →
                  </button>
                </div>

                <div className="flex gap-4 overflow-x-auto no-scrollbar scroll-smooth pb-3 pt-1">
                  {watchProgress.map((wp) => {
                    const pct =
                      wp.durationSeconds > 0
                        ? Math.min(100, Math.round((wp.positionSeconds / wp.durationSeconds) * 100))
                        : 15;
                    return (
                      <div
                        key={wp.id}
                        onClick={() =>
                          setPlayingContext({
                            meta: {
                              id: wp.mediaId,
                              type: wp.mediaType,
                              name: wp.title,
                              poster: wp.poster,
                              background: wp.backdrop
                            },
                            season: wp.season,
                            episode: wp.episode,
                            initialPos: wp.positionSeconds
                          })
                        }
                        className="group relative w-[280px] sm:w-[320px] flex-shrink-0 cursor-pointer overflow-hidden rounded-xl border border-white/10 bg-[#131826] p-3.5 transition-all duration-300 hover:scale-105 hover:border-emerald-500/60 hover:shadow-xl hover:shadow-emerald-500/10"
                      >
                        <div className="flex items-center gap-3">
                          {wp.poster && (
                            <img
                              src={wp.poster}
                              alt={wp.title}
                              className="h-16 w-12 rounded-lg object-cover"
                            />
                          )}
                          <div className="flex-1 overflow-hidden pr-6">
                            <h4 className="truncate text-xs font-bold text-white group-hover:text-emerald-400 transition">
                              {wp.title}
                            </h4>
                            {wp.season && wp.episode ? (
                              <p className="text-[11px] text-emerald-300">
                                Temporada {wp.season} • Episodio {wp.episode}
                              </p>
                            ) : null}
                            <p className="mt-1 text-[11px] text-gray-400">
                              Retomar en {Math.floor(wp.positionSeconds / 60)}m{' '}
                              {Math.floor(wp.positionSeconds % 60)}s ({pct}%)
                            </p>
                          </div>
                        </div>

                        {/* Botón para quitar del historial */}
                        <button
                          onClick={(e) => handleRemoveWatchProgress(wp.id, e)}
                          title="Quitar del historial"
                          className="absolute right-2.5 top-2.5 rounded-lg bg-black/60 p-1.5 text-gray-400 opacity-0 group-hover:opacity-100 hover:bg-rose-600 hover:text-white transition"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>

                        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                          <div
                            className="h-full bg-emerald-500 rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* CARRUSEL 2: PELÍCULAS DESTACADAS Y CINE ABIERTO LATINO */}
            {renderCarouselRow(
              'Películas Populares y Cine Abierto',
              moviesCatalog,
              'tray-movies',
              'peliculas',
              'Cinemeta'
            )}

            {/* CARRUSEL 3: SERIES EN TENDENCIA */}
            {renderCarouselRow(
              'Series Populares por Temporada',
              seriesCatalog,
              'tray-series',
              'series',
              'Episodios'
            )}

            {/* CARRUSEL 4: ANIME EN TENDENCIA */}
            {renderCarouselRow(
              'Anime y Animación en Tendencia',
              animeCatalog,
              'tray-anime',
              'anime',
              'Kitsu'
            )}

            {/* CARRUSEL 5: MI LISTA / BIBLIOTECA DEL PERFIL ACTIVO (SI CONTIENE ELEMENTOS) */}
            {libraryItems.length > 0 &&
              renderCarouselRow(
                `Mi Lista Personal (${activeProfile?.name})`,
                libraryItems.map((li) => ({
                  id: li.mediaId,
                  type: li.mediaType,
                  name: li.title,
                  poster: li.poster,
                  year: li.year ? String(li.year) : undefined
                })),
                'tray-library',
                'biblioteca',
                'Guardados'
              )}
          </div>
        )}

        {/* SECCIÓN 2, 3, 4: PELÍCULAS / SERIES / ANIME */}
        {(activeSection === 'peliculas' ||
          activeSection === 'series' ||
          activeSection === 'anime') &&
          searchResults.length === 0 && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-black text-white">
                    {activeSection === 'peliculas'
                      ? 'Catálogo de Películas (Stremio Cinemeta)'
                      : activeSection === 'series'
                      ? 'Catálogo de Series por Temporada y Episodio'
                      : 'Catálogo de Anime y Animación (Anime Kitsu)'}
                  </h1>
                  <p className="text-xs text-gray-400">
                    Perfil activo: {activeProfile?.name} •{' '}
                    {activeProfile?.isKid
                      ? 'Filtro Infantil Activo (Contenido familiar seguro)'
                      : `Clasificación permitida: ${activeProfile?.maxAgeRating}`}
                  </p>
                </div>

                {activeSection !== 'anime' && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={() => setSelectedGenre('')}
                      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        selectedGenre === ''
                          ? 'bg-emerald-500 text-black font-bold'
                          : 'bg-white/10 text-gray-300 hover:bg-white/20'
                      }`}
                    >
                      Todos los géneros
                    </button>
                    {GENRES_LIST.map((g) => (
                      <button
                        key={g}
                        onClick={() => setSelectedGenre(g)}
                        className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                          selectedGenre === g
                            ? 'bg-emerald-500 text-black font-bold'
                            : 'bg-white/5 text-gray-300 hover:bg-white/10'
                        }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {loadingCatalog ? (
                <div className="py-12 text-center text-sm text-gray-400">
                  Cargando catálogo en tiempo real desde proveedores de Stremio...
                </div>
              ) : (
                renderMediaGrid(
                  activeSection === 'peliculas'
                    ? moviesCatalog
                    : activeSection === 'series'
                    ? seriesCatalog
                    : animeCatalog
                )
              )}
            </div>
          )}

        {/* SECCIÓN 5: MI BIBLIOTECA PERSONAL */}
        {activeSection === 'biblioteca' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h1 className="text-2xl font-black text-white">
                  Mi Biblioteca — {activeProfile?.name}
                </h1>
                <p className="text-xs text-gray-400">
                  Sincronizada por perfil en Supabase Cloud (cero archivos permanentes en disco
                  local).
                </p>
              </div>

              <div className="flex gap-2">
                {[
                  { id: 'all', label: 'Todo en Biblioteca' },
                  { id: 'favorites', label: '♥ Favoritos' },
                  { id: 'watchlist', label: '🔖 Pendientes' },
                  { id: 'watched', label: '✓ Vistos' }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setLibraryFilter(tab.id as any)}
                    className={`rounded-xl px-3.5 py-2 text-xs font-bold transition ${
                      libraryFilter === tab.id
                        ? 'bg-emerald-500 text-black'
                        : 'bg-white/10 text-gray-300 hover:bg-white/20'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {!account || activeProfile?.isGuest ? (
              <div className="rounded-2xl border border-emerald-500/30 bg-[#121623] p-8 text-center">
                <p className="text-sm font-bold text-white">
                  En Modo Invitado (Sin sesión) no se guarda ningún dato de biblioteca ni favoritos.
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  Inicia sesión o crea tu cuenta con tu correo y contraseña para guardar favoritos y
                  listas personales.
                </p>
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="mt-4 rounded-xl bg-emerald-500 px-5 py-2 text-xs font-black text-black hover:bg-emerald-400"
                >
                  Iniciar Sesión / Crear Cuenta
                </button>
              </div>
            ) : (
              renderMediaGrid(
                libraryItems
                  .filter((l) => {
                    if (libraryFilter === 'favorites') return l.isFavorite;
                    if (libraryFilter === 'watchlist') return l.inWatchlist;
                    if (libraryFilter === 'watched') return l.isWatched;
                    return (
                      l.isFavorite || l.inWatchlist || l.isWatched || Boolean(l.customListName)
                    );
                  })
                  .map((l) => ({
                    id: l.mediaId,
                    type: l.mediaType,
                    name: l.title,
                    poster: l.poster,
                    year: l.year,
                    imdbRating: l.imdbRating
                  })),
                'Aún no has agregado títulos a esta sección de tu biblioteca.'
              )
            )}
          </div>
        )}

        {/* SECCIÓN 6: CONTINUAR VIENDO E HISTORIAL */}
        {activeSection === 'continuar' && (
          <div className="space-y-6">
            <div>
              <h1 className="text-2xl font-black text-white">
                Continuar Viendo e Historial — {activeProfile?.name}
              </h1>
              <p className="text-xs text-gray-400">
                Tu progreso individual se conserva entre dispositivos únicamente cuando inicias
                sesión.
              </p>
            </div>

            {!account || activeProfile?.isGuest ? (
              <div className="rounded-2xl border border-emerald-500/30 bg-[#121623] p-8 text-center">
                <p className="text-sm font-bold text-white">
                  Historial 100% limpio — Estás en Modo Invitado (Sin sesión)
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  Mientras no inicies sesión no se guarda ningún historial ni posición de
                  reproducción. Inicia sesión o crea una cuenta para continuar viendo tus películas
                  y series donde las dejaste.
                </p>
                <button
                  onClick={() => setShowAuthModal(true)}
                  className="mt-4 rounded-xl bg-emerald-500 px-5 py-2 text-xs font-black text-black hover:bg-emerald-400"
                >
                  Iniciar Sesión / Crear Cuenta
                </button>
              </div>
            ) : watchProgress.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-[#121623] p-8 text-center text-sm text-gray-400">
                No tienes reproducciones recientes en este perfil.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {watchProgress.map((wp) => {
                  const pct =
                    wp.durationSeconds > 0
                      ? Math.min(100, Math.round((wp.positionSeconds / wp.durationSeconds) * 100))
                      : 10;
                  return (
                    <div
                      key={wp.id}
                      className="flex flex-col justify-between rounded-2xl border border-white/10 bg-[#131826] p-4 hover:border-emerald-500/40 transition"
                    >
                      <div className="flex gap-4">
                        {wp.poster && (
                          <img
                            src={wp.poster}
                            alt={wp.title}
                            className="h-24 w-16 rounded-lg object-cover"
                          />
                        )}
                        <div className="flex-1">
                          <h3 className="text-sm font-bold text-white">{wp.title}</h3>
                          {wp.season && wp.episode && (
                            <p className="text-xs font-semibold text-emerald-400">
                              Temporada {wp.season} • Episodio {wp.episode}
                            </p>
                          )}
                          <p className="mt-1 text-xs text-gray-400">
                            Posición: {Math.floor(wp.positionSeconds / 60)}m{' '}
                            {Math.floor(wp.positionSeconds % 60)}s /{' '}
                            {Math.floor(wp.durationSeconds / 60)}m ({pct}%)
                          </p>
                          {wp.lastStreamInfo?.addonName && (
                            <p className="mt-1 text-[11px] text-emerald-400">
                              Última fuente: {wp.lastStreamInfo.addonName}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="mt-4">
                        <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                          <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() =>
                              setPlayingContext({
                                meta: {
                                  id: wp.mediaId,
                                  type: wp.mediaType,
                                  name: wp.title,
                                  poster: wp.poster,
                                  background: wp.backdrop
                                },
                                season: wp.season,
                                episode: wp.episode,
                                initialPos: wp.positionSeconds
                              })
                            }
                            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-500 py-2 text-xs font-bold text-black hover:bg-emerald-400"
                          >
                            <Play className="h-4 w-4 fill-black" /> Continuar Reproducción
                          </button>
                          <button
                            onClick={(e) => handleRemoveWatchProgress(wp.id, e)}
                            className="rounded-xl border border-white/10 bg-white/5 p-2 text-gray-400 hover:bg-rose-500/20 hover:text-rose-300"
                            title="Quitar del historial"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* SECCIÓN 7: ADMINISTRADOR DE ADDONS DE STREMIO */}
        {activeSection === 'addons' && (
          <div className="space-y-8">
            <div className="rounded-2xl border border-emerald-500/30 bg-[#121726] p-6">
              <h1 className="text-2xl font-black text-white">
                Administrador Modular de Addons (Compatible con Stremio SDK)
              </h1>
              <p className="mt-1 text-xs text-gray-300">
                Instala cualquier complemento compatible con Stremio pegando la URL de su{' '}
                <code>manifest.json</code> o un enlace <code>stremio://...</code>. Los addons se
                ejecutan de forma aislada sin ejecutar código arbitrario en el navegador.
              </p>

              <div className="mt-4 flex flex-wrap gap-3">
                <input
                  type="text"
                  value={newAddonUrl}
                  onChange={(e) => setNewAddonUrl(e.target.value)}
                  placeholder="Pega aquí https://.../manifest.json o stremio://.../manifest.json"
                  className="flex-1 rounded-xl border border-white/15 bg-black px-4 py-2.5 text-xs text-white"
                />
                <button
                  onClick={() => handleInstallAddon(newAddonUrl)}
                  className="flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-black text-black hover:bg-emerald-400"
                >
                  <Plus className="h-4 w-4" /> Instalar Manifiesto
                </button>
              </div>
              {addonMessage && (
                <p className="mt-2.5 text-xs font-semibold text-emerald-300">{addonMessage}</p>
              )}
            </div>

            {/* Addons instalados actualmente */}
            <div>
              <h2 className="mb-3 text-lg font-extrabold text-white">
                Addons Instalados ({installedAddons.length})
              </h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {installedAddons.map((addon) => (
                  <div
                    key={addon.id}
                    className="flex flex-col justify-between rounded-2xl border border-white/10 bg-[#131826] p-4"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="text-sm font-bold text-white">{addon.name}</h3>
                          <span className="text-[11px] text-gray-400">
                            v{addon.version} • ID: {addon.addonId}
                          </span>
                        </div>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase ${
                            addon.isEnabled
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-gray-500/20 text-gray-400'
                          }`}
                        >
                          {addon.isEnabled ? 'Activo' : 'Desactivado'}
                        </span>
                      </div>

                      <p className="mt-2 text-xs text-gray-300">{addon.description}</p>

                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {addon.resources.map((res, idx) => {
                          const rName = typeof res === 'string' ? res : (res as any).name;
                          return (
                            <span
                              key={`${rName}-${idx}`}
                              className="rounded bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-300"
                            >
                              {rName}
                            </span>
                          );
                        })}
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between border-t border-white/10 pt-3">
                      <button
                        onClick={async () => {
                          const res = await fetch('/api/addons', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              action: 'toggle',
                              id: addon.id,
                              isEnabled: !addon.isEnabled
                            })
                          });
                          const data = await res.json();
                          setInstalledAddons(data.addons || []);
                        }}
                        className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20"
                      >
                        {addon.isEnabled ? 'Desactivar' : 'Activar'}
                      </button>

                      {!addon.isOfficial && (
                        <button
                          onClick={async () => {
                            const res = await fetch(
                              `/api/addons?id=${encodeURIComponent(addon.id)}`,
                              { method: 'DELETE' }
                            );
                            const data = await res.json();
                            setInstalledAddons(data.addons || []);
                          }}
                          className="flex items-center gap-1 rounded-lg bg-rose-500/20 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/30"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Desinstalar
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Directorio Oficial de la Comunidad Stremio en Vivo */}
            {stremioDirectory.length > 0 && (
              <div>
                <h2 className="mb-3 text-lg font-extrabold text-white">
                  Directorio Oficial de Addons de Stremio en Vivo ({stremioDirectory.length}{' '}
                  disponibles)
                </h2>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {stremioDirectory.map((dirAddon) => {
                    const alreadyInstalled = installedAddons.some(
                      (a) => a.manifestUrl === dirAddon.manifestUrl
                    );
                    return (
                      <div
                        key={dirAddon.manifestUrl}
                        className="flex flex-col justify-between rounded-2xl border border-white/10 bg-[#111520] p-4"
                      >
                        <div>
                          <div className="flex items-center justify-between">
                            <h4 className="text-sm font-bold text-white">{dirAddon.name}</h4>
                            <span className="text-[11px] text-gray-400">v{dirAddon.version}</span>
                          </div>
                          <p className="mt-1.5 line-clamp-2 text-xs text-gray-400">
                            {dirAddon.description || 'Addon del ecosistema Stremio.'}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-1">
                            {(dirAddon.resources || []).map((r: string, i: number) => (
                              <span
                                key={i}
                                className="rounded bg-purple-500/20 px-2 py-0.5 text-[10px] text-purple-300"
                              >
                                {r}
                              </span>
                            ))}
                          </div>
                        </div>
                        <button
                          disabled={alreadyInstalled}
                          onClick={() => handleInstallAddon(dirAddon.manifestUrl)}
                          className="mt-4 w-full rounded-xl bg-emerald-500/20 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-500 hover:text-black disabled:opacity-40"
                        >
                          {alreadyInstalled ? '✓ Ya instalado' : '+ Instalar desde Stremio'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* SECCIÓN 8: GESTOR DE DESCARGAS TEMPORALES Y CACHÉ DEL AGENTE LOCAL */}
        {activeSection === 'descargas' && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[#121726] p-6">
              <div>
                <h1 className="text-2xl font-black text-white">
                  Descargas Temporales y Caché Volátil (Agente Local)
                </h1>
                <p className="mt-1 text-xs text-gray-300">
                  Regla activa:{' '}
                  <strong className="text-emerald-400">
                    Cero archivos permanentes en el disco local.
                  </strong>{' '}
                  Todos los buffers y descargas viven exclusivamente en{' '}
                  <code>{agentStatus?.tempDir || 'os.tmpdir()'}</code> y se purgan automáticamente.
                </p>
                {agentStatus && (
                  <p className="mt-1 text-xs text-emerald-400">
                    Motor Multimedia Local: {agentStatus.ffmpegVersion || 'FFmpeg activo'} • Espacio
                    temporal usado: {(agentStatus.tempUsedBytes / (1024 * 1024)).toFixed(2)} MB de{' '}
                    {Math.round(agentStatus.tempQuotaBytes / (1024 * 1024))} MB
                  </p>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    await fetch('/api/temp-downloads', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        mediaId: 'tt1254207',
                        title: 'Big Buck Bunny (1080p Español Latino)',
                        sourceUrl:
                          'https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4',
                        category: 'temp_download'
                      })
                    });
                    refreshTempDownloadsAndAgent();
                  }}
                  className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-xs font-bold text-black hover:bg-emerald-400"
                >
                  <Download className="h-4 w-4" /> Iniciar Descarga Temporal de Prueba
                </button>

                <button
                  onClick={async () => {
                    await fetch('/api/temp-downloads', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ action: 'purge-all' })
                    });
                    refreshTempDownloadsAndAgent();
                  }}
                  className="flex items-center gap-2 rounded-xl bg-rose-500/20 px-4 py-2.5 text-xs font-bold text-rose-300 hover:bg-rose-500/30"
                >
                  <Trash2 className="h-4 w-4" /> Purgar Todos los Temporales Ahora
                </button>
              </div>
            </div>

            {tempDownloads.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-[#121623] p-8 text-center text-sm text-gray-400">
                No hay descargas temporales activas. Puedes iniciar una desde cualquier fuente en el
                reproductor o con el botón superior.
              </div>
            ) : (
              <div className="space-y-3">
                {tempDownloads.map((dl) => (
                  <div
                    key={dl.id}
                    className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-[#131826] p-4"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase text-emerald-300">
                          {dl.category === 'temp_download' ? 'Descarga Temporal' : 'Caché Stream'}
                        </span>
                        <h3 className="text-sm font-bold text-white">{dl.title}</h3>
                        <span className="text-xs text-emerald-400">({dl.status})</span>
                      </div>

                      <div className="mt-2 h-2 w-full max-w-xl overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full bg-emerald-500 transition-all"
                          style={{ width: `${dl.progressPct}%` }}
                        />
                      </div>

                      <p className="mt-1 text-xs text-gray-400">
                        {(dl.bytesDownloaded / (1024 * 1024)).toFixed(2)} MB /{' '}
                        {dl.totalBytes
                          ? `${(dl.totalBytes / (1024 * 1024)).toFixed(2)} MB`
                          : 'Calculando'}{' '}
                        ({dl.progressPct}%) • Velocidad: {(dl.speedBps / 1024).toFixed(0)} KB/s •
                        Expira: {new Date(dl.expiresAt).toLocaleTimeString()}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {dl.bytesDownloaded > 256 * 1024 && (
                        <button
                          onClick={() =>
                            setPlayingContext({
                              meta: {
                                id: dl.mediaId,
                                type: 'movie',
                                name: `${dl.title} (Temporal)`
                              }
                            })
                          }
                          className="flex items-center gap-1.5 rounded-xl bg-emerald-500 px-3.5 py-2 text-xs font-bold text-black hover:bg-emerald-400"
                        >
                          <Play className="h-3.5 w-3.5 fill-black" /> Reproducir mientras descarga
                        </button>
                      )}

                      {dl.status === 'downloading' ? (
                        <button
                          onClick={async () => {
                            await fetch('/api/temp-downloads', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ action: 'pause', id: dl.id })
                            });
                            refreshTempDownloadsAndAgent();
                          }}
                          className="rounded-xl bg-white/10 px-3 py-2 text-xs text-white hover:bg-white/20"
                        >
                          Pausar
                        </button>
                      ) : dl.status === 'paused' ? (
                        <button
                          onClick={async () => {
                            await fetch('/api/temp-downloads', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                id: dl.id,
                                mediaId: dl.mediaId,
                                title: dl.title,
                                sourceUrl: dl.sourceUrl
                              })
                            });
                            refreshTempDownloadsAndAgent();
                          }}
                          className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-bold text-black hover:bg-emerald-400"
                        >
                          Reanudar
                        </button>
                      ) : null}

                      <button
                        onClick={async () => {
                          await fetch(`/api/temp-downloads?id=${encodeURIComponent(dl.id)}`, {
                            method: 'DELETE'
                          });
                          refreshTempDownloadsAndAgent();
                        }}
                        className="rounded-xl bg-rose-500/20 p-2 text-rose-300 hover:bg-rose-500/30"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

            {/* SECCIÓN 9: PERFILES DE CUENTA Y PREFERENCIAS DE IDIOMA */}
        {activeSection === 'perfiles' && (
          <div className="space-y-8">
            {!account || activeProfile?.isGuest ? (
              <div className="rounded-2xl border border-emerald-500/30 bg-[#121726] p-8 text-center">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/20 text-2xl">
                  👤
                </div>
                <h1 className="text-2xl font-black text-white">
                  Estás navegando en Modo Invitado (Sin Sesión)
                </h1>
                <p className="mx-auto mt-2 max-w-xl text-xs text-gray-300">
                  Cuando usas Ratatube sin iniciar sesión, no se guarda ningún historial, progreso de
                  reproducción ni datos personales. Inicia sesión o crea una cuenta con tu email y
                  contraseña para guardar tu historial, continuar viendo donde lo dejaste y precargar
                  tus configuraciones de idioma y subtítulos.
                </p>
                <div className="mt-5 flex justify-center gap-3">
                  <button
                    onClick={() => {
                      setAuthMode('login');
                      setAuthError(null);
                      setShowAuthModal(true);
                    }}
                    className="flex items-center gap-2 rounded-xl bg-emerald-500 px-5 py-2.5 text-xs font-black text-black hover:bg-emerald-400"
                  >
                    <LogIn className="h-4 w-4" /> Iniciar Sesión
                  </button>
                  <button
                    onClick={() => {
                      setAuthMode('register');
                      setAuthError(null);
                      setShowAuthModal(true);
                    }}
                    className="flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-5 py-2.5 text-xs font-bold text-white hover:bg-white/20"
                  >
                    <UserPlus className="h-4 w-4" /> Crear Cuenta Nueva
                  </button>
                </div>
              </div>
            ) : (
              <>
            <div className="rounded-2xl border border-white/10 bg-[#121726] p-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-black text-white">
                    Perfiles de tu Cuenta ({account?.familyName})
                  </h1>
                  <p className="text-xs text-gray-300">
                    Cuenta: <strong className="text-emerald-300">{account?.email}</strong> • Cada
                    perfil conserva su propio historial, favoritos, continuar viendo y orden de
                    idiomas.
                  </p>
                </div>
                <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-xs">
                  Código de cuenta:{' '}
                  <strong className="font-mono text-emerald-300">{account?.inviteCode}</strong>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {profiles.map((prof) => {
                  const isCurrent = activeProfile?.id === prof.id;
                  return (
                    <div
                      key={prof.id}
                      className={`flex flex-col justify-between rounded-2xl border p-5 transition ${
                        isCurrent
                          ? 'border-emerald-500 bg-emerald-500/10'
                          : 'border-white/10 bg-[#151b2b]'
                      }`}
                    >
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="text-4xl">{prof.avatar}</span>
                          {prof.isKid ? (
                            <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">
                              Perfil Infantil (Filtro PG)
                            </span>
                          ) : prof.isAdmin ? (
                            <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">
                              Principal
                            </span>
                          ) : (
                            <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[11px] text-gray-300">
                              Estándar ({prof.maxAgeRating})
                            </span>
                          )}
                        </div>

                        <h3 className="mt-3 text-base font-extrabold text-white">{prof.name}</h3>
                        <p className="mt-1 text-xs text-gray-400">
                          Orden de Idiomas:{' '}
                          <span className="text-emerald-300">
                            {prof.languagePriority.join(' → ')}
                          </span>
                        </p>
                      </div>

                      <div className="mt-4 flex items-center gap-2">
                        <button
                          onClick={() => {
                            setActiveProfile(prof);
                            persistSessionToBrowser(account, profiles, prof);
                          }}
                          className={`flex-1 rounded-xl py-2 text-xs font-bold transition ${
                            isCurrent
                              ? 'bg-emerald-500 text-black'
                              : 'bg-white/10 text-white hover:bg-white/20'
                          }`}
                        >
                          {isCurrent ? '✓ Perfil Activo' : 'Cambiar a este perfil'}
                        </button>

                        {!prof.isAdmin && (
                          <button
                            onClick={async () => {
                              const res = await fetch(
                                `/api/profiles?id=${encodeURIComponent(prof.id)}`,
                                { method: 'DELETE' }
                              );
                              const data = await res.json();
                              if (data.profiles) {
                                const myProfs = data.profiles.filter(
                                  (p: FamilyProfile) => p.accountId === account.id
                                );
                                setProfiles(myProfs);
                                const nextActive =
                                  activeProfile?.id === prof.id ? myProfs[0] : activeProfile;
                                setActiveProfile(nextActive);
                                persistSessionToBrowser(account, myProfs, nextActive);
                              }
                            }}
                            className="rounded-xl bg-rose-500/20 p-2 text-rose-300 hover:bg-rose-500/30"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Crear nuevo perfil adicional en la cuenta */}
            <div className="rounded-2xl border border-white/10 bg-[#121726] p-6">
              <h2 className="text-lg font-extrabold text-white">Crear Nuevo Perfil en tu Cuenta</h2>
              <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-4">
                <input
                  type="text"
                  value={newProfileName}
                  onChange={(e) => setNewProfileName(e.target.value)}
                  placeholder="Nombre del perfil (ej. María)"
                  className="rounded-xl border border-white/15 bg-black px-3.5 py-2.5 text-xs text-white"
                />

                <select
                  value={newProfileAvatar}
                  onChange={(e) => setNewProfileAvatar(e.target.value)}
                  className="rounded-xl border border-white/15 bg-black px-3.5 py-2.5 text-xs text-white"
                >
                  <option value="🦊">🦊 Zorro</option>
                  <option value="🐼">🐼 Panda</option>
                  <option value="🦁">🦁 León</option>
                  <option value="🚀">🚀 Astronauta</option>
                  <option value="🎮">🎮 Gamer</option>
                </select>

                <label className="flex items-center gap-2 rounded-xl border border-white/15 bg-black px-3.5 py-2.5 text-xs text-gray-200">
                  <input
                    type="checkbox"
                    checked={newProfileIsKid}
                    onChange={(e) => setNewProfileIsKid(e.target.checked)}
                    className="h-4 w-4 accent-emerald-500"
                  />
                  Perfil Infantil (Control Parental Activo)
                </label>

                <button
                  onClick={async () => {
                    if (!newProfileName.trim() || !account) return;
                    const res = await fetch('/api/profiles', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        accountId: account.id,
                        name: newProfileName.trim(),
                        avatar: newProfileAvatar,
                        isKid: newProfileIsKid
                      })
                    });
                    const data = await res.json();
                    if (data.profile) {
                      const nextProfs = [...profiles, data.profile];
                      setProfiles(nextProfs);
                      persistSessionToBrowser(account, nextProfs, activeProfile);
                      setNewProfileName('');
                    }
                  }}
                  className="rounded-xl bg-emerald-500 py-2.5 text-xs font-black text-black hover:bg-emerald-400"
                >
                  + Crear Perfil
                </button>
              </div>
            </div>

            {/* Ajustes de Cuenta y Seguridad (Contraseña, Datos y Sincronización) */}
            <div className="rounded-2xl border border-white/10 bg-[#121726] p-6 space-y-6">
              <div className="flex items-center gap-2 text-emerald-400">
                <Key className="h-5 w-5" />
                <h2 className="text-lg font-extrabold text-white">
                  Ajustes de Cuenta y Seguridad
                </h2>
              </div>

              <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                {/* Cambio de Contraseña con botón de mostrar/ocultar */}
                <div className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-300">
                    Cambiar Contraseña de la Cuenta
                  </h3>
                  <p className="text-xs text-gray-400">
                    Email de cuenta: <strong className="text-white">{account.email}</strong>
                  </p>
                  <div>
                    <label className="mb-1 block text-[11px] text-gray-300">
                      Nueva Contraseña
                    </label>
                    <div className="relative">
                      <input
                        type={showAccountPassword ? 'text' : 'password'}
                        value={accountPasswordInput}
                        onChange={(e) => setAccountPasswordInput(e.target.value)}
                        placeholder="Escribe tu nueva contraseña"
                        className="w-full rounded-xl border border-white/15 bg-black px-3.5 py-2.5 pr-10 text-xs text-white focus:border-emerald-500 focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => setShowAccountPassword(!showAccountPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-emerald-400 transition"
                        title={showAccountPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                      >
                        {showAccountPassword ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={async () => {
                      if (!accountPasswordInput.trim() || accountPasswordInput.length < 4) {
                        setAccountPasswordMsg({
                          text: 'La contraseña debe tener al menos 4 caracteres.',
                          isError: true
                        });
                        return;
                      }
                      try {
                        const res = await fetch('/api/auth', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            action: 'change-password',
                            email: account.email,
                            newPassword: accountPasswordInput.trim()
                          })
                        });
                        const data = await res.json();
                        if (res.ok) {
                          setAccountPasswordMsg({
                            text: 'Contraseña actualizada correctamente.',
                            isError: false
                          });
                          setAccountPasswordInput('');
                        } else {
                          setAccountPasswordMsg({
                            text: data.error || 'Error al actualizar contraseña.',
                            isError: true
                          });
                        }
                      } catch {
                        setAccountPasswordMsg({ text: 'Error de red.', isError: true });
                      }
                    }}
                    className="w-full rounded-xl bg-emerald-500 py-2 text-xs font-bold text-black hover:bg-emerald-400"
                  >
                    Guardar Nueva Contraseña
                  </button>

                  {accountPasswordMsg && (
                    <p
                      className={`text-xs ${
                        accountPasswordMsg.isError ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      {accountPasswordMsg.text}
                    </p>
                  )}
                </div>

                {/* Datos Personales Opcionales */}
                <div className="rounded-xl border border-white/10 bg-black/40 p-4 space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-gray-300">
                    Datos Personales (Opcionales)
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-[11px] text-gray-400">Nombre</label>
                      <input
                        type="text"
                        value={editFirstName}
                        onChange={(e) => setEditFirstName(e.target.value)}
                        placeholder="Ej. Juan"
                        className="w-full rounded-lg border border-white/10 bg-[#121623] px-3 py-1.5 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-gray-400">Apellido</label>
                      <input
                        type="text"
                        value={editLastName}
                        onChange={(e) => setEditLastName(e.target.value)}
                        placeholder="Ej. Pérez"
                        className="w-full rounded-lg border border-white/10 bg-[#121623] px-3 py-1.5 text-xs text-white"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-[11px] text-gray-400">Teléfono</label>
                      <input
                        type="tel"
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        placeholder="+54 9..."
                        className="w-full rounded-lg border border-white/10 bg-[#121623] px-3 py-1.5 text-xs text-white"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-gray-400">País</label>
                      <input
                        type="text"
                        value={editCountry}
                        onChange={(e) => setEditCountry(e.target.value)}
                        placeholder="Argentina..."
                        className="w-full rounded-lg border border-white/10 bg-[#121623] px-3 py-1.5 text-xs text-white"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-1 block text-[11px] text-gray-400">
                      Fecha de Nacimiento
                    </label>
                    <input
                      type="date"
                      value={editBirthDate}
                      onChange={(e) => setEditBirthDate(e.target.value)}
                      className="w-full rounded-lg border border-white/10 bg-[#121623] px-3 py-1.5 text-xs text-white"
                    />
                  </div>

                  <button
                    onClick={async () => {
                      try {
                        const personalInfo = {
                          firstName: editFirstName.trim(),
                          lastName: editLastName.trim(),
                          phone: editPhone.trim(),
                          country: editCountry.trim(),
                          birthDate: editBirthDate.trim()
                        };
                        const res = await fetch('/api/auth', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            action: 'update-personal-info',
                            email: account.email,
                            personalInfo
                          })
                        });
                        if (res.ok) {
                          const updatedAccount = { ...account, personalInfo };
                          setAccount(updatedAccount);
                          persistSessionToBrowser(updatedAccount, profiles, activeProfile);
                          setPersonalInfoMsg({
                            text: 'Datos guardados correctamente.',
                            isError: false
                          });
                        }
                      } catch {
                        setPersonalInfoMsg({ text: 'Error al guardar datos.', isError: true });
                      }
                    }}
                    className="w-full rounded-xl bg-white/10 py-2 text-xs font-bold text-white hover:bg-white/20"
                  >
                    Guardar Datos Personales
                  </button>

                  {personalInfoMsg && (
                    <p
                      className={`text-xs ${
                        personalInfoMsg.isError ? 'text-rose-400' : 'text-emerald-400'
                      }`}
                    >
                      {personalInfoMsg.text}
                    </p>
                  )}
                </div>
              </div>

              {/* Sincronización Multidispositivo y Código de Vinculación */}
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Cloud className="h-4 w-4 text-emerald-400" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                      Sincronización Multidispositivo (Supabase Cloud)
                    </h3>
                  </div>
                  {cloudStatus.rlsBlocked ? (
                    <span className="rounded-full bg-amber-500/20 px-2.5 py-0.5 text-[11px] font-bold text-amber-300">
                      ⚠️ RLS activo en Supabase (Bloquea otros dispositivos)
                    </span>
                  ) : (
                    <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[11px] font-bold text-emerald-300">
                      ✓ Sincronización Cloud Activa
                    </span>
                  )}
                </div>

                {cloudStatus.rlsBlocked && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 space-y-2">
                    <p>
                      <strong>¿Por qué no puedo iniciar sesión desde otro celular o computadora?</strong>
                      <br />
                      Tu base de datos Supabase tiene <em>Row Level Security (RLS)</em> activo sin
                      política de inserción, impidiendo que el servidor guarde la cuenta en la nube
                      para otros dispositivos.
                    </p>
                    <p>
                      Para solucionarlo en 1 minuto: copia el comando SQL de abajo y pégalo en el{' '}
                      <strong>SQL Editor</strong> de tu Supabase Dashboard:
                    </p>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(SUPABASE_RLS_UNLOCK_SQL);
                        setCopiedSql(true);
                        setTimeout(() => setCopiedSql(false), 3000);
                      }}
                      className="flex items-center gap-2 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-black text-black hover:bg-amber-400"
                    >
                      {copiedSql ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copiedSql ? '¡Copiado al portapapeles!' : 'Copiar comando SQL para Supabase'}
                    </button>
                  </div>
                )}

                <div className="pt-2 border-t border-white/10 space-y-2">
                  <p className="text-xs text-gray-300">
                    <strong>Código de Vinculación Directa entre Dispositivos:</strong>
                    <br />
                    Puedes vincular tu celular, tablet o televisor al instante copiando este código y
                    pegándolo en el botón "Vincular Dispositivo" de la pantalla de inicio de sesión:
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={generateSyncCode(account, profiles)}
                      className="flex-1 rounded-xl border border-white/15 bg-black px-3.5 py-2 text-xs font-mono text-gray-300 focus:outline-none select-all"
                    />
                    <button
                      onClick={() => {
                        const code = generateSyncCode(account, profiles);
                        navigator.clipboard.writeText(code);
                        setCopiedSyncCode(true);
                        setTimeout(() => setCopiedSyncCode(false), 3000);
                      }}
                      className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-xs font-black text-black hover:bg-emerald-400"
                    >
                      {copiedSyncCode ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                      {copiedSyncCode ? '¡Copiado!' : 'Copiar'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
              </>
            )}
          </div>
        )}

        {/* SECCIÓN 10: CONFIGURACIÓN CLOUD SUPABASE Y AGENTE LOCAL */}
        {activeSection === 'configuracion' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {/* Conexión Base de Datos Cloud Supabase */}
            <div className="rounded-2xl border border-white/10 bg-[#121726] p-6">
              <div className="flex items-center gap-2 text-emerald-400">
                <Cloud className="h-5 w-5" />
                <h2 className="text-lg font-extrabold text-white">
                  Base de Datos Cloud (Supabase PostgreSQL)
                </h2>
              </div>
              <p className="mt-1 text-xs text-gray-300">
                Siguiendo tu indicación, Ratatube no guarda bases de datos permanentes en el disco
                local. Conecta tu proyecto gratuito de Supabase para sincronizar perfiles, biblioteca
                y progreso en la nube.
              </p>

              <div className="mt-4 rounded-xl border border-white/10 bg-black/50 p-3 text-xs">
                Estado actual:{' '}
                {cloudStatus.connected ? (
                  <span className="font-bold text-emerald-400">
                    ● Conectado a Supabase Cloud ({cloudStatus.url})
                  </span>
                ) : (
                  <span className="font-bold text-emerald-300">
                    ● Modo Sesión en Memoria RAM (0 bytes permanentes en disco local)
                  </span>
                )}
              </div>

              <div className="mt-4 space-y-3">
                <input
                  type="text"
                  value={supabaseUrlInput}
                  onChange={(e) => setSupabaseUrlInput(e.target.value)}
                  placeholder="NEXT_PUBLIC_SUPABASE_URL (https://xyz.supabase.co)"
                  className="w-full rounded-xl border border-white/15 bg-black px-3.5 py-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                />
                <div className="relative">
                  <input
                    type={showSupabaseKey ? 'text' : 'password'}
                    value={supabaseKeyInput}
                    onChange={(e) => setSupabaseKeyInput(e.target.value)}
                    placeholder="NEXT_PUBLIC_SUPABASE_ANON_KEY"
                    className="w-full rounded-xl border border-white/15 bg-black px-3.5 py-2.5 pr-10 text-xs text-white focus:border-emerald-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSupabaseKey(!showSupabaseKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-emerald-400 transition"
                    title={showSupabaseKey ? 'Ocultar clave' : 'Ver clave'}
                  >
                    {showSupabaseKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>

                <div className="relative">
                  <input
                    type={showSupabaseServiceKey ? 'text' : 'password'}
                    value={supabaseServiceKeyInput}
                    onChange={(e) => setSupabaseServiceKeyInput(e.target.value)}
                    placeholder="SUPABASE_SERVICE_ROLE_KEY (Opcional - bypass de RLS)"
                    className="w-full rounded-xl border border-white/15 bg-black px-3.5 py-2.5 pr-10 text-xs text-white focus:border-emerald-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowSupabaseServiceKey(!showSupabaseServiceKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-emerald-400 transition"
                    title={showSupabaseServiceKey ? 'Ocultar clave de servicio' : 'Ver clave de servicio'}
                  >
                    {showSupabaseServiceKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>

                <button
                  onClick={async () => {
                    const res = await fetch('/api/profiles', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        action: 'configure-supabase',
                        url: supabaseUrlInput,
                        anonKey: supabaseKeyInput,
                        serviceRoleKey: supabaseServiceKeyInput
                      })
                    });
                    const data = await res.json();
                    if (data.cloudStatus) {
                      setCloudStatus(data.cloudStatus);
                      setConfigSavedBanner('Configuración de Supabase actualizada.');
                      setTimeout(() => setConfigSavedBanner(null), 3000);
                    }
                  }}
                  className="w-full rounded-xl bg-emerald-500 py-2.5 text-xs font-black text-black hover:bg-emerald-400"
                >
                  Conectar Proyecto Supabase
                </button>

                <div className="pt-2 border-t border-white/10">
                  <p className="text-[11px] text-gray-400 mb-2">
                    Si al iniciar sesión desde otro dispositivo indica que la cuenta no existe, ejecuta este script en el SQL Editor de tu consola Supabase:
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(SUPABASE_RLS_UNLOCK_SQL);
                      setCopiedSql(true);
                      setTimeout(() => setCopiedSql(false), 3000);
                    }}
                    className="flex items-center justify-center gap-2 w-full rounded-xl border border-white/20 bg-white/5 py-2 text-xs font-bold text-gray-200 hover:bg-white/10"
                  >
                    {copiedSql ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedSql ? '¡Comando SQL copiado!' : 'Copiar comando SQL para Supabase'}
                  </button>
                </div>

                {configSavedBanner && (
                  <p className="text-center text-xs text-emerald-400">{configSavedBanner}</p>
                )}
              </div>
            </div>

            {/* Estado del Agente Local Windows */}
            <div className="rounded-2xl border border-white/10 bg-[#121726] p-6">
              <div className="flex items-center gap-2 text-emerald-400">
                <Laptop className="h-5 w-5" />
                <h2 className="text-lg font-extrabold text-white">
                  Agente Local Windows y Prioridad de Idiomas
                </h2>
              </div>
              <p className="mt-1 text-xs text-gray-300">
                El Agente Local gestiona el remultiplexado con FFmpeg (MKV a MP4 al vuelo) y la
                carpeta temporal autolimpiable. Si el portátil se desconecta, los recursos locales
                figuran como no disponibles sin afectar a la plataforma online.
              </p>

              <div className="mt-4 space-y-2 rounded-xl border border-white/10 bg-black/50 p-4 text-xs">
                <p>
                  <strong className="text-gray-400">Equipo:</strong>{' '}
                  {agentStatus?.deviceName || 'Windows PC'}
                </p>
                <p>
                  <strong className="text-gray-400">Motor FFmpeg:</strong>{' '}
                  {agentStatus?.ffmpegVersion || 'Detectado'}
                </p>
                <p>
                  <strong className="text-gray-400">Carpeta Temporal Exclusiva:</strong>{' '}
                  <code>{agentStatus?.tempDir}</code>
                </p>
              </div>

              <div className="mt-4 flex items-center justify-between rounded-xl border border-white/10 bg-[#161c2e] p-4">
                <span className="text-xs font-bold text-white">
                  Disponibilidad del Portátil (Agente Local):
                </span>
                <button
                  onClick={() => setAgentSimulatedOnline(!agentSimulatedOnline)}
                  className={`rounded-xl px-4 py-2 text-xs font-bold ${
                    agentSimulatedOnline
                      ? 'bg-emerald-500 text-black'
                      : 'bg-rose-500 text-white'
                  }`}
                >
                  {agentSimulatedOnline
                    ? 'Conectado (Haz clic para simular desconexión)'
                    : 'Desconectado (Fuentes locales marcadas No Disponibles)'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* MODAL DE FICHA DETALLADA (PELÍCULAS, SERIES Y ANIME) */}
      {detailItem && (
        <MediaDetailModal
          item={detailItem}
          libraryEntry={libraryItems.find((l) => l.mediaId === detailItem.id)}
          onClose={() => setDetailItem(null)}
          onPlay={(meta, season, episode) => {
            setDetailItem(null);
            setPlayingContext({ meta, season, episode });
          }}
          onToggleLibrary={handleToggleLibrary}
        />
      )}

      {/* MODAL DEL REPRODUCTOR MULTIMEDIA Y SINCRONIZACIÓN DE SUBTÍTULOS */}
      {playingContext && activeProfile && (
        <VideoPlayerModal
          meta={playingContext.meta}
          season={playingContext.season}
          episode={playingContext.episode}
          initialPositionSeconds={playingContext.initialPos}
          activeProfile={activeProfile}
          agentOnline={agentSimulatedOnline}
          onClose={() => {
            setPlayingContext(null);
          }}
          onSelectEpisode={(nextSeason, nextEp) =>
            setPlayingContext({
              meta: playingContext.meta,
              season: nextSeason,
              episode: nextEp,
              initialPos: 0
            })
          }
          onProgressSaved={(entry?: WatchProgressEntry) => {
            if (!activeProfile || activeProfile.isGuest || activeProfile.id === 'guest-profile') return;
            if (entry) {
              setWatchProgress((prev) => {
                const filtered = prev.filter(
                  (p) =>
                    !(
                      p.mediaId === entry.mediaId &&
                      (p.season || 0) === (entry.season || 0) &&
                      (p.episode || 0) === (entry.episode || 0)
                    )
                );
                const next = [entry, ...filtered];
                persistSessionToBrowser(account, profiles, activeProfile, next, libraryItems);
                return next;
              });
            }
          }}
          onSubtitleStyleChange={handleUpdateSubtitleStyle}
          onTempDownloadStarted={() => {
            refreshTempDownloadsAndAgent();
          }}
        />
      )}

      {/* MODAL DE AUTENTICACIÓN: INICIAR SESIÓN / CREAR CUENTA */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-md">
          <div className="relative w-full max-w-md overflow-hidden rounded-3xl border border-white/15 bg-[#0f1320] p-6 shadow-2xl">
            <button
              onClick={() => setShowAuthModal(false)}
              className="absolute right-4 top-4 rounded-xl bg-white/10 p-2 text-gray-300 hover:bg-white/20"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="mb-5 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-400 to-teal-600 font-black text-black">
                RT
              </div>
              <div>
                <h2 className="text-lg font-black text-white">
                  {authMode === 'login'
                    ? 'Iniciar Sesión en Ratatube'
                    : authMode === 'register'
                    ? 'Crear Cuenta en Ratatube'
                    : 'Vincular con Código de Dispositivo'}
                </h2>
                <p className="text-xs text-gray-400">
                  {authMode === 'sync-code'
                    ? 'Vincula tu celular o TV al instante con tu código de acceso'
                    : 'Guarda tu historial, continuar viendo y preconfiguraciones'}
                </p>
              </div>
            </div>

            {/* Pestañas Iniciar Sesión / Crear Cuenta / Vincular Dispositivo */}
            <div className="mb-5 grid grid-cols-3 gap-1 rounded-xl bg-black/50 p-1">
              <button
                type="button"
                onClick={() => {
                  setAuthMode('login');
                  setAuthError(null);
                }}
                className={`rounded-lg py-2 text-[11px] font-bold transition ${
                  authMode === 'login'
                    ? 'bg-emerald-500 text-black shadow'
                    : 'text-gray-300 hover:text-white'
                }`}
              >
                Iniciar Sesión
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode('register');
                  setAuthError(null);
                }}
                className={`rounded-lg py-2 text-[11px] font-bold transition ${
                  authMode === 'register'
                    ? 'bg-emerald-500 text-black shadow'
                    : 'text-gray-300 hover:text-white'
                }`}
              >
                Crear Cuenta
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode('sync-code');
                  setAuthError(null);
                }}
                className={`rounded-lg py-2 text-[11px] font-bold transition ${
                  authMode === 'sync-code'
                    ? 'bg-emerald-500 text-black shadow'
                    : 'text-gray-300 hover:text-white'
                }`}
              >
                Vincular
              </button>
            </div>

            {authMode === 'sync-code' ? (
              <form onSubmit={handleAuthSubmit} className="space-y-4">
                <div>
                  <label className="mb-1 block text-xs font-bold text-gray-200">
                    Código de Vinculación Directa
                  </label>
                  <textarea
                    rows={4}
                    required
                    value={authSyncCodeInput}
                    onChange={(e) => setAuthSyncCodeInput(e.target.value)}
                    placeholder="Pega aquí el código copiado desde tu otro dispositivo (empieza con RT-...)"
                    className="w-full rounded-xl border border-white/15 bg-black px-3.5 py-2.5 font-mono text-[11px] text-white focus:border-emerald-500 focus:outline-none"
                  />
                  <p className="mt-1 text-[11px] text-gray-400">
                    Encuentra este código en tu PC o dispositivo principal ingresando a la sección{' '}
                    <strong className="text-emerald-400">Perfiles / Cuenta</strong> y copiando el
                    "Código de Vinculación".
                  </p>
                </div>

                {authError && (
                  <div className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-3.5 py-2 text-xs font-semibold text-rose-300">
                    {authError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full rounded-xl bg-emerald-500 py-3 text-xs font-black text-black shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 disabled:opacity-50"
                >
                  {authLoading ? 'Vinculando...' : 'Vincular este Dispositivo'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleAuthSubmit} className="space-y-3.5">
                <div>
                  <label className="mb-1 block text-xs font-bold text-gray-200">
                    Correo electrónico (Email) <span className="text-emerald-400">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    placeholder="tucorreo@ejemplo.com"
                    className="w-full rounded-xl border border-white/15 bg-black px-3.5 py-2.5 text-xs text-white focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-xs font-bold text-gray-200">
                    Contraseña <span className="text-emerald-400">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showAuthPassword ? 'text' : 'password'}
                      required
                      minLength={4}
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full rounded-xl border border-white/15 bg-black px-3.5 py-2.5 pr-10 text-xs text-white focus:border-emerald-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowAuthPassword(!showAuthPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 transition hover:text-emerald-400"
                      title={showAuthPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
                    >
                      {showAuthPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {authMode === 'register' && (
                  <div className="space-y-3 rounded-2xl border border-white/10 bg-black/40 p-3.5">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">
                      Datos personales (Todos opcionales)
                    </p>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="mb-1 block text-[11px] text-gray-400">
                          Nombre (opcional)
                        </label>
                        <input
                          type="text"
                          value={authFirstName}
                          onChange={(e) => setAuthFirstName(e.target.value)}
                          placeholder="Ej. Juan"
                          className="w-full rounded-lg border border-white/10 bg-[#121623] px-3 py-2 text-xs text-white"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] text-gray-400">
                          Apellido (opcional)
                        </label>
                        <input
                          type="text"
                          value={authLastName}
                          onChange={(e) => setAuthLastName(e.target.value)}
                          placeholder="Ej. Pérez"
                          className="w-full rounded-lg border border-white/10 bg-[#121623] px-3 py-2 text-xs text-white"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="mb-1 block text-[11px] text-gray-400">
                          Teléfono (opcional)
                        </label>
                        <input
                          type="tel"
                          value={authPhone}
                          onChange={(e) => setAuthPhone(e.target.value)}
                          placeholder="+54 9 11..."
                          className="w-full rounded-lg border border-white/10 bg-[#121623] px-3 py-2 text-xs text-white"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-[11px] text-gray-400">
                          País (opcional)
                        </label>
                        <input
                          type="text"
                          value={authCountry}
                          onChange={(e) => setAuthCountry(e.target.value)}
                          placeholder="Argentina, México..."
                          className="w-full rounded-lg border border-white/10 bg-[#121623] px-3 py-2 text-xs text-white"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-[11px] text-gray-400">
                        Fecha de nacimiento (opcional)
                      </label>
                      <input
                        type="date"
                        value={authBirthDate}
                        onChange={(e) => setAuthBirthDate(e.target.value)}
                        className="w-full rounded-lg border border-white/10 bg-[#121623] px-3 py-2 text-xs text-white"
                      />
                    </div>
                  </div>
                )}

                {authError && (
                  <div className="rounded-xl border border-rose-500/40 bg-rose-500/15 px-3.5 py-2 text-xs font-semibold text-rose-300">
                    {authError}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full rounded-xl bg-emerald-500 py-3 text-xs font-black text-black shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400 disabled:opacity-50"
                >
                  {authLoading
                    ? 'Procesando...'
                    : authMode === 'login'
                    ? 'Entrar a mi Cuenta'
                    : 'Crear Cuenta y Guardar Preferencias'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

