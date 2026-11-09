import { NextRequest, NextResponse } from 'next/server';
import {
  registerUserAccount,
  loginUserAccount,
  getSupabaseStatus
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

    return NextResponse.json({ error: 'Acción no válida' }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Error de autenticación' },
      { status: 400 }
    );
  }
}
