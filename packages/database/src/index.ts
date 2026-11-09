import crypto from 'crypto';
import {
  FamilyAccount,
  FamilyProfile,
  InstalledAddon,
  LibraryEntry,
  SubtitleSyncPreset,
  SubtitleVisualStyle,
  UserPersonalInfo,
  WatchProgressEntry,
  DEFAULT_LANGUAGE_PRIORITY
} from '@ratatube/shared';
import {
  getDefaultInstalledAddons,
  fetchAndValidateManifest
} from '@ratatube/addon-sdk';

export const DEFAULT_SUBTITLE_STYLE: SubtitleVisualStyle = {
  fontSize: 26,
  fontFamily: 'Inter, system-ui, sans-serif',
  textColor: '#FFFFFF',
  backgroundColor: '#000000',
  backgroundOpacity: 0.65,
  verticalOffsetPct: 8,
  outlineWidth: 2,
  outlineColor: '#000000',
  shadow: true
};

export const GUEST_ACCOUNT_ID = 'guest-account';
export const GUEST_PROFILE_ID = 'guest-profile';

export function isGuestProfileId(profileId?: string | null): boolean {
  return !profileId || profileId === GUEST_PROFILE_ID || profileId.startsWith('guest');
}

export function getGuestProfile(): FamilyProfile {
  return {
    id: GUEST_PROFILE_ID,
    accountId: GUEST_ACCOUNT_ID,
    name: 'Invitado (Sin sesión)',
    avatar: '👤',
    avatarColor: '#475569',
    isAdmin: false,
    isKid: false,
    isGuest: true,
    maxAgeRating: 'ALL',
    pinCode: null,
    languagePriority: [...DEFAULT_LANGUAGE_PRIORITY],
    defaultLanguageFilter: 'all',
    subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE },
    createdAt: new Date(0).toISOString()
  };
}

function hashPassword(password: string): string {
  return crypto
    .createHash('sha256')
    .update(`${password.trim()}::ratatube-auth-v1`)
    .digest('hex');
}

function sanitizePersonalInfo(info?: UserPersonalInfo): UserPersonalInfo | undefined {
  if (!info || typeof info !== 'object') return undefined;
  const clean: UserPersonalInfo = {};
  if (info.firstName?.trim()) clean.firstName = info.firstName.trim();
  if (info.lastName?.trim()) clean.lastName = info.lastName.trim();
  if (info.phone?.trim()) clean.phone = info.phone.trim();
  if (info.country?.trim()) clean.country = info.country.trim();
  if (info.birthDate?.trim()) clean.birthDate = info.birthDate.trim();
  return Object.keys(clean).length > 0 ? clean : undefined;
}

function extractSubtitleStyleAndPersonalInfo(rawStyle: any): {
  subtitleStyle: SubtitleVisualStyle;
  personalInfo?: UserPersonalInfo;
} {
  if (!rawStyle || typeof rawStyle !== 'object') {
    return { subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE } };
  }
  const { _personalInfo, ...styleRest } = rawStyle;
  return {
    subtitleStyle: {
      ...DEFAULT_SUBTITLE_STYLE,
      ...styleRest
    },
    personalInfo: sanitizePersonalInfo(_personalInfo)
  };
}

export function normalizeSupabaseProjectUrl(rawUrl: string): string {
  return rawUrl
    .trim()
    .replace(/\/rest\/v1\/?.*$/i, '')
    .replace(/\/+$/, '');
}

/**
 * Cliente ligero nativo para Supabase PostgREST (/rest/v1/) sobre fetch estándar.
 */
class SupabaseRestBridge {
  public readonly baseUrl: string;

  constructor(
    rawUrl: string,
    private readonly apiKey: string
  ) {
    this.baseUrl = normalizeSupabaseProjectUrl(rawUrl);
  }

  private headers(prefer?: string): Record<string, string> {
    const h: Record<string, string> = {
      apikey: this.apiKey,
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json'
    };
    if (prefer) h['Prefer'] = prefer;
    return h;
  }

  async select<T = any>(table: string, queryParams = ''): Promise<T[] | null> {
    const url = `${this.baseUrl}/rest/v1/${table}${queryParams ? `?${queryParams}` : ''}`;
    const res = await fetch(url, { headers: this.headers() });
    if (!res.ok) return null;
    return (await res.json()) as T[];
  }

  async upsert(
    table: string,
    payload: Record<string, any> | Array<Record<string, any>>,
    onConflict?: string
  ): Promise<boolean> {
    const conflictQuery = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '';
    const url = `${this.baseUrl}/rest/v1/${table}${conflictQuery}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers('resolution=merge-duplicates,return=minimal'),
      body: JSON.stringify(payload)
    });
    return res.ok;
  }

  async deleteById(table: string, id: string): Promise<boolean> {
    const url = `${this.baseUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: this.headers('return=minimal')
    });
    return res.ok;
  }
}

interface RegisteredAccountRecord {
  account: FamilyAccount;
  passwordHash: string;
  profiles: FamilyProfile[];
}

interface EphemeralMemoryStore {
  account: FamilyAccount;
  profiles: FamilyProfile[];
  addons: InstalledAddon[];
  watchProgress: WatchProgressEntry[];
  library: LibraryEntry[];
  subtitlePresets: SubtitleSyncPreset[];
  hydratedProfileIds: Set<string>;
  localPasswordHashes: Map<string, string>;
  registeredAccounts: Map<string, RegisteredAccountRecord>;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseBridge: SupabaseRestBridge | null;
  seededRemote: boolean;
}

const DEFAULT_ACCOUNT_ID = '00000000-0000-4000-8000-000000000001';
export const ADMIN_PROFILE_ID = '00000000-0000-4000-8000-000000000011';
export const FAMILY_PROFILE_ID = '00000000-0000-4000-8000-000000000012';
export const KIDS_PROFILE_ID = '00000000-0000-4000-8000-000000000013';

