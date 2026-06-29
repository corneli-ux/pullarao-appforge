import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { encrypt, decrypt } from '@/lib/crypto'
import { validateToken, listScopes } from '@/lib/github'

const schema = z.object({ pat: z.string().min(20) })

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id

  const token = await db.githubToken.findUnique({ where: { userId } })
  if (!token) return NextResponse.json({ connected: false })

  return NextResponse.json({
    connected: true,
    githubLogin: token.githubLogin,
    avatarUrl: token.avatarUrl,
    patScopes: token.patScopes,
    validatedAt: token.validatedAt,
  })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid token' }, { status: 400 })
  const { pat } = parsed.data

  // Validate by hitting /user
  let user, scopes
  try {
    user = await validateToken(pat)
    scopes = await listScopes(pat)
  } catch (e: any) {
    return NextResponse.json({ error: `Token validation failed: ${e.message}` }, { status: 400 })
  }

  // Encrypt and store
  const encryptedPat = encrypt(pat)
  await db.githubToken.upsert({
    where: { userId },
    update: {
      encryptedPat,
      patScopes: scopes.join(','),
      githubLogin: user.login,
      avatarUrl: user.avatarUrl,
      validatedAt: new Date(),
    },
    create: {
      userId,
      encryptedPat,
      patScopes: scopes.join(','),
      githubLogin: user.login,
      avatarUrl: user.avatarUrl,
      validatedAt: new Date(),
    },
  })

  return NextResponse.json({ ok: true, githubLogin: user.login, avatarUrl: user.avatarUrl, patScopes: scopes })
}

export async function DELETE() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  await db.githubToken.deleteMany({ where: { userId } })
  return NextResponse.json({ ok: true })
}
