import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { db } from '@/lib/db'
import { SignJWT, jwtVerify } from 'jose'

/**
 * Mobile login endpoint — the Android app POSTs email + password here,
 * we validate against the same DB NextAuth uses, and return a long-lived
 * mobile session token (JWT) the app stores locally and sends with every
 * GLM proxy call.
 *
 * Why a separate JWT (not NextAuth's session cookie):
 *  - NextAuth's session cookie is httponly + same-site=lax, hard to use
 *    from a native Android app's OkHttp client
 *  - The mobile JWT is bearer-token-style, simpler to send from Kotlin
 *  - The JWT is signed with the same AUTH_SECRET so it's verifiable
 *    in /api/mobile/me
 */

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
})

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET || 'dev-fallback-secret-32-chars-min!!!'
  return new TextEncoder().encode(secret)
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }

  const user = await db.user.findUnique({ where: { email: parsed.data.email.toLowerCase() } })
  if (!user || !user.passwordHash) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }

  const ok = await bcrypt.compare(parsed.data.password, user.passwordHash)
  if (!ok) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }

  // Issue a 90-day mobile session JWT
  const token = await new SignJWT({ sub: user.id, email: user.email, name: user.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('90d')
    .setIssuer('pullarao-appforge')
    .sign(getSecret())

  return NextResponse.json({
    token,
    user: { id: user.id, email: user.email, name: user.name, image: user.image },
  })
}

// Helper used by other endpoints to verify the mobile token
export async function verifyMobileToken(token: string): Promise<{ sub: string; email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { issuer: 'pullarao-appforge' })
    return { sub: payload.sub as string, email: payload.email as string }
  } catch {
    return null
  }
}
