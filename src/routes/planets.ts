import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { Env } from '../types/env'
import { createPrismaClient } from '../lib/db'
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth'

const planets = new Hono<{ Bindings: Env }>()

// Create planet schema
const createPlanetSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  category: z.string().min(1),
  description: z.string().min(1),
  coverImage: z.string().optional(),
  icon: z.string().optional(),
  visibility: z.enum(['public', 'private']).optional(),
  currencyName: z.string().optional(),
  currencySymbol: z.string().optional(),
})

// List planets
planets.get('/', optionalAuthMiddleware, async (c) => {
  const category = c.req.query('category')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const where: any = { visibility: 'public' }
    if (category) where.category = category

    const list = await db.planet.findMany({
      where,
      select: {
        id: true,
        name: true,
        slug: true,
        category: true,
        description: true,
        coverImage: true,
        icon: true,
        memberCount: true,
        createdAt: true,
      },
      orderBy: { memberCount: 'desc' },
    })

    return c.json({ success: true, data: list })
  } finally {
    await db.$disconnect()
  }
})

// Get my planets
planets.get('/my', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const memberships = await db.membership.findMany({
      where: { userId },
      include: {
        planet: true,
      },
      orderBy: { joinedAt: 'desc' },
    })

    const list = memberships.map((m) => ({
      ...m.planet,
      role: m.role,
      joinedAt: m.joinedAt,
    }))

    return c.json({ success: true, data: list })
  } finally {
    await db.$disconnect()
  }
})

// Get planet by ID
planets.get('/:id', optionalAuthMiddleware, async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const planet = await db.planet.findUnique({
      where: { id },
    })

    if (!planet) {
      return c.json({ success: false, message: 'Planet not found' }, 404)
    }

    let membership = null
    if (userId) {
      membership = await db.membership.findUnique({
        where: { userId_planetId: { userId, planetId: id } },
      })
    }

    return c.json({
      success: true,
      data: {
        ...planet,
        constitution: JSON.parse(planet.constitution),
        pointRules: JSON.parse(planet.pointRules),
        isMember: !!membership,
        myRole: membership?.role,
      },
    })
  } finally {
    await db.$disconnect()
  }
})

// Create planet
planets.post('/', authMiddleware, zValidator('json', createPlanetSchema), async (c) => {
  const userId = c.get('userId')
  const data = c.req.valid('json')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    // Check slug uniqueness
    const existing = await db.planet.findUnique({ where: { slug: data.slug } })
    if (existing) {
      return c.json({ success: false, message: 'Slug already exists' }, 400)
    }

    // Create planet
    const planet = await db.planet.create({
      data: {
        ...data,
        ownerId: userId,
        memberCount: 1,
      },
    })

    // Create owner membership
    const user = await db.user.findUnique({ where: { id: userId } })
    await db.membership.create({
      data: {
        userId,
        planetId: planet.id,
        nickname: user?.name || 'Star Lord',
        role: 'starLord',
      },
    })

    return c.json({ success: true, data: planet })
  } finally {
    await db.$disconnect()
  }
})

// Update planet
planets.patch('/:id', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId')
  const body = await c.req.json()
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const planet = await db.planet.findUnique({ where: { id } })
    if (!planet) {
      return c.json({ success: false, message: 'Planet not found' }, 404)
    }

    // Check if user is owner or admin
    const membership = await db.membership.findUnique({
      where: { userId_planetId: { userId, planetId: id } },
    })

    if (!membership || !['starLord', 'elder'].includes(membership.role)) {
      return c.json({ success: false, message: 'Permission denied' }, 403)
    }

    const updated = await db.planet.update({
      where: { id },
      data: body,
    })

    return c.json({ success: true, data: updated })
  } finally {
    await db.$disconnect()
  }
})

