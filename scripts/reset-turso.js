/**
 * Reset Turso database: drop all tables, then recreate from our schema.
 * Usage: TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... node scripts/reset-turso.js
 */
import { createClient } from '@libsql/client'

const url = process.env.TURSO_DATABASE_URL
const authToken = process.env.TURSO_AUTH_TOKEN
if (!url || !authToken) { console.error('TURSO_DATABASE_URL and TURSO_AUTH_TOKEN required'); process.exit(1) }

const client = createClient({ url, authToken })

const dropStatements = [
  'DROP TABLE IF EXISTS FineTuneJob',
  'DROP TABLE IF EXISTS FineTuneDataset',
  'DROP TABLE IF EXISTS Deployment',
  'DROP TABLE IF EXISTS ChatMessage',
  'DROP TABLE IF EXISTS ChatSession',
  'DROP TABLE IF EXISTS ProjectFile',
  'DROP TABLE IF EXISTS Project',
  'DROP TABLE IF EXISTS DeployTarget',
  'DROP TABLE IF EXISTS GithubToken',
  'DROP TABLE IF EXISTS VerificationToken',
  'DROP TABLE IF EXISTS Session',
  'DROP TABLE IF EXISTS Account',
  'DROP TABLE IF EXISTS User',
]

const createStatements = [
  `CREATE TABLE User (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    passwordHash TEXT NOT NULL,
    image TEXT,
    plan TEXT NOT NULL DEFAULT 'FREE',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL
  )`,
  `CREATE TABLE Account (
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
  `CREATE TABLE Session (
    id TEXT PRIMARY KEY,
    sessionToken TEXT NOT NULL UNIQUE,
    userId TEXT NOT NULL,
    expires TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE VerificationToken (
    identifier TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    expires TEXT NOT NULL,
    UNIQUE(identifier, token)
  )`,
  `CREATE TABLE GithubToken (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL UNIQUE,
    encryptedPat TEXT NOT NULL,
    patScopes TEXT NOT NULL,
    githubLogin TEXT,
    avatarUrl TEXT,
    validatedAt TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE DeployTarget (
    id TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    provider TEXT NOT NULL,
    encryptedToken TEXT NOT NULL,
    metadata TEXT,
    label TEXT,
    validatedAt TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE,
    UNIQUE(userId, provider)
  )`,
  `CREATE TABLE Project (
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
    lastDeployedAt TEXT,
    generationLog TEXT,
    fileCount INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE,
    UNIQUE(userId, slug)
  )`,
  `CREATE TABLE ProjectFile (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL,
    path TEXT NOT NULL,
    content TEXT NOT NULL,
    language TEXT,
    size INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE,
    UNIQUE(projectId, path)
  )`,
  `CREATE INDEX idx_projectfile_projectId ON ProjectFile(projectId)`,
  `CREATE TABLE ChatSession (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL,
    userId TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT 'New session',
    createdAt TEXT NOT NULL,
    updatedAt TEXT NOT NULL,
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE,
    FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE ChatMessage (
    id TEXT PRIMARY KEY,
    sessionId TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    toolCalls TEXT,
    tokens INTEGER,
    createdAt TEXT NOT NULL,
    FOREIGN KEY (sessionId) REFERENCES ChatSession(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX idx_chatmessage_sessionId ON ChatMessage(sessionId)`,
  `CREATE TABLE Deployment (
    id TEXT PRIMARY KEY,
    projectId TEXT NOT NULL,
    deployTargetId TEXT NOT NULL,
    provider TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    providerDeployId TEXT,
    url TEXT,
    logs TEXT,
    errorMessage TEXT,
    createdAt TEXT NOT NULL,
    completedAt TEXT,
    FOREIGN KEY (projectId) REFERENCES Project(id) ON DELETE CASCADE,
    FOREIGN KEY (deployTargetId) REFERENCES DeployTarget(id) ON DELETE CASCADE
  )`,
  `CREATE TABLE FineTuneDataset (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    examples INTEGER NOT NULL,
    sizeBytes INTEGER NOT NULL,
    format TEXT NOT NULL,
    createdAt TEXT NOT NULL
  )`,
  `CREATE TABLE FineTuneJob (
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
    createdAt TEXT NOT NULL
  )`,
]

async function main() {
  console.log(`Resetting database at ${url}...`)
  await client.execute('PRAGMA foreign_keys = OFF')
  console.log('\n1. Dropping all existing tables...')
  for (const sql of dropStatements) {
    try { await client.execute(sql); console.log(`  ✓ ${sql}`) }
    catch (e) { console.log(`  - skipped ${sql.slice(0, 40)}: ${e.message}`) }
  }
  console.log('\n2. Creating fresh tables...')
  for (const sql of createStatements) {
    const firstLine = sql.split('\n')[0].slice(0, 80)
    try { await client.execute(sql); console.log(`  ✓ ${firstLine}`) }
    catch (e) { console.error(`  ✗ ${firstLine}: ${e.message}`) }
  }
  await client.execute('PRAGMA foreign_keys = ON')
  console.log('\n✓ Database reset complete')
  // Verify
  const tables = await client.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
  console.log(`\nTables now: ${tables.rows.map(r => r.name).join(', ')}`)
}
main().catch(e => { console.error(e); process.exit(1) })
