import { describe, it, expect } from 'vitest';
import {
  getFamilyAccountAndProfiles,
  createOrUpdateProfile,
  getWatchProgressForProfile,
  saveWatchProgress,
  getLibraryForProfile,
  upsertLibraryItem,
  saveSubtitleSyncPreset,
  getSubtitleSyncPreset
} from '../index';

describe('Persistencia Cloud y Aislamiento Familiar (@ratatube/database)', () => {
  it('mantiene el progreso y favoritos estrictamente aislados entre perfiles familiares', async () => {
    const { profiles } = await getFamilyAccountAndProfiles();
    expect(profiles.length).toBeGreaterThanOrEqual(3);

    const newProfile = await createOrUpdateProfile({
      name: 'Invitado Prueba',
      avatar: '🦊',
      isKid: false
    });

    await saveWatchProgress({
      profileId: newProfile.id,
      mediaId: 'tt1254207',
      mediaType: 'movie',
      title: 'Big Buck Bunny',
      positionSeconds: 120,
      durationSeconds: 600
    });

    await upsertLibraryItem({
      profileId: newProfile.id,
      mediaId: 'tt1254207',
      mediaType: 'movie',
      title: 'Big Buck Bunny',
      toggleField: 'isFavorite'
    });

    const guestProgress = await getWatchProgressForProfile(newProfile.id);
    const kidsProgress = await getWatchProgressForProfile('profile-kids');

    expect(guestProgress).toHaveLength(1);
    expect(guestProgress[0].positionSeconds).toBe(120);
    expect(kidsProgress).toHaveLength(0);

    const guestLib = await getLibraryForProfile(newProfile.id);
    expect(guestLib[0].isFavorite).toBe(true);
  });

  it('guarda y recupera presets de sincronización progresiva de subtítulos por perfil', async () => {
    await saveSubtitleSyncPreset({
      profileId: 'profile-admin',
      mediaId: 'tt1727587',
      season: 0,
      episode: 0,
      subtitleId: 'sub-es-419',
      initialOffsetMs: -250,
      driftScaleFactor: 0.95904,
      referencePointMs: 5000
    });

    const preset = await getSubtitleSyncPreset('profile-admin', 'tt1727587', 0, 0);
    expect(preset).not.toBeNull();
    expect(preset?.initialOffsetMs).toBe(-250);
    expect(preset?.driftScaleFactor).toBeCloseTo(0.95904, 5);
  });
});

