import crypto from 'crypto'

/**
 * Token encryption — AES-256-GCM.
 *
 * User GitHub PATs and deploy-provider tokens are stored encrypted at rest.
 * The encryption key is the APP_ENCRYPTION_KEY env var (32-byte hex or utf8).
 * In dev, we fall back to a derived key so the app boots without setup.
 */

const ALGO = 'aes-256-gcm'
const IV_LENGTH = 12
const TAG_LENGTH = 16

function getKey(): Buffer {
  const raw = process.env.APP_ENCRYPTION_KEY
  if (raw) {
    // Accept either 64-char hex or 32-char utf8
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex')
    if (raw.length === 32) return Buffer.from(raw, 'utf8')
  }
  // Dev fallback — derive a stable key from a known seed.
  // DO NOT rely on this in production.
  return crypto.createHash('sha256').update('glm-appforge-dev-key').digest()
}

export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  // Pack: iv(12) + tag(16) + ciphertext
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function decrypt(packed: string): string {
  const buf = Buffer.from(packed, 'base64')
  if (buf.length < IV_LENGTH + TAG_LENGTH) throw new Error('Invalid ciphertext')
  const iv = buf.subarray(0, IV_LENGTH)
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH)
  const enc = buf.subarray(IV_LENGTH + TAG_LENGTH)
  const decipher = crypto.createDecipheriv(ALGO, getKey(), iv)
  decipher.setAuthTag(tag)
  const dec = Buffer.concat([decipher.update(enc), decipher.final()])
  return dec.toString('utf8')
}