function createInitialStore(): EphemeralMemoryStore {
  const now = new Date().toISOString();
  const envUrl = normalizeSupabaseProjectUrl(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://aejfuovgwgweipyyexjt.supabase.co'
  );
  const envKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'sb_publishable_sdv8mvdHn865Svz9Jgyoqw_1MehRmn8';

  let supabaseBridge: SupabaseRestBridge | null = null;
  if (envUrl && envKey && envUrl.startsWith('http')) {
    supabaseBridge = new SupabaseRestBridge(envUrl, envKey);
  }

  const profiles: FamilyProfile[] = [
    {
      id: ADMIN_PROFILE_ID,
      accountId: DEFAULT_ACCOUNT_ID,
      name: 'Principal (Admin)',
      avatar: '🎬',
      avatarColor: '#e50914',
      isAdmin: true,
      isKid: false,
      maxAgeRating: 'ALL',
      pinCode: null,
      languagePriority: [...DEFAULT_LANGUAGE_PRIORITY],
      defaultLanguageFilter: 'all',
      subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE },
      createdAt: now
    },
    {
      id: FAMILY_PROFILE_ID,
      accountId: DEFAULT_ACCOUNT_ID,
      name: 'Sala Familiar',
      avatar: '🍿',
      avatarColor: '#2563eb',
      isAdmin: false,
      isKid: false,
      maxAgeRating: 'PG-13',
      pinCode: null,
      languagePriority: [...DEFAULT_LANGUAGE_PRIORITY],
      defaultLanguageFilter: 'es-any',
      subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE },
      createdAt: now
    },
    {
      id: KIDS_PROFILE_ID,
      accountId: DEFAULT_ACCOUNT_ID,
      name: 'Pequeños (Kids)',
      avatar: '🧸',
      avatarColor: '#10b981',
      isAdmin: false,
      isKid: true,
      maxAgeRating: 'PG',
      pinCode: null,
      languagePriority: ['es-419', 'es-ES', 'orig-sub-es', 'orig-other'],
      defaultLanguageFilter: 'es-any',
      subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE, fontSize: 28, textColor: '#FFEE55' },
      createdAt: now
    }
  ];

  // Estado inicial 100% limpio sin datos precargados de historial ni biblioteca
  return {
    account: {
      id: DEFAULT_ACCOUNT_ID,
      email: 'familia@ratatube.cloud',
      familyName: 'Hogar Ratatube',
      inviteCode: 'RATA-FAM-2026',
      createdAt: now
    },
    profiles,
    addons: getDefaultInstalledAddons(DEFAULT_ACCOUNT_ID),
    watchProgress: [],
    library: [],
    subtitlePresets: [],
    hydratedProfileIds: new Set<string>(),
    localPasswordHashes: new Map<string, string>(),
    registeredAccounts: new Map<string, RegisteredAccountRecord>(),
    supabaseUrl: envUrl,
    supabaseAnonKey: envKey,
    supabaseBridge,
    seededRemote: false
  };
}

const globalForStore = globalThis as unknown as { __ratatubeStore?: EphemeralMemoryStore };
if (!globalForStore.__ratatubeStore) {
  globalForStore.__ratatubeStore = createInitialStore();
}

function getStore(): EphemeralMemoryStore {
  const s = globalForStore.__ratatubeStore!;
  if (!s.registeredAccounts) s.registeredAccounts = new Map();
  if (!s.hydratedProfileIds) s.hydratedProfileIds = new Set();
  if (!s.localPasswordHashes) s.localPasswordHashes = new Map();
  return s;
}

export function configureSupabaseCloud(url: string, anonKey: string): {
  connected: boolean;
  url: string;
} {
  const store = getStore();
  const cleanUrl = normalizeSupabaseProjectUrl(url);
  const cleanKey = anonKey.trim();

  if (!cleanUrl || !cleanKey) {
    store.supabaseUrl = '';
    store.supabaseAnonKey = '';
    store.supabaseBridge = null;
    return { connected: false, url: '' };
  }

  store.supabaseUrl = cleanUrl;
  store.supabaseAnonKey = cleanKey;
  store.supabaseBridge = new SupabaseRestBridge(cleanUrl, cleanKey);
  store.seededRemote = false;

  return { connected: true, url: cleanUrl };
}

export function getSupabaseStatus(): {
  connected: boolean;
  url: string;
  mode: 'supabase-cloud' | 'ephemeral-ram-session';
} {
  const store = getStore();
  const connected = Boolean(store.supabaseBridge && store.supabaseUrl);
  return {
    connected,
    url: store.supabaseUrl,
    mode: connected ? 'supabase-cloud' : 'ephemeral-ram-session'
  };
}

/**
 * Obtiene un perfil directamente desde la memoria RAM sin realizar consultas de red a Supabase.
 * Ideal para rutas de alto tráfico (/api/catalog, /api/streams, /api/subtitles).
 */
export function getProfileFromMemory(profileId?: string | null): FamilyProfile {
  if (isGuestProfileId(profileId)) {
    return getGuestProfile();
  }
  const store = getStore();
  return store.profiles.find((p) => p.id === profileId) || getGuestProfile();
}

function mapSupabaseRowToProfile(row: any): FamilyProfile {
  const { subtitleStyle, personalInfo } = extractSubtitleStyleAndPersonalInfo(row.subtitle_style);
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    avatar: row.avatar || '🎬',
    avatarColor: row.avatar_color || '#e50914',
    isAdmin: Boolean(row.is_admin),
    isKid: Boolean(row.is_kid),
    maxAgeRating: row.max_age_rating || 'ALL',
    pinCode: row.pin_code || null,
    languagePriority: row.language_priority || DEFAULT_LANGUAGE_PRIORITY,
    defaultLanguageFilter: row.default_language_filter || 'all',
    subtitleStyle,
    personalInfo,
    createdAt: row.created_at
  };
}

