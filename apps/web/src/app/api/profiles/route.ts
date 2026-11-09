import { NextRequest, NextResponse } from 'next/server';
import {
  getFamilyAccountAndProfiles,
  createOrUpdateProfile,
  deleteProfile,
  configureSupabaseCloud
} from '@ratatube/database';

export async function GET() {
  const data = await getFamilyAccountAndProfiles();
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    if (body.action === 'configure-supabase') {
      const status = configureSupabaseCloud(
        body.url || '',
        body.anonKey || '',
        body.serviceRoleKey || ''
      );
      const full = await getFamilyAccountAndProfiles();
      return NextResponse.json({ status, ...full });
    }

    const profile = await createOrUpdateProfile(body);
    const full = await getFamilyAccountAndProfiles();
    return NextResponse.json({ profile, ...full });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Error al guardar perfil' }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'ID requerido' }, { status: 400 });
    }
    await deleteProfile(id);
    const full = await getFamilyAccountAndProfiles();
    return NextResponse.json(full);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'No se pudo eliminar perfil' }, { status: 400 });
  }
}

