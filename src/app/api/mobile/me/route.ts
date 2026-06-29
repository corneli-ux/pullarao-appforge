import { NextResponse } from 'next/server'
import { verifyMobileToken } from '../login/route'

/**
 * Returns the user associated with the bearer token, or 401.
 * The Android app calls this on launch to check if the user is still
 * signed in / if the token is still valid.
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return NextResponse.json({ error: 'No token' }, { status: 401 })

  const payload = await verifyMobileToken(token)
  if (!payload) return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })

  return NextResponse.json({
    user: { id: payload.sub, email: payload.email, name: (payload as any).name },
    expires: '90d from issue',
  })
}