function buildSubtitleStylePayload(profile: FamilyProfile): Record<string, any> {
  const cleanInfo = sanitizePersonalInfo(profile.personalInfo);
  if (cleanInfo) {
    return {
      ...profile.subtitleStyle,
      _personalInfo: cleanInfo
    };
  }
  return { ...profile.subtitleStyle };
}

/**
 * Registra una nueva cuenta de usuario con email y contraseña obligatorios,
 * más datos personales opcionales (nombre, apellido, teléfono, país, fecha de nacimiento).
 */
export async function registerUserAccount(input: {
  email: string;
  password: string;
  personalInfo?: UserPersonalInfo;
}): Promise<{
  account: FamilyAccount;
  profiles: FamilyProfile[];
  activeProfile: FamilyProfile;
  watchProgress: WatchProgressEntry[];
  library: LibraryEntry[];
}> {
  const store = getStore();
  const cleanEmail = (input.email || '').trim().toLowerCase();
  const rawPassword = (input.password || '').trim();

  if (!cleanEmail || !cleanEmail.includes('@')) {
    throw new Error('Ingresa un correo electrónico válido.');
  }
  if (rawPassword.length < 4) {
    throw new Error('La contraseña debe tener al menos 4 caracteres.');
  }

  const personalInfo = sanitizePersonalInfo(input.personalInfo);
  const fullName = [personalInfo?.firstName, personalInfo?.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  const displayName = fullName || cleanEmail.split('@')[0] || 'Mi Perfil';
  const passwordHash = hashPassword(rawPassword);

  if (store.registeredAccounts.has(cleanEmail) || store.localPasswordHashes.has(cleanEmail)) {
    throw new Error('Ya existe una cuenta registrada con ese correo electrónico. Inicia sesión.');
  }

  if (store.supabaseBridge) {
    const existing = await store.supabaseBridge
      .select('family_accounts', `email=eq.${encodeURIComponent(cleanEmail)}&limit=1`)
      .catch(() => null);
    if (Array.isArray(existing) && existing.length > 0) {
      throw new Error('Ya existe una cuenta registrada con ese correo electrónico. Inicia sesión.');
    }
  }

  const now = new Date().toISOString();
  const accountId = crypto.randomUUID();
  const profileId = crypto.randomUUID();
  const inviteCode = `RATA-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

  const account: FamilyAccount = {
    id: accountId,
    email: cleanEmail,
    familyName: fullName ? `Cuenta de ${fullName}` : `Cuenta de ${displayName}`,
    inviteCode,
    personalInfo,
    createdAt: now
  };

  const mainProfile: FamilyProfile = {
    id: profileId,
    accountId,
    name: displayName,
    avatar: '🎬',
    avatarColor: '#f59e0b',
    isAdmin: true,
    isKid: false,
    maxAgeRating: 'ALL',
    pinCode: null,
    languagePriority: [...DEFAULT_LANGUAGE_PRIORITY],
    defaultLanguageFilter: 'all',
    subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE },
    personalInfo,
    createdAt: now
  };

  if (store.supabaseBridge) {
    const accOk = await store.supabaseBridge
      .upsert(
        'family_accounts',
        {
          id: account.id,
          email: account.email,
          family_name: account.familyName,
          password_hash: passwordHash,
          invite_code: account.inviteCode
        },
        'id'
      )
      .catch(() => false);

    if (accOk) {
      await store.supabaseBridge
        .upsert(
          'family_profiles',
          {
            id: mainProfile.id,
            account_id: mainProfile.accountId,
            name: mainProfile.name,
            avatar: mainProfile.avatar,
            avatar_color: mainProfile.avatarColor,
            is_admin: mainProfile.isAdmin,
            is_kid: mainProfile.isKid,
            max_age_rating: mainProfile.maxAgeRating,
            pin_code: mainProfile.pinCode,
            language_priority: mainProfile.languagePriority,
            default_language_filter: mainProfile.defaultLanguageFilter,
            subtitle_style: buildSubtitleStylePayload(mainProfile)
          },
          'id'
        )
        .catch(() => false);
    }
  }

  store.localPasswordHashes.set(cleanEmail, passwordHash);
  store.registeredAccounts.set(cleanEmail, {
    account,
    passwordHash,
    profiles: [mainProfile]
  });
  store.account = account;
  store.profiles = [mainProfile, ...store.profiles.filter((p) => p.accountId !== account.id)];
  store.hydratedProfileIds.add(mainProfile.id);

  return {
    account,
    profiles: [mainProfile],
    activeProfile: mainProfile,
    watchProgress: [],
    library: []
  };
}

/**
 * Inicia sesión con email y contraseña, precargando en un único lote ligero
 * el perfil, las preconfiguraciones, el historial ("Continuar viendo") y la biblioteca.
 */
export async function loginUserAccount(input: {
  email: string;
  password: string;
  vaultBackup?: {
    account: FamilyAccount;
    passwordHash?: string;
    profiles: FamilyProfile[];
    watchProgress?: WatchProgressEntry[];
    library?: LibraryEntry[];
  };
}): Promise<{
  account: FamilyAccount;
  profiles: FamilyProfile[];
  activeProfile: FamilyProfile;
  watchProgress: WatchProgressEntry[];
  library: LibraryEntry[];
}> {
  const store = getStore();
  const cleanEmail = (input.email || '').trim().toLowerCase();
  const rawPassword = (input.password || '').trim();

  if (!cleanEmail || !rawPassword) {
    throw new Error('Ingresa tu correo electrónico y contraseña.');
  }

  const passwordHash = hashPassword(rawPassword);

  if (store.supabaseBridge) {
    const accountsData = await store.supabaseBridge
      .select('family_accounts', `email=eq.${encodeURIComponent(cleanEmail)}&limit=1`)
      .catch(() => null);

    if (Array.isArray(accountsData) && accountsData.length > 0) {
      const accRow = accountsData[0];
      if (
        accRow.password_hash &&
        accRow.password_hash !== 'personal-hub' &&
        accRow.password_hash !== passwordHash
      ) {
        throw new Error('La contraseña ingresada es incorrecta.');
      }

      const profilesData = await store.supabaseBridge.select(
        'family_profiles',
        `account_id=eq.${encodeURIComponent(accRow.id)}&order=created_at.asc`
      );

      let accountProfiles: FamilyProfile[] = Array.isArray(profilesData)
        ? profilesData.map(mapSupabaseRowToProfile)
        : [];

      if (accountProfiles.length === 0) {
        const fallbackProfile: FamilyProfile = {
          id: crypto.randomUUID(),
          accountId: accRow.id,
          name: cleanEmail.split('@')[0] || 'Mi Perfil',
          avatar: '🎬',
          avatarColor: '#f59e0b',
          isAdmin: true,
          isKid: false,
          maxAgeRating: 'ALL',
          pinCode: null,
          languagePriority: [...DEFAULT_LANGUAGE_PRIORITY],
          defaultLanguageFilter: 'all',
          subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE },
          createdAt: new Date().toISOString()
        };
        await store.supabaseBridge
          .upsert(
            'family_profiles',
            {
              id: fallbackProfile.id,
              account_id: fallbackProfile.accountId,
              name: fallbackProfile.name,
              avatar: fallbackProfile.avatar,
              avatar_color: fallbackProfile.avatarColor,
              is_admin: fallbackProfile.isAdmin,
              is_kid: fallbackProfile.isKid,
              max_age_rating: fallbackProfile.maxAgeRating,
              pin_code: fallbackProfile.pinCode,
              language_priority: fallbackProfile.languagePriority,
              default_language_filter: fallbackProfile.defaultLanguageFilter,
              subtitle_style: buildSubtitleStylePayload(fallbackProfile)
            },
            'id'
          )
          .catch(() => false);
        accountProfiles = [fallbackProfile];
      }

      const activeProfile = accountProfiles[0];
      const [progressRows, libraryRows, presetRows] = await Promise.all([
        store.supabaseBridge.select(
          'watch_progress',
          `profile_id=eq.${encodeURIComponent(activeProfile.id)}&order=updated_at.desc&limit=30`
        ),
        store.supabaseBridge.select(
          'library_items',
          `profile_id=eq.${encodeURIComponent(activeProfile.id)}&order=added_at.desc&limit=50`
        ),
        store.supabaseBridge.select(
          'subtitle_sync_presets',
          `profile_id=eq.${encodeURIComponent(activeProfile.id)}&limit=50`
        )
      ]);

      const watchProgress: WatchProgressEntry[] = Array.isArray(progressRows)
        ? progressRows.map((r: any) => ({
            id: r.id,
            profileId: r.profile_id,
            mediaId: r.media_id,
            mediaType: r.media_type || 'movie',
            title: r.title,
            poster: r.poster,
            backdrop: r.backdrop,
            season: r.season || undefined,
            episode: r.episode || undefined,
            episodeTitle: r.episode_title || undefined,
            positionSeconds: Number(r.position_seconds || 0),
            durationSeconds: Number(r.duration_seconds || 0),
            completed: Boolean(r.completed),
            lastStreamInfo: r.last_stream_info || undefined,
            updatedAt: r.updated_at
          }))
        : [];

      const library: LibraryEntry[] = Array.isArray(libraryRows)
        ? libraryRows.map((r: any) => ({
            id: r.id,
            profileId: r.profile_id,
            mediaId: r.media_id,
            mediaType: r.media_type || 'movie',
            title: r.title,
            poster: r.poster,
            year: r.year,
            imdbRating: r.imdb_rating,
            isFavorite: Boolean(r.is_favorite),
            inWatchlist: Boolean(r.in_watchlist),
            isWatched: Boolean(r.is_watched),
            customListName: r.custom_list_name || null,
            addedAt: r.added_at
          }))
        : [];

      if (Array.isArray(presetRows)) {
        const mappedPresets: SubtitleSyncPreset[] = presetRows.map((r: any) => ({
          id: r.id,
          profileId: r.profile_id,
          mediaId: r.media_id,
          season: Number(r.season || 0),
          episode: Number(r.episode || 0),
          subtitleId: r.subtitle_id || 'default',
          initialOffsetMs: Number(r.initial_offset_ms || 0),
          driftScaleFactor: Number(r.drift_scale_factor || 1.0),
          referencePointMs: Number(r.reference_point_ms || 0),
          updatedAt: r.updated_at
        }));
        store.subtitlePresets = [
          ...mappedPresets,
          ...store.subtitlePresets.filter((p) => p.profileId !== activeProfile.id)
        ];
      }

      const account: FamilyAccount = {
        id: accRow.id,
        email: accRow.email,
        familyName: accRow.family_name || `Cuenta de ${activeProfile.name}`,
        inviteCode: accRow.invite_code || 'RATA-USER',
        personalInfo: activeProfile.personalInfo,
        createdAt: accRow.created_at
      };

      store.registeredAccounts.set(cleanEmail, {
        account,
        passwordHash,
        profiles: accountProfiles
      });
      store.account = account;
      store.profiles = [
        ...accountProfiles,
        ...store.profiles.filter((p) => p.accountId !== account.id)
      ];
      store.watchProgress = [
        ...watchProgress,
        ...store.watchProgress.filter((w) => w.profileId !== activeProfile.id)
      ];
      store.library = [
        ...library,
        ...store.library.filter((l) => l.profileId !== activeProfile.id)
      ];
      store.hydratedProfileIds.add(activeProfile.id);

      return {
        account,
        profiles: accountProfiles,
        activeProfile,
        watchProgress,
        library
      };
    }
  }

  // Respaldo en memoria del servidor (cuando RLS de Supabase aún no fue deshabilitado o en modo RAM)
  const memAccount = store.registeredAccounts.get(cleanEmail);
  if (memAccount) {
    if (memAccount.passwordHash !== passwordHash) {
      throw new Error('La contraseña ingresada es incorrecta.');
    }
    const activeProfile =
      store.profiles.find((p) => p.accountId === memAccount.account.id) || memAccount.profiles[0];
    const myProfiles = store.profiles.filter((p) => p.accountId === memAccount.account.id);
    const profilesList = myProfiles.length > 0 ? myProfiles : memAccount.profiles;
    return {
      account: memAccount.account,
      profiles: profilesList,
      activeProfile,
      watchProgress: store.watchProgress
        .filter((w) => w.profileId === activeProfile.id)
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
      library: store.library.filter((l) => l.profileId === activeProfile.id)
    };
  }

  // Respaldo de bóveda de sesión ante cold-start serverless
  if (
    input.vaultBackup &&
    input.vaultBackup.account?.email?.toLowerCase() === cleanEmail &&
    Array.isArray(input.vaultBackup.profiles) &&
    input.vaultBackup.profiles.length > 0
  ) {
    if (input.vaultBackup.passwordHash && input.vaultBackup.passwordHash !== passwordHash) {
      throw new Error('La contraseña ingresada es incorrecta.');
    }
    const restoredAccount = input.vaultBackup.account;
    const restoredProfiles = input.vaultBackup.profiles;
    const activeProfile = restoredProfiles[0];
    const restoredProgress = Array.isArray(input.vaultBackup.watchProgress)
      ? input.vaultBackup.watchProgress
      : [];
    const restoredLibrary = Array.isArray(input.vaultBackup.library)
      ? input.vaultBackup.library
      : [];

    store.registeredAccounts.set(cleanEmail, {
      account: restoredAccount,
      passwordHash,
      profiles: restoredProfiles
    });
    store.profiles = [
      ...restoredProfiles,
      ...store.profiles.filter((p) => p.accountId !== restoredAccount.id)
    ];
    store.watchProgress = [
      ...restoredProgress,
      ...store.watchProgress.filter((w) => w.profileId !== activeProfile.id)
    ];
    store.library = [
      ...restoredLibrary,
      ...store.library.filter((l) => l.profileId !== activeProfile.id)
    ];
    store.hydratedProfileIds.add(activeProfile.id);

    return {
      account: restoredAccount,
      profiles: restoredProfiles,
      activeProfile,
      watchProgress: restoredProgress,
      library: restoredLibrary
    };
  }

  throw new Error('No encontramos ninguna cuenta con ese correo electrónico.');
}

export async function getFamilyAccountAndProfiles(): Promise<{
  account: FamilyAccount;
  profiles: FamilyProfile[];
  cloudStatus: ReturnType<typeof getSupabaseStatus>;
}> {
  const store = getStore();

  if (store.supabaseBridge) {
    try {
      const profilesData = await store.supabaseBridge.select(
        'family_profiles',
        `account_id=eq.${encodeURIComponent(store.account.id)}&order=created_at.asc`
      );

      if (Array.isArray(profilesData) && profilesData.length > 0) {
        store.profiles = profilesData.map((row: any) => ({
          id: row.id,
          accountId: row.account_id,
          name: row.name,
          avatar: row.avatar || '🎬',
          avatarColor: row.avatar_color || '#e50914',
          isAdmin: Boolean(row.is_admin),
          isKid: Boolean(row.is_kid),
          maxAgeRating: row.max_age_rating || 'ALL',
          pinCode: row.pin_code || null,
          languagePriority: row.language_priority || DEFAULT_LANGUAGE_PRIORITY,
          defaultLanguageFilter: row.default_language_filter || 'all',
          subtitleStyle: row.subtitle_style || DEFAULT_SUBTITLE_STYLE,
          createdAt: row.created_at
        }));
        store.seededRemote = true;
      } else if (Array.isArray(profilesData) && profilesData.length === 0 && !store.seededRemote) {
        // Sembrar automáticamente la cuenta familiar y los 3 perfiles iniciales en Supabase
        const accOk = await store.supabaseBridge.upsert(
          'family_accounts',
          {
            id: store.account.id,
            email: store.account.email,
            family_name: store.account.familyName,
            password_hash: 'personal-hub',
            invite_code: store.account.inviteCode
          },
          'id'
        );
        if (accOk) {
          await store.supabaseBridge.upsert(
            'family_profiles',
            store.profiles.map((p) => ({
              id: p.id,
              account_id: p.accountId,
              name: p.name,
              avatar: p.avatar,
              avatar_color: p.avatarColor,
              is_admin: p.isAdmin,
              is_kid: p.isKid,
              max_age_rating: p.maxAgeRating,
              pin_code: p.pinCode,
              language_priority: p.languagePriority,
              default_language_filter: p.defaultLanguageFilter,
              subtitle_style: p.subtitleStyle
            })),
            'id'
          );
          store.seededRemote = true;
        }
      }
    } catch {
      // Continúa con la sesión en RAM
    }
  }

  return {
    account: store.account,
    profiles: store.profiles,
    cloudStatus: getSupabaseStatus()
  };
}

export async function createOrUpdateProfile(
  input: Partial<FamilyProfile> & { name: string }
): Promise<FamilyProfile> {
  if (input.isGuest || (input.id && isGuestProfileId(input.id))) {
    return {
      ...getGuestProfile(),
      ...input,
      id: GUEST_PROFILE_ID,
      isGuest: true
    };
  }

  const store = getStore();
  const existingIdx = input.id ? store.profiles.findIndex((p) => p.id === input.id) : -1;

  if (existingIdx >= 0) {
    const updated: FamilyProfile = {
      ...store.profiles[existingIdx],
      ...input,
      personalInfo:
        input.personalInfo !== undefined
          ? sanitizePersonalInfo(input.personalInfo)
          : store.profiles[existingIdx].personalInfo,
      subtitleStyle: {
        ...store.profiles[existingIdx].subtitleStyle,
        ...(input.subtitleStyle || {})
      }
    };
    store.profiles[existingIdx] = updated;

    if (store.supabaseBridge) {
      await store.supabaseBridge
        .upsert(
          'family_profiles',
          {
            id: updated.id,
            account_id: updated.accountId,
            name: updated.name,
            avatar: updated.avatar,
            avatar_color: updated.avatarColor,
            is_admin: updated.isAdmin,
            is_kid: updated.isKid,
            max_age_rating: updated.maxAgeRating,
            pin_code: updated.pinCode,
            language_priority: updated.languagePriority,
            default_language_filter: updated.defaultLanguageFilter,
            subtitle_style: buildSubtitleStylePayload(updated)
          },
          'id'
        )
        .catch(() => {});
    }

    return updated;
  }

  const created: FamilyProfile = {
    id: input.id && /^[0-9a-f-]{36}$/i.test(input.id) ? input.id : crypto.randomUUID(),
    accountId: input.accountId || store.account.id,
    name: input.name.trim(),
    avatar: input.avatar || '🎥',
    avatarColor: input.avatarColor || '#8b5cf6',
    isAdmin: Boolean(input.isAdmin),
    isKid: Boolean(input.isKid),
    maxAgeRating: input.isKid ? 'PG' : input.maxAgeRating || 'ALL',
    pinCode: input.pinCode || null,
    languagePriority: input.languagePriority || [...DEFAULT_LANGUAGE_PRIORITY],
    defaultLanguageFilter: input.defaultLanguageFilter || 'all',
    personalInfo: sanitizePersonalInfo(input.personalInfo),
    subtitleStyle: {
      ...DEFAULT_SUBTITLE_STYLE,
      ...(input.subtitleStyle || {})
    },
    createdAt: new Date().toISOString()
  };

  store.profiles.push(created);
  store.hydratedProfileIds.add(created.id);

  if (store.supabaseBridge) {
    await store.supabaseBridge
      .upsert(
        'family_profiles',
        {
          id: created.id,
          account_id: created.accountId,
          name: created.name,
          avatar: created.avatar,
          avatar_color: created.avatarColor,
          is_admin: created.isAdmin,
          is_kid: created.isKid,
          max_age_rating: created.maxAgeRating,
          pin_code: created.pinCode,
          language_priority: created.languagePriority,
          default_language_filter: created.defaultLanguageFilter,
          subtitle_style: buildSubtitleStylePayload(created)
        },
        'id'
      )
      .catch(() => {});
  }

  return created;
}

export async function deleteProfile(profileId: string): Promise<boolean> {
  const store = getStore();
  const target = store.profiles.find((p) => p.id === profileId);
  if (!target || target.isAdmin) {
    throw new Error('No se puede eliminar el perfil administrador principal.');
  }

  store.profiles = store.profiles.filter((p) => p.id !== profileId);
  store.watchProgress = store.watchProgress.filter((w) => w.profileId !== profileId);
  store.library = store.library.filter((l) => l.profileId !== profileId);

  if (store.supabaseBridge) {
    await store.supabaseBridge.deleteById('family_profiles', profileId).catch(() => {});
  }
  return true;
}

export async function getInstalledAddons(): Promise<InstalledAddon[]> {
  const store = getStore();
  return store.addons;
}

export async function installStremioAddonByUrl(rawManifestUrl: string): Promise<InstalledAddon> {
  const store = getStore();
  const { normalizedUrl, manifest, resources } = await fetchAndValidateManifest(rawManifestUrl);

  const existing = store.addons.find((a) => a.manifestUrl === normalizedUrl);
  if (existing) {
    existing.isEnabled = true;
    existing.version = manifest.version || existing.version;
    existing.lastCheckedAt = new Date().toISOString();
    return existing;
  }

  const created: InstalledAddon = {
    id: crypto.randomUUID(),
    accountId: store.account.id,
    addonId: manifest.id,
    name: manifest.name,
    version: manifest.version || '1.0.0',
    description: manifest.description || 'Addon compatible con Stremio SDK',
    manifestUrl: normalizedUrl,
    logo: manifest.logo,
    types: manifest.types || ['movie', 'series'],
    resources,
    manifest,
    isEnabled: true,
    isOfficial: false,
    healthStatus: 'healthy',
    lastCheckedAt: new Date().toISOString()
  };

  store.addons.push(created);

  if (store.supabaseBridge) {
    await store.supabaseBridge
      .upsert(
        'installed_addons',
        {
          id: created.id,
          account_id: created.accountId,
          addon_id: created.addonId,
          name: created.name,
          version: created.version,
          description: created.description,
          manifest_url: created.manifestUrl,
          logo: created.logo,
          types: created.types,
          resources: created.resources,
          manifest_json: created.manifest,
          is_enabled: created.isEnabled,
          is_official: created.isOfficial,
          health_status: created.healthStatus
        },
        'account_id,manifest_url'
      )
      .catch(() => {});
  }

  return created;
}

export async function toggleAddonEnabled(
  addonIdOrUrl: string,
  isEnabled: boolean
): Promise<InstalledAddon | null> {
  const store = getStore();
  const target = store.addons.find(
    (a) => a.id === addonIdOrUrl || a.addonId === addonIdOrUrl || a.manifestUrl === addonIdOrUrl
  );
  if (!target) return null;
  target.isEnabled = isEnabled;
  target.lastCheckedAt = new Date().toISOString();
  return target;
}

export async function removeInstalledAddon(addonIdOrUrl: string): Promise<boolean> {
  const store = getStore();
  store.addons = store.addons.filter(
    (a) => a.id !== addonIdOrUrl && a.addonId !== addonIdOrUrl && a.manifestUrl !== addonIdOrUrl
  );
  return true;
}

async function hydrateProfileDataIfNeeded(profileId: string): Promise<void> {
  if (
    isGuestProfileId(profileId) ||
    profileId === ADMIN_PROFILE_ID ||
    profileId === FAMILY_PROFILE_ID ||
    profileId === KIDS_PROFILE_ID
  ) {
    return;
  }
  const store = getStore();
  if (store.hydratedProfileIds.has(profileId)) {
    return;
  }
  store.hydratedProfileIds.add(profileId);
  if (!store.supabaseBridge) return;

  try {
    const [progressRows, libraryRows, presetRows] = await Promise.all([
      store.supabaseBridge.select(
        'watch_progress',
        `profile_id=eq.${encodeURIComponent(profileId)}&order=updated_at.desc&limit=30`
      ),
      store.supabaseBridge.select(
        'library_items',
        `profile_id=eq.${encodeURIComponent(profileId)}&order=added_at.desc&limit=50`
      ),
      store.supabaseBridge.select(
        'subtitle_sync_presets',
        `profile_id=eq.${encodeURIComponent(profileId)}&limit=50`
      )
    ]);

    if (Array.isArray(progressRows) && progressRows.length > 0) {
      const mappedProg: WatchProgressEntry[] = progressRows.map((r: any) => ({
        id: r.id,
        profileId: r.profile_id,
        mediaId: r.media_id,
        mediaType: r.media_type || 'movie',
        title: r.title,
        poster: r.poster,
        backdrop: r.backdrop,
        season: r.season || undefined,
        episode: r.episode || undefined,
        episodeTitle: r.episode_title || undefined,
        positionSeconds: Number(r.position_seconds || 0),
        durationSeconds: Number(r.duration_seconds || 0),
        completed: Boolean(r.completed),
        lastStreamInfo: r.last_stream_info || undefined,
        updatedAt: r.updated_at
      }));
      store.watchProgress = [
        ...mappedProg,
        ...store.watchProgress.filter((w) => w.profileId !== profileId)
      ];
    }

    if (Array.isArray(libraryRows) && libraryRows.length > 0) {
      const mappedLib: LibraryEntry[] = libraryRows.map((r: any) => ({
        id: r.id,
        profileId: r.profile_id,
        mediaId: r.media_id,
        mediaType: r.media_type || 'movie',
        title: r.title,
        poster: r.poster,
        year: r.year,
        imdbRating: r.imdb_rating,
        isFavorite: Boolean(r.is_favorite),
        inWatchlist: Boolean(r.in_watchlist),
        isWatched: Boolean(r.is_watched),
        customListName: r.custom_list_name || null,
        addedAt: r.added_at
      }));
      store.library = [
        ...mappedLib,
        ...store.library.filter((l) => l.profileId !== profileId)
      ];
    }

    if (Array.isArray(presetRows) && presetRows.length > 0) {
      const mappedPresets: SubtitleSyncPreset[] = presetRows.map((r: any) => ({
        id: r.id,
        profileId: r.profile_id,
        mediaId: r.media_id,
        season: Number(r.season || 0),
        episode: Number(r.episode || 0),
        subtitleId: r.subtitle_id || 'default',
        initialOffsetMs: Number(r.initial_offset_ms || 0),
        driftScaleFactor: Number(r.drift_scale_factor || 1.0),
        referencePointMs: Number(r.reference_point_ms || 0),
        updatedAt: r.updated_at
      }));
      store.subtitlePresets = [
        ...mappedPresets,
        ...store.subtitlePresets.filter((p) => p.profileId !== profileId)
      ];
    }
  } catch {
    // Continuar con RAM
  }
}

export async function getWatchProgressForProfile(profileId: string): Promise<WatchProgressEntry[]> {
  if (isGuestProfileId(profileId)) {
    return [];
  }
  await hydrateProfileDataIfNeeded(profileId);
  const store = getStore();
  return store.watchProgress
    .filter((w) => w.profileId === profileId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export async function saveWatchProgress(
  entry: Omit<WatchProgressEntry, 'id' | 'updatedAt' | 'completed'> & { completed?: boolean }
): Promise<WatchProgressEntry> {
  const now = new Date().toISOString();
  const completed =
    typeof entry.completed === 'boolean'
      ? entry.completed
      : entry.durationSeconds > 0 && entry.positionSeconds / entry.durationSeconds >= 0.92;

  if (isGuestProfileId(entry.profileId)) {
    // Modo Invitado: NO guardar nada ni en memoria ni en la base de datos
    return {
      id: 'guest-transient',
      ...entry,
      completed,
      updatedAt: now
    };
  }

  const store = getStore();
  const idx = store.watchProgress.findIndex(
    (w) =>
      w.profileId === entry.profileId &&
      w.mediaId === entry.mediaId &&
      (w.season || 0) === (entry.season || 0) &&
      (w.episode || 0) === (entry.episode || 0)
  );

  const record: WatchProgressEntry = {
    id: idx >= 0 ? store.watchProgress[idx].id : crypto.randomUUID(),
    ...entry,
    completed,
    updatedAt: now
  };

  if (idx >= 0) {
    store.watchProgress[idx] = record;
  } else {
    store.watchProgress.unshift(record);
  }

  if (store.supabaseBridge) {
    await store.supabaseBridge
      .upsert(
        'watch_progress',
        {
          id: record.id,
          profile_id: record.profileId,
          media_id: record.mediaId,
          media_type: record.mediaType,
          title: record.title,
          poster: record.poster,
          backdrop: record.backdrop,
          season: record.season || 0,
          episode: record.episode || 0,
          episode_title: record.episodeTitle,
          position_seconds: record.positionSeconds,
          duration_seconds: record.durationSeconds,
          completed: record.completed,
          last_stream_info: record.lastStreamInfo,
          updated_at: record.updatedAt
        },
        'profile_id,media_id,season,episode'
      )
      .catch(() => {});
  }

  return record;
}

export async function getLibraryForProfile(profileId: string): Promise<LibraryEntry[]> {
  if (isGuestProfileId(profileId)) {
    return [];
  }
  await hydrateProfileDataIfNeeded(profileId);
  const store = getStore();
  return store.library.filter((l) => l.profileId === profileId);
}

export async function upsertLibraryItem(input: {
  profileId: string;
  mediaId: string;
  mediaType: string;
  title: string;
  poster?: string;
  year?: string;
  imdbRating?: string;
  toggleField?: 'isFavorite' | 'inWatchlist' | 'isWatched';
  customListName?: string | null;
}): Promise<LibraryEntry> {
  if (isGuestProfileId(input.profileId)) {
    throw new Error('Inicia sesión en tu cuenta para guardar favoritos o listas personales.');
  }

  const store = getStore();
  const idx = store.library.findIndex(
    (l) => l.profileId === input.profileId && l.mediaId === input.mediaId
  );

  if (idx >= 0) {
    const current = store.library[idx];
    const updated: LibraryEntry = {
      ...current,
      title: input.title || current.title,
      poster: input.poster || current.poster,
      isFavorite:
        input.toggleField === 'isFavorite' ? !current.isFavorite : current.isFavorite,
      inWatchlist:
        input.toggleField === 'inWatchlist' ? !current.inWatchlist : current.inWatchlist,
      isWatched:
        input.toggleField === 'isWatched' ? !current.isWatched : current.isWatched,
      customListName:
        input.customListName !== undefined ? input.customListName : current.customListName
    };
    store.library[idx] = updated;

    if (store.supabaseBridge) {
      await store.supabaseBridge
        .upsert(
          'library_items',
          {
            id: updated.id,
            profile_id: updated.profileId,
            media_id: updated.mediaId,
            media_type: updated.mediaType,
            title: updated.title,
            poster: updated.poster,
            year: updated.year,
            imdb_rating: updated.imdbRating,
            is_favorite: updated.isFavorite,
            in_watchlist: updated.inWatchlist,
            is_watched: updated.isWatched,
            custom_list_name: updated.customListName
          },
          'profile_id,media_id'
        )
        .catch(() => {});
    }

    return updated;
  }

  const created: LibraryEntry = {
    id: crypto.randomUUID(),
    profileId: input.profileId,
    mediaId: input.mediaId,
    mediaType: input.mediaType,
    title: input.title,
    poster: input.poster,
    year: input.year,
    imdbRating: input.imdbRating,
    isFavorite: input.toggleField === 'isFavorite',
    inWatchlist: input.toggleField === 'inWatchlist',
    isWatched: input.toggleField === 'isWatched',
    customListName: input.customListName || null,
    addedAt: new Date().toISOString()
  };

  store.library.unshift(created);

  if (store.supabaseBridge) {
    await store.supabaseBridge
      .upsert(
        'library_items',
        {
          id: created.id,
          profile_id: created.profileId,
          media_id: created.mediaId,
          media_type: created.mediaType,
          title: created.title,
          poster: created.poster,
          year: created.year,
          imdb_rating: created.imdbRating,
          is_favorite: created.isFavorite,
          in_watchlist: created.inWatchlist,
          is_watched: created.isWatched,
          custom_list_name: created.customListName
        },
        'profile_id,media_id'
      )
      .catch(() => {});
  }

  return created;
}

export async function getSubtitleSyncPreset(
  profileId: string,
  mediaId: string,
  season = 0,
  episode = 0
): Promise<SubtitleSyncPreset | null> {
  if (isGuestProfileId(profileId)) {
    return null;
  }
  await hydrateProfileDataIfNeeded(profileId);
  const store = getStore();
  return (
    store.subtitlePresets.find(
      (p) =>
        p.profileId === profileId &&
        p.mediaId === mediaId &&
        p.season === season &&
        p.episode === episode
    ) || null
  );
}

export async function saveSubtitleSyncPreset(
  input: Omit<SubtitleSyncPreset, 'id' | 'updatedAt'>
): Promise<SubtitleSyncPreset> {
  if (isGuestProfileId(input.profileId)) {
    return {
      id: 'guest-preset-transient',
      ...input,
      updatedAt: new Date().toISOString()
    };
  }

  const store = getStore();
  const idx = store.subtitlePresets.findIndex(
    (p) =>
      p.profileId === input.profileId &&
      p.mediaId === input.mediaId &&
      p.season === input.season &&
      p.episode === input.episode
  );

  const record: SubtitleSyncPreset = {
    id: idx >= 0 ? store.subtitlePresets[idx].id : crypto.randomUUID(),
    ...input,
    updatedAt: new Date().toISOString()
  };

  if (idx >= 0) {
    store.subtitlePresets[idx] = record;
  } else {
    store.subtitlePresets.push(record);
  }

  if (store.supabaseBridge) {
    await store.supabaseBridge
      .upsert(
        'subtitle_sync_presets',
        {
          id: record.id,
          profile_id: record.profileId,
          media_id: record.mediaId,
          season: record.season,
          episode: record.episode,
          subtitle_id: record.subtitleId,
          initial_offset_ms: record.initialOffsetMs,
          drift_scale_factor: record.driftScaleFactor,
          reference_point_ms: record.referencePointMs,
          updated_at: record.updatedAt
        },
        'profile_id,media_id,season,episode,subtitle_id'
      )
      .catch(() => {});
  }

  return record;
}
