/**
 * Create all tables on Turso (libSQL) by running the schema SQL directly.
 * Run with: TURSO_URL=... TURSO_TOKEN=... node scripts/init-turso.js
 *
 * This mirrors prisma/schema.prisma — keep in sync if you change the schema.
 */
import { createClient } from '@libsql/client'

const url = process.env.TURSO_DATABASE_URL || process.env.DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN

if (!url || !authToken) {
  console.error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN required')
  process.exit(1)
}

const client = createClient({ url, authToken })

const statements = [
  // Users
  `CREATE TABLE IF NOT EXISTS User (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    passwordHash TEXT NOT NULL,
    image TEXT,
    plan TEXT NOT NULL DEFAULT 'FREE',
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS Account (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    type TEXT NOT NULL,
    provider TEXT NOT NULL,
    providerAccountId TEXT NOT NULL,
    refresh_token TEXT,
    access_token TEXT,
    expires_at INTEGER,
    token_type TEXT,
    scope TEXT,
    id_token TEXT,
    FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE,
    UNIQUE(provider, providerAccountId)
  )`,
  `CREATE TABLE IF NOT EXISTS Session (
    id TEXT PRIMARY KEY,
    sessionToken TEXT NOT NULL UNIQUE,
    userId TEXT NOT NULL,
    expires INTEGER NOT NULL,
    FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS VerificationToken (
    identifier TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires INTEGER NOT NULL,
    UNIQUE(identifier, token)
  )`,
  // Tokens
  `CREATE TABLE IF NOT EXISTS GithubToken (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL UNIQUE,
    encryptedPat TEXT NOT NULL,
    patScopes TEXT NOT NULL,
    githubLogin TEXT,
    avatarUrl TEXT,
    validatedAt INTEGER,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS DeployTarget (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    provider TEXT NOT NULL,
    encryptedToken TEXT NOT NULL,
    metadata TEXT,
    label TEXT,
    validatedAt INTEGER,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE,
    UNIQUE(userId, provider)
  )`,
  // Projects
  `CREATE TABLE IF NOT EXISTS Project (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    appType TEXT NOT NULL,
    framework TEXT,
    status TEXT NOT NULL DEFAULT 'DRAFT',
    glmModel TEXT NOT NULL DEFAULT 'glm-5.2',
    githubRepoOwner TEXT,
    githubRepoName TEXT,
    githubRepoUrl TEXT,
    githubActionsRunId TEXT,
    deployUrl TEXT,
    lastDeployedAt INTEGER,
    generationLog TEXT,
    fileCount INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE,
    UNIQUE(userId, slug)
  )`,
  `CREATE TABLE IF NOT EXISTS ProjectFile (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL,
    path TEXT NOT NULL,
    content TEXT NOT NULL,
    language TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE,
    UNIQUE(projectId, path)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_projectfile_projectId ON ProjectFile(projectId)`,
  `CREATE TABLE IF NOT EXISTS ChatSession (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL,
    userId TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'New session',
    createdAt INTEGER NOT NULL,
    updatedAt INTEGER NOT NULL,
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS ChatMessage (
    id TEXT PRIMARY KEY,
    sessionId TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    toolCalls TEXT,
    tokens INTEGER,
    createdAt INTEGER NOT NULL,
    FOREIGN KEY (sessionId) REFERENCES ChatSession(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chatmessage_sessionId ON ChatMessage(sessionId)`,
  `CREATE TABLE IF NOT EXISTS Deployment (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL,
    deployTargetId TEXT NOT NULL,
    provider TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    providerDeployId TEXT,
    url TEXT,
    logs TEXT,
    errorMessage TEXT,
    createdAt INTEGER NOT NULL,
    completedAt INTEGER,
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE,
    FOREIGN KEY (deployTargetId) REFERENCES DeployTarget(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE IF NOT EXISTS FineTuneDataset (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    examples INTEGER NOT NULL,
    sizeBytes INTEGER NOT NULL,
    format TEXT NOT NULL,
    createdAt INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS FineTuneJob (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT NOT NULL,
    baseModel TEXT NOT NULL,
    datasetName TEXT NOT NULL,
    examples INTEGER NOT NULL,
    epochs INTEGER NOT NULL,
    learningRate REAL NOT NULL,
    progress REAL NOT NULL DEFAULT 0,
    loss REAL,
    createdAt INTEGER NOT NULL
  )`,
]

async function main() {
  console.log(`Connecting to ${url}...`)
  for (const sql of statements) {
    const firstLine = sql.split('\n')[0].slice(0, 80)
    try {
      await client.execute(sql)
      console.log(`  ✓ ${firstLine}...`)
    } catch (e) {
      console.error(`  ✗ ${firstLine}: ${e.message}`)
    }
  }
  console.log('\n✓ All tables created on Turso')
}

main().catch(e => { console.error(e); process.exit(1) })