// Join planet
planets.post('/:id/join', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId')
  const body = await c.req.json().catch(() => ({}))
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const planet = await db.planet.findUnique({ where: { id } })
    if (!planet) {
      return c.json({ success: false, message: 'Planet not found' }, 404)
    }

    // Check if private and invite code required
    if (planet.visibility === 'private') {
      if (!body.inviteCode || body.inviteCode !== planet.inviteCode) {
        return c.json({ success: false, message: 'Invalid invite code' }, 400)
      }
    }

    // Check if already member
    const existing = await db.membership.findUnique({
      where: { userId_planetId: { userId, planetId: id } },
    })

    if (existing) {
      return c.json({ success: false, message: 'Already a member' }, 400)
    }

    const user = await db.user.findUnique({ where: { id: userId } })

    // Create membership
    const membership = await db.membership.create({
      data: {
        userId,
        planetId: id,
        nickname: user?.name || 'New Member',
        role: 'citizen',
      },
    })

    // Update member count
    await db.planet.update({
      where: { id },
      data: { memberCount: { increment: 1 } },
    })

    return c.json({ success: true, data: membership })
  } finally {
    await db.$disconnect()
  }
})

// Leave planet
planets.post('/:id/leave', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const membership = await db.membership.findUnique({
      where: { userId_planetId: { userId, planetId: id } },
    })

    if (!membership) {
      return c.json({ success: false, message: 'Not a member' }, 400)
    }

    if (membership.role === 'starLord') {
      return c.json({ success: false, message: 'Star Lord cannot leave. Transfer ownership first.' }, 400)
    }

    await db.membership.delete({
      where: { userId_planetId: { userId, planetId: id } },
    })

    await db.planet.update({
      where: { id },
      data: { memberCount: { decrement: 1 } },
    })

    return c.json({ success: true, message: 'Left planet' })
  } finally {
    await db.$disconnect()
  }
})

// Regenerate invite code
planets.post('/:id/regenerate-code', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const membership = await db.membership.findUnique({
      where: { userId_planetId: { userId, planetId: id } },
    })

    if (!membership || !['starLord', 'elder'].includes(membership.role)) {
      return c.json({ success: false, message: 'Permission denied' }, 403)
    }

    // Generate a random 8-char invite code
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
    let inviteCode = ''
    for (let i = 0; i < 8; i++) {
      inviteCode += chars.charAt(Math.floor(Math.random() * chars.length))
    }

    const updated = await db.planet.update({
      where: { id },
      data: { inviteCode },
    })

    return c.json({ success: true, data: { inviteCode: updated.inviteCode } })
  } finally {
    await db.$disconnect()
  }
})

// Transfer ownership
planets.post('/:id/transfer-ownership', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId')
  const body = await c.req.json()
  const { newOwnerId } = body
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    if (!newOwnerId) {
      return c.json({ success: false, message: 'newOwnerId is required' }, 400)
    }

    // Check current user is starLord
    const myMembership = await db.membership.findUnique({
      where: { userId_planetId: { userId, planetId: id } },
    })

    if (!myMembership || myMembership.role !== 'starLord') {
      return c.json({ success: false, message: 'Only Star Lord can transfer ownership' }, 403)
    }

    // Check new owner is a member
    const targetMembership = await db.membership.findUnique({
      where: { userId_planetId: { userId: newOwnerId, planetId: id } },
    })

    if (!targetMembership) {
      return c.json({ success: false, message: 'Target user is not a member' }, 400)
    }

    // Transfer: update planet owner, swap roles
    await db.planet.update({
      where: { id },
      data: { ownerId: newOwnerId },
    })

    await db.membership.update({
      where: { userId_planetId: { userId, planetId: id } },
      data: { role: 'elder' },
    })

    await db.membership.update({
      where: { userId_planetId: { userId: newOwnerId, planetId: id } },
      data: { role: 'starLord' },
    })

    return c.json({ success: true, message: 'Ownership transferred' })
  } finally {
    await db.$disconnect()
  }
})

// Get planet stats
planets.get('/:id/stats', async (c) => {
  const id = c.req.param('id')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const [memberCount, postCount, eventCount] = await Promise.all([
      db.membership.count({ where: { planetId: id } }),
      db.post.count({ where: { planetId: id } }),
      db.event.count({ where: { planetId: id } }),
    ])

    return c.json({
      success: true,
      data: { memberCount, postCount, eventCount },
    })
  } finally {
    await db.$disconnect()
  }
})

export default planets
