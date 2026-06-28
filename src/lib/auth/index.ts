import NextAuth from 'next-auth'
import Credentials from 'next-auth/providers/credentials'
import GitHub from 'next-auth/providers/github'
import { PrismaAdapter } from '@auth/prisma-adapter'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'

/**
 * NextAuth v5 (beta) configuration.
 * - Prisma adapter for session/account storage
 * - Credentials provider for email + password (works without external OAuth setup)
 * - GitHub OAuth provider for one-click signup (enabled when GITHUB_OAUTH_ID/SECRET are set)
 * - JWT session strategy (Edge-compatible, no DB hit per request)
 */

const githubClientId = process.env.GITHUB_OAUTH_ID
const githubClientSecret = process.env.GITHUB_OAUTH_SECRET
const githubEnabled = !!(githubClientId && githubClientSecret)

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(db),
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/login',
  },
  providers: [
    Credentials({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(creds) {
        if (!creds?.email || !creds?.password) return null
        const user = await db.user.findUnique({
          where: { email: creds.email as string },
        })
        if (!user || !user.passwordHash) return null
        const ok = await bcrypt.compare(creds.password as string, user.passwordHash)
        if (!ok) return null
        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          image: user.image ?? undefined,
        }
      },
    }),
    // GitHub OAuth — only registered when env vars are present so the app
    // still boots cleanly without OAuth setup (e.g. local dev).
    ...(githubEnabled
      ? [GitHub({ clientId: githubClientId!, clientSecret: githubClientSecret! })]
      : []),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
      }
      return token
    },
    async session({ session, token }) {
      if (session.user && token.id) {
        ;(session.user as any).id = token.id
      }
      return session
    },
  },
})

export const isGithubOAuthEnabled = githubEnabled
