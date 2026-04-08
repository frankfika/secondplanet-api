import { SignJWT, jwtVerify } from 'jose'

const encoder = new TextEncoder()

export interface JwtPayload {
  userId: string
  email?: string
  iat?: number
  exp?: number
}

export async function signToken(
  payload: { userId: string; email?: string },
  secret: string,
  expiresIn: string = '7d'
): Promise<string> {
  const secretKey = encoder.encode(secret)

  // Parse expiration time
  const match = expiresIn.match(/^(\d+)([dhms])$/)
  if (!match) throw new Error('Invalid expiresIn format')

  const value = parseInt(match[1])
  const unit = match[2]

  let seconds: number
  switch (unit) {
    case 'd': seconds = value * 86400; break
    case 'h': seconds = value * 3600; break
    case 'm': seconds = value * 60; break
    case 's': seconds = value; break
    default: seconds = 604800 // 7 days default
  }

  return new SignJWT({ userId: payload.userId, email: payload.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + seconds)
    .sign(secretKey)
}

export async function verifyToken(token: string, secret: string): Promise<JwtPayload | null> {
  try {
    const secretKey = encoder.encode(secret)
    const { payload } = await jwtVerify(token, secretKey)
    return payload as unknown as JwtPayload
  } catch {
    return null
  }
}

// bcryptjs-compatible password hashing using Web Crypto API
// Uses PBKDF2 with SHA-256, 100k iterations - secure for Cloudflare Workers
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  )
  // Store as: salt(hex):hash(hex)
  const saltHex = Array.from(salt).map(b => b.toString(16).padStart(2, '0')).join('')
  const hashHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
  return `${saltHex}:${hashHex}`
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  // Support legacy SHA-256 hashes (no colon separator)
  if (!storedHash.includes(':')) {
    const legacyHash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(password)))
    ).map(b => b.toString(16).padStart(2, '0')).join('')
    return legacyHash === storedHash
  }

  const [saltHex, hashHex] = storedHash.split(':')
  const salt = new Uint8Array(saltHex.match(/.{2}/g)!.map(byte => parseInt(byte, 16)))
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  )
  const hash = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    256
  )
  const computedHex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
  return computedHex === hashHex
}

// Generate a random nonce for wallet authentication
export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

// Build the message to be signed by the wallet
export function buildSignMessage(nonce: string): string {
  return `Sign this message to authenticate with SecondPlanet.\n\nNonce: ${nonce}\nTimestamp: ${new Date().toISOString()}`
}

// Generate a gradient avatar URL based on address
export function generateAvatarFromAddress(address: string): string {
  // Use a deterministic gradient based on the address hash
  return `https://api.dicebear.com/7.x/identicon/svg?seed=${address}`
}
