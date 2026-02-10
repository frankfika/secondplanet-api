import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { Env } from '../types/env'
import { createPrismaClient } from '../lib/db'
import { authMiddleware } from '../middleware/auth'

const users = new Hono<{ Bindings: Env }>()

// Update current user
const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  avatar: z.string().optional(),
  location: z.string().optional(),
})

users.patch('/me', authMiddleware, zValidator('json', updateUserSchema), async (c) => {
  const userId = c.get('userId')
  const data = c.req.valid('json')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const user = await db.user.update({
      where: { id: userId },
      data,
      select: {
        id: true,
        email: true,
        phone: true,
        name: true,
        avatar: true,
        globalId: true,
        location: true,
      },
    })

    return c.json({ success: true, data: user })
  } finally {
    await db.$disconnect()
  }
})

// Get user by ID
users.get('/:id', async (c) => {
  const id = c.req.param('id')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const user = await db.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        avatar: true,
        globalId: true,
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

// Get current user's memberships
users.get('/me/memberships', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const memberships = await db.membership.findMany({
      where: { userId },
      include: {
        planet: {
          select: {
            id: true,
            name: true,
            slug: true,
            icon: true,
            coverImage: true,
            category: true,
            memberCount: true,
          },
        },
      },
      orderBy: { joinedAt: 'desc' },
    })

    return c.json({ success: true, data: memberships })
  } finally {
    await db.$disconnect()
  }
})

// Get current user's assets (balance across all planets)
users.get('/me/assets', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const memberships = await db.membership.findMany({
      where: { userId },
      select: {
        balance: true,
        planet: {
          select: {
            id: true,
            name: true,
            currencyName: true,
            currencySymbol: true,
          },
        },
      },
    })

    const assets = memberships.map((m) => ({
      planetId: m.planet.id,
      planetName: m.planet.name,
      currencyName: m.planet.currencyName,
      currencySymbol: m.planet.currencySymbol,
      balance: m.balance,
    }))

    return c.json({ success: true, data: assets })
  } finally {
    await db.$disconnect()
  }
})

export default users
