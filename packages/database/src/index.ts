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
  public lastRlsBlocked = false;
  public lastRlsError = '';

  constructor(
    rawUrl: string,
    private readonly apiKey: string,
    private readonly serviceRoleKey?: string
  ) {
    this.baseUrl = normalizeSupabaseProjectUrl(rawUrl);
  }

  private headers(prefer?: string): Record<string, string> {
    const key = (this.serviceRoleKey || '').trim() || this.apiKey;
    const h: Record<string, string> = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json'
    };
    if (prefer) h['Prefer'] = prefer;
    return h;
  }

  async select<T = any>(table: string, queryParams = ''): Promise<T[] | null> {
    const url = `${this.baseUrl}/rest/v1/${table}${queryParams ? `?${queryParams}` : ''}`;
    try {
      const res = await fetch(url, { headers: this.headers() });
      if (!res.ok) return null;
      return (await res.json()) as T[];
    } catch {
      return null;
    }
  }

  async upsert(
    table: string,
    payload: Record<string, any> | Array<Record<string, any>>,
    onConflict?: string
  ): Promise<boolean> {
    const conflictQuery = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '';
    const url = `${this.baseUrl}/rest/v1/${table}${conflictQuery}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: this.headers('resolution=merge-duplicates,return=representation'),
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        if (
          body.includes('violates row-level security policy') ||
          res.status === 401 ||
          res.status === 403
        ) {
          this.lastRlsBlocked = true;
          this.lastRlsError = `RLS activo en '${table}': se requiere ejecutar el script SQL en Supabase o configurar la Service Role Key.`;
          console.warn(`[SupabaseRestBridge] RLS bloqueó escritura en ${table}:`, body);
        } else {
          console.warn(`[SupabaseRestBridge] Error al escribir en ${table} (${res.status}):`, body);
        }
        return false;
      }
      this.lastRlsBlocked = false;
      this.lastRlsError = '';
      return true;
    } catch (err: any) {
      console.warn(`[SupabaseRestBridge] Error de red en ${table}:`, err?.message);
      return false;
    }
  }

  async deleteById(table: string, id: string): Promise<boolean> {
    const url = `${this.baseUrl}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`;
    try {
      const res = await fetch(url, {
        method: 'DELETE',
        headers: this.headers('return=minimal')
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async checkRlsStatus(): Promise<{ blocked: boolean; message: string }> {
    try {
      const url = `${this.baseUrl}/rest/v1/family_accounts`;
      const res = await fetch(url, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ id: '00000000-0000-0000-0000-000000000000' })
      });
      const text = await res.text().catch(() => '');
      if (text.includes('violates row-level security policy') || res.status === 401) {
        this.lastRlsBlocked = true;
        this.lastRlsError =
          'RLS activo en Supabase. Bloquea la inserción de cuentas de nuevos dispositivos.';
        return { blocked: true, message: this.lastRlsError };
      }
      this.lastRlsBlocked = false;
      this.lastRlsError = '';
      return { blocked: false, message: 'Escritura y lectura permitidas en Supabase.' };
    } catch {
      return { blocked: false, message: 'No se pudo verificar el estado de RLS por error de red.' };
    }
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
  supabaseServiceRoleKey: string;
  supabaseBridge: SupabaseRestBridge | null;
  seededRemote: boolean;
  lastRlsBlocked: boolean;
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
  const envAnonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    'sb_publishable_sdv8mvdHn865Svz9Jgyoqw_1MehRmn8';
  const envServiceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SECRET_KEY ||
    '';

  let supabaseBridge: SupabaseRestBridge | null = null;
  if (envUrl && envAnonKey && envUrl.startsWith('http')) {
    supabaseBridge = new SupabaseRestBridge(envUrl, envAnonKey, envServiceKey || undefined);
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
    supabaseAnonKey: envAnonKey,
    supabaseServiceRoleKey: envServiceKey,
    supabaseBridge,
    seededRemote: false,
    lastRlsBlocked: false
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

export function configureSupabaseCloud(
  url: string,
  anonKey: string,
  serviceRoleKey?: string
): {
  connected: boolean;
  url: string;
  hasServiceKey: boolean;
} {
  const store = getStore();
  const cleanUrl = normalizeSupabaseProjectUrl(url);
  const cleanKey = anonKey.trim();
  const cleanServiceKey = (serviceRoleKey || '').trim();

  if (!cleanUrl || !cleanKey) {
    store.supabaseUrl = '';
    store.supabaseAnonKey = '';
    store.supabaseServiceRoleKey = '';
    store.supabaseBridge = null;
    return { connected: false, url: '', hasServiceKey: false };
  }

  store.supabaseUrl = cleanUrl;
  store.supabaseAnonKey = cleanKey;
  store.supabaseServiceRoleKey = cleanServiceKey;
  store.supabaseBridge = new SupabaseRestBridge(cleanUrl, cleanKey, cleanServiceKey || undefined);
  store.seededRemote = false;

  return { connected: true, url: cleanUrl, hasServiceKey: Boolean(cleanServiceKey) };
}

export function getSupabaseStatus(): {
  connected: boolean;
  url: string;
  mode: 'supabase-cloud' | 'ephemeral-ram-session';
  hasServiceKey: boolean;
  rlsBlocked: boolean;
} {
  const store = getStore();
  const connected = Boolean(store.supabaseBridge && store.supabaseUrl);
  const isRls = store.supabaseBridge?.lastRlsBlocked || store.lastRlsBlocked;
  return {
    connected,
    url: store.supabaseUrl,
    mode: connected ? 'supabase-cloud' : 'ephemeral-ram-session',
    hasServiceKey: Boolean(store.supabaseServiceRoleKey),
    rlsBlocked: Boolean(isRls)
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
  cloudSyncSuccess?: boolean;
  cloudRlsBlocked?: boolean;
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
      .select('family_accounts', `email=ilike.${encodeURIComponent(cleanEmail)}&limit=1`)
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
    avatarColor: '#10b981',
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

  let cloudSyncSuccess = false;
  let cloudRlsBlocked = false;

  if (store.supabaseBridge) {
    const accOk = await store.supabaseBridge.upsert(
      'family_accounts',
      {
        id: account.id,
        email: account.email,
        family_name: account.familyName,
        password_hash: passwordHash,
        invite_code: account.inviteCode
      },
      'id'
    );

    if (accOk) {
      await store.supabaseBridge.upsert(
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
      );
      cloudSyncSuccess = true;
      store.lastRlsBlocked = false;
    } else {
      cloudRlsBlocked = store.supabaseBridge.lastRlsBlocked;
      store.lastRlsBlocked = cloudRlsBlocked;
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
    library: [],
    cloudSyncSuccess,
    cloudRlsBlocked
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
  cloudSyncSuccess?: boolean;
  cloudRlsBlocked?: boolean;
}> {
  const store = getStore();
  const cleanEmail = (input.email || '').trim().toLowerCase();
  const rawPassword = (input.password || '').trim();

  if (!cleanEmail || !rawPassword) {
    throw new Error('Ingresa tu correo electrónico y contraseña.');
  }

  const passwordHash = hashPassword(rawPassword);

  if (store.supabaseBridge) {
    let accountsData = await store.supabaseBridge
      .select('family_accounts', `email=ilike.${encodeURIComponent(cleanEmail)}&limit=1`)
      .catch(() => null);

    if (!Array.isArray(accountsData) || accountsData.length === 0) {
      accountsData = await store.supabaseBridge
        .select('family_accounts', `email=eq.${encodeURIComponent(cleanEmail)}&limit=1`)
        .catch(() => null);
    }

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

  if (store.supabaseBridge) {
    const probe = await store.supabaseBridge.checkRlsStatus().catch(() => null);
    if (probe?.blocked) {
      store.lastRlsBlocked = true;
      throw new Error(
        'No encontramos tu cuenta en Supabase Cloud. Tu base de datos tiene RLS (Row Level Security) activo, lo que impidió sincronizar las cuentas entre dispositivos. Ejecuta el script SQL en Supabase o usa tu Código de Sincronización.'
      );
    }
  }

  throw new Error('No encontramos ninguna cuenta registrada con este correo electrónico.');
}

/**
 * Sincroniza explícitamente una cuenta existente y sus perfiles hacia Supabase Cloud.
 */
export async function syncUserAccountToCloud(input: {
  account: FamilyAccount;
  profiles: FamilyProfile[];
  passwordHash?: string;
}): Promise<{
  ok: boolean;
  rlsBlocked: boolean;
  message: string;
}> {
  const store = getStore();
  if (!store.supabaseBridge) {
    return { ok: false, rlsBlocked: false, message: 'Supabase no está configurado.' };
  }

  const { account, profiles, passwordHash } = input;
  const hash =
    passwordHash ||
    store.localPasswordHashes.get(account.email.toLowerCase()) ||
    hashPassword('temporary-default-1234');

  const accOk = await store.supabaseBridge.upsert(
    'family_accounts',
    {
      id: account.id,
      email: account.email.toLowerCase(),
      family_name: account.familyName,
      password_hash: hash,
      invite_code: account.inviteCode
    },
    'id'
  );

  if (!accOk) {
    const isRls = store.supabaseBridge.lastRlsBlocked;
    return {
      ok: false,
      rlsBlocked: isRls,
      message: isRls
        ? 'RLS activo en Supabase impidió sincronizar la cuenta. Deshabilita RLS o agrega la Service Role Key.'
        : 'Error al sincronizar cuenta con Supabase.'
    };
  }

  for (const prof of profiles) {
    await store.supabaseBridge.upsert(
      'family_profiles',
      {
        id: prof.id,
        account_id: prof.accountId,
        name: prof.name,
        avatar: prof.avatar,
        avatar_color: prof.avatarColor,
        is_admin: prof.isAdmin,
        is_kid: prof.isKid,
        max_age_rating: prof.maxAgeRating,
        pin_code: prof.pinCode,
        language_priority: prof.languagePriority,
        default_language_filter: prof.defaultLanguageFilter,
        subtitle_style: buildSubtitleStylePayload(prof)
      },
      'id'
    );
  }

  store.lastRlsBlocked = false;
  return { ok: true, rlsBlocked: false, message: 'Cuenta sincronizada exitosamente con Supabase.' };
}

/**
 * Actualiza la contraseña del usuario.
 */
export async function changeUserPassword(input: {
  email: string;
  newPassword: string;
  oldPassword?: string;
}): Promise<{ success: boolean; message: string }> {
  const store = getStore();
  const cleanEmail = (input.email || '').trim().toLowerCase();
  const newPassword = (input.newPassword || '').trim();

  if (newPassword.length < 4) {
    throw new Error('La nueva contraseña debe tener al menos 4 caracteres.');
  }

  const newHash = hashPassword(newPassword);

  const currentHash = store.localPasswordHashes.get(cleanEmail);
  if (input.oldPassword && currentHash) {
    const oldHash = hashPassword(input.oldPassword.trim());
    if (oldHash !== currentHash) {
      throw new Error('La contraseña actual es incorrecta.');
    }
  }

  store.localPasswordHashes.set(cleanEmail, newHash);
  const mem = store.registeredAccounts.get(cleanEmail);
  if (mem) {
    mem.passwordHash = newHash;
  }

  if (store.supabaseBridge) {
    await store.supabaseBridge
      .upsert(
        'family_accounts',
        {
          email: cleanEmail,
          password_hash: newHash
        },
        'email'
      )
      .catch(() => false);
  }

  return { success: true, message: 'Contraseña actualizada correctamente.' };
}

/**
 * Actualiza los datos personales asociados a una cuenta.
 */
export async function updateUserPersonalInfo(input: {
  email: string;
  personalInfo: UserPersonalInfo;
}): Promise<{ success: boolean; account: FamilyAccount; profiles: FamilyProfile[] }> {
  const store = getStore();
  const cleanEmail = (input.email || '').trim().toLowerCase();
  const cleanInfo = sanitizePersonalInfo(input.personalInfo);

  const mem = store.registeredAccounts.get(cleanEmail);
  if (mem) {
    mem.account.personalInfo = cleanInfo;
    if (mem.profiles.length > 0) {
      mem.profiles[0].personalInfo = cleanInfo;
    }
  }

  if (store.account.email.toLowerCase() === cleanEmail) {
    store.account.personalInfo = cleanInfo;
    const admin =
      store.profiles.find((p) => p.accountId === store.account.id && p.isAdmin) ||
      store.profiles[0];
    if (admin) {
      admin.personalInfo = cleanInfo;
      if (store.supabaseBridge) {
        await store.supabaseBridge
          .upsert(
            'family_profiles',
            {
              id: admin.id,
              subtitle_style: buildSubtitleStylePayload(admin)
            },
            'id'
          )
          .catch(() => false);
      }
    }
  }

  return {
    success: true,
    account: mem ? mem.account : store.account,
    profiles: mem ? mem.profiles : store.profiles
  };
}

/**
 * Realiza un test en vivo para comprobar si Supabase permite inserciones o si RLS las bloquea.
 */
export async function checkSupabaseRlsProbe(): Promise<{ blocked: boolean; message: string }> {
  const store = getStore();
  if (!store.supabaseBridge) {
    return { blocked: false, message: 'Supabase no está configurado.' };
  }
  return store.supabaseBridge.checkRlsStatus();
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
