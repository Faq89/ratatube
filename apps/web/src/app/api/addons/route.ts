import { NextRequest, NextResponse } from 'next/server';
import {
  getInstalledAddons,
  installStremioAddonByUrl,
  toggleAddonEnabled,
  removeInstalledAddon
} from '@ratatube/database';
import { STREMIO_ADDONS_COLLECTION_URL, safeAddonFetchJson } from '@ratatube/addon-sdk';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const includeDirectory = searchParams.get('directory') === 'true';

  const installed = await getInstalledAddons();

  if (!includeDirectory) {
    return NextResponse.json({ addons: installed });
  }

  let directory: any[] = [];
  try {
    const rawCollection = await safeAddonFetchJson<any[]>(STREMIO_ADDONS_COLLECTION_URL, 6000);
    if (Array.isArray(rawCollection)) {
      directory = rawCollection.slice(0, 40).map((entry) => ({
        name: entry.manifest?.name || 'Addon Stremio',
        version: entry.manifest?.version || '1.0.0',
        description: entry.manifest?.description || '',
        manifestUrl: entry.transportUrl,
        logo: entry.manifest?.logo,
        types: entry.manifest?.types || [],
        resources: (entry.manifest?.resources || []).map((r: any) =>
          typeof r === 'string' ? r : r.name
        )
      }));
    }
  } catch {
    directory = [];
  }

  return NextResponse.json({
    addons: installed,
    directory
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (body.action === 'toggle') {
      await toggleAddonEnabled(body.id, Boolean(body.isEnabled));
      const addons = await getInstalledAddons();
      return NextResponse.json({ addons });
    }

    if (!body.manifestUrl) {
      return NextResponse.json({ error: 'manifestUrl es requerido' }, { status: 400 });
    }

    const installed = await installStremioAddonByUrl(body.manifestUrl);
    const addons = await getInstalledAddons();
    return NextResponse.json({ installed, addons });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || 'No se pudo instalar el manifiesto del addon.' },
      { status: 400 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ error: 'ID requerido' }, { status: 400 });
  }
  await removeInstalledAddon(id);
  const addons = await getInstalledAddons();
  return NextResponse.json({ addons });
}

