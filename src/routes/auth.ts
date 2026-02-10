import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { Env } from '../types/env'
import { createPrismaClient } from '../lib/db'
import { signToken, hashPassword, verifyPassword, verifyToken, generateNonce, buildSignMessage, generateAvatarFromAddress } from '../lib/auth'
import { authMiddleware } from '../middleware/auth'
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { ethers } from 'ethers'

const auth = new Hono<{ Bindings: Env }>()

// ============ Schemas ============

const registerSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().optional(),
  password: z.string().min(6),
  name: z.string().min(1),
})

const loginSchema = z.object({
  email: z.string().email().optional(),
  phone: z.string().optional(),
  password: z.string(),
})

const nonceRequestSchema = z.object({
  address: z.string().min(1),
  chainType: z.enum(['evm', 'solana']),
})

const solanaAuthSchema = z.object({
  address: z.string().min(1),
  signature: z.string().min(1),
  message: z.string().min(1),
})

const evmAuthSchema = z.object({
  address: z.string().min(1),
  signature: z.string().min(1),
  message: z.string().min(1),
})

const updateProfileSchema = z.object({
  name: z.string().min(1).optional(),
  avatar: z.string().optional(),
  location: z.string().optional(),
})

// Helper: sanitize user response
function sanitizeUser(user: any) {
  const { passwordHash, wechatOpenId, wechatUnionId, appleId, ...safe } = user
  return safe
}

// ============ Email/Password Auth ============

// Register
auth.post('/register', zValidator('json', registerSchema), async (c) => {
  const { email, phone, password, name } = c.req.valid('json')

  if (!email && !phone) {
    return c.json({ success: false, message: 'Email or phone is required' }, 400)
  }

  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const existing = await db.user.findFirst({
      where: email ? { email } : { phone },
    })

    if (existing) {
      return c.json({ success: false, message: 'User already exists' }, 400)
    }

    const passwordHash = await hashPassword(password)
    const user = await db.user.create({
      data: { email, phone, passwordHash, name },
    })

    const accessToken = await signToken({ userId: user.id, email: user.email || undefined }, c.env.JWT_SECRET, '7d')
    const refreshToken = await signToken({ userId: user.id }, c.env.JWT_REFRESH_SECRET, '30d')

    return c.json({
      success: true,
      data: {
        user: sanitizeUser(user),
        accessToken,
        refreshToken,
      },
    })
  } finally {
    await db.$disconnect()
  }
})

// Login
auth.post('/login', zValidator('json', loginSchema), async (c) => {
  const { email, phone, password } = c.req.valid('json')

  if (!email && !phone) {
    return c.json({ success: false, message: 'Email or phone is required' }, 400)
  }

  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const user = await db.user.findFirst({
      where: email ? { email } : { phone },
    })

    if (!user || !user.passwordHash) {
      return c.json({ success: false, message: 'Invalid credentials' }, 401)
    }

    const valid = await verifyPassword(password, user.passwordHash)
    if (!valid) {
      return c.json({ success: false, message: 'Invalid credentials' }, 401)
    }

    const accessToken = await signToken({ userId: user.id, email: user.email || undefined }, c.env.JWT_SECRET, '7d')
    const refreshToken = await signToken({ userId: user.id }, c.env.JWT_REFRESH_SECRET, '30d')

    return c.json({
      success: true,
      data: {
        user: sanitizeUser(user),
        accessToken,
        refreshToken,
      },
    })
  } finally {
    await db.$disconnect()
  }
})

// Refresh token
auth.post('/refresh', async (c) => {
  const body = await c.req.json()
  const { refreshToken } = body

  if (!refreshToken) {
    return c.json({ success: false, message: 'Refresh token required' }, 400)
  }

  const payload = await verifyToken(refreshToken, c.env.JWT_REFRESH_SECRET)
  if (!payload) {
    return c.json({ success: false, message: 'Invalid refresh token' }, 401)
  }

  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const user = await db.user.findUnique({ where: { id: payload.userId } })
    if (!user) {
      return c.json({ success: false, message: 'User not found' }, 404)
    }

    const accessToken = await signToken({ userId: user.id, email: user.email || undefined }, c.env.JWT_SECRET, '7d')
    const newRefreshToken = await signToken({ userId: user.id }, c.env.JWT_REFRESH_SECRET, '30d')

    return c.json({
      success: true,
      data: { accessToken, refreshToken: newRefreshToken },
    })
  } finally {
    await db.$disconnect()
  }
})

// Get current user
auth.get('/me', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        name: true,
        avatar: true,
        globalId: true,
        location: true,
        solanaAddress: true,
        evmAddress: true,
        createdAt: true,
      },
    })

    if (!user) {
      return c.json({ success: false, message: 'User not found' }, 404)
    }

    return c.json({ success: true, data: user })
  } finally {
    await db.$disconnect()
  }
})

// Update profile
auth.put('/update-profile', authMiddleware, zValidator('json', updateProfileSchema), async (c) => {
  const userId = c.get('userId')
  const data = c.req.valid('json')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const user = await db.user.update({
      where: { id: userId },
      data,
    })

    return c.json({ success: true, data: sanitizeUser(user) })
  } finally {
    await db.$disconnect()
  }
})

// ============ Web3 Wallet Auth ============

