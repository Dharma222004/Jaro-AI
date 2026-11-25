import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/security/rate-limiter';
import { getClientIp, issueSignedSessionToken, resolveRequestAuth } from '@/lib/security/auth';
import { recordSecurityAudit } from '@/lib/security/audit-logger';

export async function POST(request: NextRequest) {
  const clientIp = getClientIp(request);
  const limit = checkRateLimit({ bucket: 'auth_session', subjectKey: clientIp ?? 'local' });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many authentication requests. Try again shortly.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } },
    );
  }

  try {
    let existingAuth = null;
    try {
      existingAuth = resolveRequestAuth(request);
    } catch {
      return NextResponse.json({ error: 'Invalid session credentials.' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({})) as { legacyIdentity?: string };
    // Never accept forged acc_ tokens from request body — only upgrade legacy unsigned client UUIDs or generate a new signed token.
    const candidateBase =
      existingAuth?.authenticated && existingAuth.isSignedToken && existingAuth.identity
        ? existingAuth.identity
        : typeof body.legacyIdentity === 'string' && /^[a-zA-Z0-9_-]{10,80}$/.test(body.legacyIdentity) && !body.legacyIdentity.startsWith('acc_')
          ? body.legacyIdentity
          : undefined;

    const { token, ownerKey } = issueSignedSessionToken(candidateBase);

    await recordSecurityAudit({
      ownerKey,
      eventType: 'auth',
      action: existingAuth?.isSignedToken ? 'session_verified' : 'session_issued',
      status: 'success',
      clientIp,
    });

    const response = NextResponse.json(
      { authenticated: true, token },
      { headers: { 'Cache-Control': 'no-store' } },
    );

    response.cookies.set('jaro_session', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });

    return response;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Session initialization failed.' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
