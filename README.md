# Pullarao AppForge

> Multi-user SaaS platform that builds apps with **Pullarao 1** (the open-source GLM 5.2 model), pushes them to your GitHub, and deploys to your hosting — all using your own tokens.

## What this is

Users sign up, describe an app in natural language, and Pullarao 1 generates a complete, buildable project. The platform then:

1. Pushes the generated code to a new repo in **the user's own GitHub** (via their PAT)
2. Triggers **GitHub Actions** on that repo to compile / build the app (CI workflow ships with every generated project)
3. Deploys web apps to **Vercel / Netlify / Cloudflare Pages** (via the user's deploy token)

All third-party tokens (GitHub PATs, deploy-provider tokens) are AES-256-GCM encrypted at rest.

## Tech stack

- **Next.js 16** (App Router) + **TypeScript 5**
- **Tailwind CSS 4** + **shadcn/ui**
- **Prisma 6** + SQLite
- **NextAuth v5** (credentials + optional GitHub OAuth)
- **z-ai-web-dev-sdk** → talks to Pullarao 1 (GLM 5.2)
- **bcryptjs** for password hashing
- **Zod** for schema validation
- **Sonner** for toasts

## Architecture

```
src/
├── app/
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts    # NextAuth handler
│   │   ├── auth/register/route.ts         # POST /api/auth/register
│   │   ├── auth/status/route.ts           # GET — is GitHub OAuth enabled?
│   │   ├── chat/route.ts                  # SSE streaming chat with Pullarao 1
│   │   ├── projects/route.ts              # GET list, POST generate
│   │   ├── projects/[id]/route.ts         # GET single project
│   │   ├── projects/[id]/actions/route.ts # GET GitHub Actions CI status
│   │   ├── projects/push/route.ts         # POST push to GitHub
│   │   ├── projects/deploy/route.ts       # POST deploy to provider
│   │   └── settings/{github,deploy}/route.ts
│   ├── login/page.tsx                     # credentials + GitHub OAuth button
│   ├── register/page.tsx
│   ├── dashboard/page.tsx
│   ├── settings/page.tsx
│   ├── projects/new/page.tsx
│   ├── projects/[id]/page.tsx
│   └── page.tsx                            # Landing page
├── components/
│   ├── projects/project-view.tsx          # 3-tab project detail + CI badge
│   └── providers.tsx                       # SessionProvider wrapper
└── lib/
    ├── auth/index.ts                       # NextAuth config (credentials + GitHub OAuth)
    ├── crypto/index.ts                     # AES-256-GCM encrypt/decrypt
    ├── glm/index.ts                        # Pullarao 1 service (streaming + JSON + tools)
    ├── github/index.ts                     # GitHub REST client
    ├── deploy/index.ts                     # Vercel / Netlify / Cloudflare deployers
    └── templates/index.ts                  # Android / Next.js / static generators
```

## Local development

```bash
# 1. Install
bun install

# 2. Configure env
cp .env.example .env  # then edit values

# 3. Push DB schema
bun run db:push

# 4. Run
bun run dev
```

### Required env vars

```bash
DATABASE_URL=file:./db/appforge.db
AUTH_SECRET=<32-byte hex>                 # openssl rand -hex 32
NEXTAUTH_URL=http://localhost:3000
APP_ENCRYPTION_KEY=<32-byte hex>          # openssl rand -hex 32
```

### Optional env vars

```bash
# Enable GitHub OAuth (one-click signup)
GITHUB_OAUTH_ID=<github oauth app client id>
GITHUB_OAUTH_SECRET=<github oauth app client secret>
```

Without `GITHUB_OAUTH_*`, the app boots with credentials-only auth. The login/register pages detect this and hide the GitHub button automatically.

## CI

`.github/workflows/ci.yml` runs on every push to `main`:
- Bun install
- Prisma generate
- ESLint
- TypeScript type-check
- Next.js production build

The build artifact is uploaded for 7 days.

## License

MIT