// Request nonce for wallet signing
auth.post('/nonce', zValidator('json', nonceRequestSchema), async (c) => {
  const { address, chainType } = c.req.valid('json')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    // Clean up expired nonces for this address
    await db.authNonce.deleteMany({
      where: {
        address: chainType === 'evm' ? address.toLowerCase() : address,
        expiredAt: { lt: new Date() },
      },
    })

    // Also clean up used nonces
    await db.authNonce.deleteMany({
      where: {
        address: chainType === 'evm' ? address.toLowerCase() : address,
        used: true,
      },
    })

    const nonce = generateNonce()
    const message = buildSignMessage(nonce)
    const expiredAt = new Date(Date.now() + 5 * 60 * 1000) // 5 minutes

    await db.authNonce.create({
      data: {
        address: chainType === 'evm' ? address.toLowerCase() : address,
        nonce,
        chainType,
        expiredAt,
      },
    })

    return c.json({
      success: true,
      data: { nonce, message, expiresAt: expiredAt.toISOString() },
    })
  } finally {
    await db.$disconnect()
  }
})

// Solana wallet authentication
auth.post('/solana', zValidator('json', solanaAuthSchema), async (c) => {
  const { address, signature, message } = c.req.valid('json')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    // Extract nonce from message
    const nonceMatch = message.match(/Nonce: ([a-f0-9]+)/)
    if (!nonceMatch) {
      return c.json({ success: false, message: 'Invalid message format' }, 400)
    }
    const nonce = nonceMatch[1]

    // Validate nonce
    const authNonce = await db.authNonce.findFirst({
      where: {
        nonce,
        address,
        chainType: 'solana',
        used: false,
        expiredAt: { gt: new Date() },
      },
    })

    if (!authNonce) {
      return c.json({ success: false, message: 'Invalid or expired nonce' }, 400)
    }

    // Verify Solana signature
    try {
      const messageBytes = new TextEncoder().encode(message)
      const signatureBytes = bs58.decode(signature)
      const publicKeyBytes = bs58.decode(address)

      const isValid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes)
      if (!isValid) {
        return c.json({ success: false, message: 'Invalid signature' }, 401)
      }
    } catch {
      return c.json({ success: false, message: 'Signature verification failed' }, 401)
    }

    // Mark nonce as used
    await db.authNonce.update({
      where: { id: authNonce.id },
      data: { used: true },
    })

    // Find or create user
    let user = await db.user.findFirst({
      where: { solanaAddress: address },
    })

    if (!user) {
      const shortAddr = `${address.slice(0, 4)}...${address.slice(-4)}`
      user = await db.user.create({
        data: {
          solanaAddress: address,
          name: shortAddr,
          avatar: generateAvatarFromAddress(address),
        },
      })
    }

    const accessToken = await signToken({ userId: user.id }, c.env.JWT_SECRET, '7d')
    const refreshToken = await signToken({ userId: user.id }, c.env.JWT_REFRESH_SECRET, '30d')

    return c.json({
      success: true,
      data: {
        user: sanitizeUser(user),
        accessToken,
        refreshToken,
      },
    })
  } finally {
    await db.$disconnect()
  }
})

// EVM wallet authentication
auth.post('/evm', zValidator('json', evmAuthSchema), async (c) => {
  const { address, signature, message } = c.req.valid('json')
  const normalizedAddress = address.toLowerCase()
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    // Extract nonce from message
    const nonceMatch = message.match(/Nonce: ([a-f0-9]+)/)
    if (!nonceMatch) {
      return c.json({ success: false, message: 'Invalid message format' }, 400)
    }
    const nonce = nonceMatch[1]

    // Validate nonce
    const authNonce = await db.authNonce.findFirst({
      where: {
        nonce,
        address: normalizedAddress,
        chainType: 'evm',
        used: false,
        expiredAt: { gt: new Date() },
      },
    })

    if (!authNonce) {
      return c.json({ success: false, message: 'Invalid or expired nonce' }, 400)
    }

    // Verify EVM signature
    try {
      const recoveredAddress = ethers.verifyMessage(message, signature)
      if (recoveredAddress.toLowerCase() !== normalizedAddress) {
        return c.json({ success: false, message: 'Invalid signature' }, 401)
      }
    } catch {
      return c.json({ success: false, message: 'Signature verification failed' }, 401)
    }

    // Mark nonce as used
    await db.authNonce.update({
      where: { id: authNonce.id },
      data: { used: true },
    })

    // Find or create user
    let user = await db.user.findFirst({
      where: { evmAddress: normalizedAddress },
    })

    if (!user) {
      const shortAddr = `${address.slice(0, 6)}...${address.slice(-4)}`
      user = await db.user.create({
        data: {
          evmAddress: normalizedAddress,
          name: shortAddr,
          avatar: generateAvatarFromAddress(address),
        },
      })
    }

    const accessToken = await signToken({ userId: user.id }, c.env.JWT_SECRET, '7d')
    const refreshToken = await signToken({ userId: user.id }, c.env.JWT_REFRESH_SECRET, '30d')

    return c.json({
      success: true,
      data: {
        user: sanitizeUser(user),
        accessToken,
        refreshToken,
      },
    })
  } finally {
    await db.$disconnect()
  }
})

export default auth
