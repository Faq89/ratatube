import { NextRequest, NextResponse } from 'next/server';
import {
  registerUserAccount,
  loginUserAccount,
  getSupabaseStatus,
  syncUserAccountToCloud,
  changeUserPassword,
  updateUserPersonalInfo,
  checkSupabaseRlsProbe
} from '@ratatube/database';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const action = body.action || 'login';

    if (action === 'register') {
      const result = await registerUserAccount({
        email: body.email || '',
        password: body.password || '',
        personalInfo: body.personalInfo
      });
      return NextResponse.json({
        ...result,
        cloudStatus: getSupabaseStatus()
      });
    }

    if (action === 'login') {
      const result = await loginUserAccount({
        email: body.email || '',
        password: body.password || '',
        vaultBackup: body.vaultBackup
      });
      return NextResponse.json({
        ...result,
        cloudStatus: getSupabaseStatus()
      });
    }

    if (action === 'sync-to-cloud') {
      const result = await syncUserAccountToCloud({
        account: body.account,
        profiles: body.profiles,
        passwordHash: body.passwordHash
      });
      return NextResponse.json({
        ...result,
        cloudStatus: getSupabaseStatus()
      });
    }

    if (action === 'change-password') {
      const result = await changeUserPassword({
        email: body.email || '',
        newPassword: body.newPassword || '',
        oldPassword: body.oldPassword
      });
      return NextResponse.json({
        ...result,
        cloudStatus: getSupabaseStatus()
      });
    }

    if (action === 'update-personal-info') {
      const result = await updateUserPersonalInfo({
        email: body.email || '',
        personalInfo: body.personalInfo || {}
      });
      return NextResponse.json({
        ...result,
        cloudStatus: getSupabaseStatus()
      });
    }

    if (action === 'check-rls') {
      const probe = await checkSupabaseRlsProbe();
      return NextResponse.json({
        ...probe,
        cloudStatus: getSupabaseStatus()
      });
    }

    return NextResponse.json({ error: 'Acción no válida' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Error de autenticación' },
      { status: 400 }
    );
  }
}
