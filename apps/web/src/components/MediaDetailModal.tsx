'use client';

import React, { useEffect, useState } from 'react';
import { LibraryEntry, StremioMetaItem } from '@ratatube/shared';
import {
  Play,
  Heart,
  Bookmark,
  CheckCircle,
  Star,
  Calendar,
  Clock,
  Globe,
  Subtitles,
  X,
  FolderPlus
} from 'lucide-react';

interface MediaDetailModalProps {
  item: StremioMetaItem;
  libraryEntry?: LibraryEntry;
  onClose: () => void;
  onPlay: (meta: StremioMetaItem, season?: number, episode?: number) => void;
  onToggleLibrary: (
    meta: StremioMetaItem,
    field: 'isFavorite' | 'inWatchlist' | 'isWatched',
    customListName?: string
  ) => void;
}

export default function MediaDetailModal({
  item,
  libraryEntry,
  onClose,
  onPlay,
  onToggleLibrary
}: MediaDetailModalProps) {
  const [fullMeta, setFullMeta] = useState<StremioMetaItem>(item);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [selectedSeason, setSelectedSeason] = useState<number>(1);
  const [customListInput, setCustomListInput] = useState(libraryEntry?.customListName || '');

  useEffect(() => {
    let cancelled = false;
    setLoadingMeta(true);
    fetch(`/api/meta?id=${encodeURIComponent(item.id)}&type=${encodeURIComponent(item.type)}`)
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.meta) {
          setFullMeta(data.meta);
          const seasons = Array.from(
            new Set<number>(
              (data.meta.videos || [])
                .map((v: any) => Number(v.season))
                .filter((s: number) => s > 0)
            )
          ).sort((a, b) => a - b);
          if (seasons.length > 0) {
            setSelectedSeason(seasons[0]);
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingMeta(false);
      });

    return () => {
      cancelled = true;
    };
  }, [item.id, item.type]);

  const isSeriesOrAnime = fullMeta.type === 'series' || fullMeta.type === 'anime';

  const seasons = isSeriesOrAnime
    ? Array.from(
        new Set(
          (fullMeta.videos || [])
            .map((v) => Number(v.season))
            .filter((s) => s > 0)
        )
      ).sort((a, b) => a - b)
    : [];

  const episodesInSeason = (fullMeta.videos || [])
    .filter((v) => Number(v.season) === selectedSeason)
    .sort((a, b) => Number(a.episode) - Number(b.episode));

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="relative max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-2xl border border-white/15 bg-[#0e131f] shadow-2xl">
        {/* Cabecera con imagen de fondo */}
        <div className="relative h-72 w-full overflow-hidden bg-[#141a29]">
          {fullMeta.background || fullMeta.poster ? (
            <img
              src={fullMeta.background || fullMeta.poster}
              alt={fullMeta.name}
              className="h-full w-full object-cover opacity-45"
            />
          ) : null}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0e131f] via-[#0e131f]/60 to-transparent" />

          <button
            onClick={onClose}
            className="absolute right-4 top-4 rounded-full bg-black/70 p-2 text-gray-200 hover:bg-emerald-500 hover:text-black transition"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="absolute bottom-4 left-6 right-6 flex items-end gap-6">
            {fullMeta.poster && (
              <img
                src={fullMeta.poster}
                alt={fullMeta.name}
                className="hidden h-44 w-32 rounded-xl border border-white/20 object-cover shadow-xl sm:block"
              />
            )}
            <div className="flex-1">
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-emerald-400">
                <span className="rounded bg-emerald-500/20 px-2 py-0.5 uppercase">
                  {fullMeta.type === 'series' ? 'Serie' : fullMeta.type === 'anime' ? 'Anime' : 'Película'}
                </span>
                {fullMeta.imdbRating && (
                  <span className="flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 text-emerald-300">
                    <Star className="h-3.5 w-3.5 fill-emerald-400" /> IMDb {fullMeta.imdbRating}
                  </span>
                )}
                {(fullMeta.year || fullMeta.releaseInfo) && (
                  <span className="flex items-center gap-1 text-gray-300">
                    <Calendar className="h-3.5 w-3.5" /> {fullMeta.year || fullMeta.releaseInfo}
                  </span>
                )}
                {fullMeta.runtime && (
                  <span className="flex items-center gap-1 text-gray-300">
                    <Clock className="h-3.5 w-3.5" /> {fullMeta.runtime}
                  </span>
                )}
              </div>

              <h2 className="mt-1 text-2xl font-extrabold text-white sm:text-3xl">
                {fullMeta.name}
              </h2>
              {fullMeta.originalName && fullMeta.originalName !== fullMeta.name && (
                <p className="text-xs text-gray-400">
                  Título original: <span className="italic">{fullMeta.originalName}</span>
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Contenido de la ficha */}
        <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-5">
            {/* Botones de Acción */}
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() =>
                  onPlay(
                    fullMeta,
                    seasons.length > 0 ? selectedSeason : undefined,
                    episodesInSeason[0]?.episode
                  )
                }
                className="flex items-center gap-2 rounded-xl bg-emerald-500 px-6 py-3 text-sm font-extrabold text-black shadow-lg shadow-emerald-500/20 transition hover:bg-emerald-400"
              >
                <Play className="h-5 w-5 fill-black" />
                {seasons.length > 0
                  ? `Reproducir T${selectedSeason}:E${episodesInSeason[0]?.episode || 1}`
                  : 'Buscar Fuentes y Reproducir'}
              </button>

              <button
                onClick={() => onToggleLibrary(fullMeta, 'isFavorite')}
                className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-xs font-semibold transition ${
                  libraryEntry?.isFavorite
                    ? 'border-rose-500 bg-rose-500/20 text-rose-300'
                    : 'border-white/15 bg-white/5 text-gray-200 hover:bg-white/10'
                }`}
              >
                <Heart className="h-4 w-4" />
                {libraryEntry?.isFavorite ? 'En Favoritos' : 'Favorito'}
              </button>

              <button
                onClick={() => onToggleLibrary(fullMeta, 'inWatchlist')}
                className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-xs font-semibold transition ${
                  libraryEntry?.inWatchlist
                    ? 'border-sky-500 bg-sky-500/20 text-sky-300'
                    : 'border-white/15 bg-white/5 text-gray-200 hover:bg-white/10'
                }`}
              >
                <Bookmark className="h-4 w-4" />
                {libraryEntry?.inWatchlist ? 'En Pendientes' : 'Pendientes'}
              </button>

              <button
                onClick={() => onToggleLibrary(fullMeta, 'isWatched')}
                className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-xs font-semibold transition ${
                  libraryEntry?.isWatched
                    ? 'border-emerald-500 bg-emerald-500/20 text-emerald-300'
                    : 'border-white/15 bg-white/5 text-gray-200 hover:bg-white/10'
                }`}
              >
                <CheckCircle className="h-4 w-4" />
                {libraryEntry?.isWatched ? 'Visto' : 'Marcar Visto'}
              </button>
            </div>

            {/* Sinopsis */}
            <div>
              <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-gray-400">
                Sinopsis
              </h3>
              <p className="text-sm leading-relaxed text-gray-200">
                {fullMeta.description || 'Sin descripción disponible en el proveedor.'}
              </p>
            </div>

            {/* Selector de Temporadas y Episodios (Para Series y Anime) */}
            {seasons.length > 0 && (
              <div className="rounded-xl border border-white/10 bg-[#141926] p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-white">
                    Temporadas y Episodios ({seasons.length} temporadas)
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {seasons.map((s) => (
                      <button
                        key={s}
                        onClick={() => setSelectedSeason(s)}
                        className={`rounded-lg px-3 py-1 text-xs font-bold transition ${
                          selectedSeason === s
                            ? 'bg-emerald-500 text-black'
                            : 'bg-white/10 text-gray-300 hover:bg-white/20'
                        }`}
                      >
                        Temporada {s}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                  {episodesInSeason.map((ep) => (
                    <div
                      key={ep.id || `${ep.season}-${ep.episode}`}
                      onClick={() => onPlay(fullMeta, ep.season, ep.episode)}
                      className="flex cursor-pointer items-center justify-between rounded-lg border border-white/5 bg-black/40 p-2.5 transition hover:border-emerald-500/50 hover:bg-emerald-500/10"
                    >
                      <div className="pr-3">
                        <p className="text-xs font-bold text-white">
                          Episodio {ep.episode}: {ep.name || ep.title || `Capítulo ${ep.episode}`}
                        </p>
                        {(ep.overview || ep.description) && (
                          <p className="line-clamp-1 text-[11px] text-gray-400">
                            {ep.overview || ep.description}
                          </p>
                        )}
                      </div>
                      <span className="flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1 text-[11px] font-bold text-black">
                        <Play className="h-3 w-3 fill-black" /> Ver
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Columna Derecha: Metadatos Técnicos, Reparto, Director, Idiomas, Lista Personal */}
          <div className="space-y-4 rounded-xl border border-white/10 bg-[#141926] p-4 text-xs">
            <div>
              <span className="font-bold text-gray-400">Géneros:</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {(fullMeta.genres || ['General']).map((g) => (
                  <span
                    key={g}
                    className="rounded-md bg-white/10 px-2 py-0.5 text-[11px] text-gray-200"
                  >
                    {g}
                  </span>
                ))}
              </div>
            </div>

            {fullMeta.director && fullMeta.director.length > 0 && (
              <div>
                <span className="font-bold text-gray-400">Director:</span>
                <p className="mt-0.5 text-gray-200">{fullMeta.director.join(', ')}</p>
              </div>
            )}

            {fullMeta.cast && fullMeta.cast.length > 0 && (
              <div>
                <span className="font-bold text-gray-400">Reparto Principal:</span>
                <p className="mt-0.5 text-gray-200">{fullMeta.cast.slice(0, 8).join(', ')}</p>
              </div>
            )}

            <div>
              <span className="flex items-center gap-1 font-bold text-gray-400">
                <Globe className="h-3.5 w-3.5 text-emerald-400" /> Idiomas Priorizados:
              </span>
              <p className="mt-0.5 text-emerald-300">
                1º Español Latino (es-419) • 2º Castellano (es-ES) • 3º Original + Sub ES
              </p>
            </div>

            <div>
              <span className="flex items-center gap-1 font-bold text-gray-400">
                <Subtitles className="h-3.5 w-3.5 text-emerald-400" /> Subtítulos Disponibles:
              </span>
              <p className="mt-0.5 text-gray-200">
                SRT, VTT, ASS, SSA (OpenSubtitles v3 + Carga Externa + Sync Progresiva)
              </p>
            </div>

            {/* Agregar a Lista Personalizada */}
            <div className="border-t border-white/10 pt-3">
              <label className="mb-1.5 flex items-center gap-1 font-bold text-gray-300">
                <FolderPlus className="h-3.5 w-3.5 text-emerald-400" /> Lista Personal del Perfil:
              </label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={customListInput}
                  onChange={(e) => setCustomListInput(e.target.value)}
                  placeholder="Ej. Maratón Fin de Semana"
                  className="flex-1 rounded-lg border border-white/10 bg-black px-2.5 py-1.5 text-xs text-white"
                />
                <button
                  onClick={() =>
                    onToggleLibrary(fullMeta, 'inWatchlist', customListInput.trim() || undefined)
                  }
                  className="rounded-lg bg-emerald-500 px-3 py-1.5 font-bold text-black hover:bg-emerald-400"
                >
                  Guardar
                </button>
              </div>
            </div>

            {loadingMeta && (
              <p className="text-[11px] text-emerald-400">
                Consultando metadatos completos en Cinemeta / Kitsu...
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

