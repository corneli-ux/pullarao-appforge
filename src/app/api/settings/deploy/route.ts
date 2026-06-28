import { NextResponse } from 'next/server'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { encrypt } from '@/lib/crypto'
import { DeployProvider } from '@prisma/client'

const schema = z.object({
  provider: z.nativeEnum(DeployProvider),
  token: z.string().min(10),
  label: z.string().optional(),
  metadata: z.string().optional(),
})

export async function GET() {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const targets = await db.deployTarget.findMany({ where: { userId }, select: {
    id: true, provider: true, label: true, validatedAt: true, createdAt: true,
  }})
  return NextResponse.json({ targets })
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id

  const body = await req.json().catch(() => null)
  const parsed = schema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  const { provider, token, label, metadata } = parsed.data

  const encryptedToken = encrypt(token)
  await db.deployTarget.upsert({
    where: { userId_provider: { userId, provider } },
    update: { encryptedToken, label, metadata, validatedAt: new Date() },
    create: { userId, provider, encryptedToken, label, metadata, validatedAt: new Date() },
  })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = (session.user as any).id
  const { searchParams } = new URL(req.url)
  const provider = searchParams.get('provider') as DeployProvider
  if (!provider) return NextResponse.json({ error: 'provider required' }, { status: 400 })
  await db.deployTarget.deleteMany({ where: { userId, provider } })
  return NextResponse.json({ ok: true })
}
