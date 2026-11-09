-- ============================================================================
-- RATATUBE HYBRID MEDIA HUB — ESQUEMA SUPABASE POSTGRESQL
-- Cero datos permanentes en disco local; sincronización multi-dispositivo y
-- aislamiento estricto por perfil familiar.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Cuentas Familiares
CREATE TABLE IF NOT EXISTS public.family_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    family_name TEXT NOT NULL DEFAULT 'Mi Familia Ratatube',
    password_hash TEXT NOT NULL,
    invite_code TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Perfiles Familiares Independientes
CREATE TABLE IF NOT EXISTS public.family_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES public.family_accounts(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    avatar TEXT NOT NULL DEFAULT '🎬',
    avatar_color TEXT NOT NULL DEFAULT '#e50914',
    is_admin BOOLEAN NOT NULL DEFAULT FALSE,
    is_kid BOOLEAN NOT NULL DEFAULT FALSE,
    max_age_rating TEXT NOT NULL DEFAULT 'ALL', -- 'ALL' | 'G' | 'PG' | 'PG-13' | 'R'
    pin_code TEXT, -- PIN opcional de 4 dígitos
    language_priority JSONB NOT NULL DEFAULT '["es-419", "es-ES", "orig-sub-es", "orig-other"]'::jsonb,
    default_language_filter TEXT NOT NULL DEFAULT 'all', -- 'es-419-only' | 'es-any' | 'sub-es' | 'original' | 'all'
    subtitle_style JSONB NOT NULL DEFAULT '{
        "fontSize": 24,
        "fontFamily": "Inter, sans-serif",
        "textColor": "#FFFFFF",
        "backgroundColor": "#000000",
        "backgroundOpacity": 0.65,
        "verticalOffsetPct": 8,
        "outlineWidth": 2,
        "outlineColor": "#000000",
        "shadow": true
    }'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Addons Stremio Instalados (Globales o por Perfil)
CREATE TABLE IF NOT EXISTS public.installed_addons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES public.family_accounts(id) ON DELETE CASCADE,
    addon_id TEXT NOT NULL,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    description TEXT,
    manifest_url TEXT NOT NULL,
    logo TEXT,
    types JSONB NOT NULL DEFAULT '["movie", "series"]'::jsonb,
    resources JSONB NOT NULL DEFAULT '["catalog", "meta", "stream", "subtitles"]'::jsonb,
    manifest_json JSONB NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    is_official BOOLEAN NOT NULL DEFAULT FALSE,
    health_status TEXT NOT NULL DEFAULT 'healthy',
    last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(account_id, manifest_url)
);

-- 4. Progreso de Reproducción ("Continuar Viendo" y Episodios Vistos por Perfil)
CREATE TABLE IF NOT EXISTS public.watch_progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.family_profiles(id) ON DELETE CASCADE,
    media_id TEXT NOT NULL, -- IMDb ID (tt...) o Kitsu ID
    media_type TEXT NOT NULL, -- 'movie' | 'series' | 'anime'
    title TEXT NOT NULL,
    poster TEXT,
    backdrop TEXT,
    season INT,
    episode INT,
    episode_title TEXT,
    position_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
    duration_seconds DOUBLE PRECISION NOT NULL DEFAULT 0,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    last_stream_info JSONB,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(profile_id, media_id, season, episode)
);

-- 5. Biblioteca Personal por Perfil (Favoritos, Pendientes, Vistos, En Seguimiento)
CREATE TABLE IF NOT EXISTS public.library_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.family_profiles(id) ON DELETE CASCADE,
    media_id TEXT NOT NULL,
    media_type TEXT NOT NULL,
    title TEXT NOT NULL,
    poster TEXT,
    year TEXT,
    imdb_rating TEXT,
    is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
    in_watchlist BOOLEAN NOT NULL DEFAULT FALSE,
    is_watched BOOLEAN NOT NULL DEFAULT FALSE,
    custom_list_name TEXT,
    added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(profile_id, media_id)
);

-- 6. Presets de Sincronización de Subtítulos (Reutilizables por Contenido/Fuente)
CREATE TABLE IF NOT EXISTS public.subtitle_sync_presets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.family_profiles(id) ON DELETE CASCADE,
    media_id TEXT NOT NULL,
    season INT NOT NULL DEFAULT 0,
    episode INT NOT NULL DEFAULT 0,
    subtitle_id TEXT NOT NULL,
    initial_offset_ms INT NOT NULL DEFAULT 0,
    drift_scale_factor DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    reference_point_ms INT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(profile_id, media_id, season, episode, subtitle_id)
);

-- 7. Estado de Agentes Locales Vinculados (Efímero / Presencia Online-Offline)
CREATE TABLE IF NOT EXISTS public.local_agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES public.family_accounts(id) ON DELETE CASCADE,
    device_name TEXT NOT NULL,
    endpoint_url TEXT NOT NULL,
    is_online BOOLEAN NOT NULL DEFAULT FALSE,
    ffmpeg_available BOOLEAN NOT NULL DEFAULT TRUE,
    temp_used_bytes BIGINT NOT NULL DEFAULT 0,
    temp_quota_bytes BIGINT NOT NULL DEFAULT 8589934592,
    last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_account ON public.family_profiles(account_id);
CREATE INDEX IF NOT EXISTS idx_progress_profile ON public.watch_progress(profile_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_library_profile ON public.library_items(profile_id, added_at DESC);
CREATE INDEX IF NOT EXISTS idx_addons_account ON public.installed_addons(account_id);

-- Permisos de acceso directo para uso personal/familiar con Publishable Key
ALTER TABLE public.family_accounts DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.installed_addons DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.watch_progress DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.library_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.subtitle_sync_presets DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.local_agents DISABLE ROW LEVEL SECURITY;

GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;


