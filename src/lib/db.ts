import { PrismaClient } from '@prisma/client'
import { PrismaLibSQL } from '@prisma/adapter-libsql'

/**
 * Prisma client backed by Turso (libSQL) so the database works on Vercel
 * serverless.
 *
 * Per the adapter README, we pass the config object { url, authToken }
 * directly to PrismaLibSQL — it creates the libsql client internally.
 *
 * Env vars:
 *   - TURSO_DATABASE_URL: libsql://...  (the actual database URL)
 *   - TURSO_AUTH_TOKEN: eyJ...          (the database auth token)
 *   - DATABASE_URL: file:...            (placeholder for Prisma's validator)
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const tursoUrl = process.env.TURSO_DATABASE_URL
  const authToken = process.env.TURSO_AUTH_TOKEN

  if (tursoUrl) {
    const adapter = new PrismaLibSQL({ url: tursoUrl, authToken })
    return new PrismaClient({ adapter } as any)
  }

  // Local dev fallback — direct SQLite file
  return new PrismaClient({ log: ['error'] })
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
