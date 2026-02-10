import { Hono } from 'hono'
import { Env } from '../types/env'
import { createPrismaClient } from '../lib/db'
import { authMiddleware } from '../middleware/auth'

const members = new Hono<{ Bindings: Env }>()

// List members of a planet
members.get('/planets/:planetId/members', async (c) => {
  const planetId = c.req.param('planetId')
  const page = parseInt(c.req.query('page') || '1')
  const limit = parseInt(c.req.query('limit') || '20')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const [list, total] = await Promise.all([
      db.membership.findMany({
        where: { planetId },
        include: {
          user: {
            select: { id: true, name: true, avatar: true, globalId: true },
          },
        },
        orderBy: { joinedAt: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.membership.count({ where: { planetId } }),
    ])

    return c.json({
      success: true,
      data: list,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } finally {
    await db.$disconnect()
  }
})

// Get member detail
members.get('/planets/:planetId/members/:userId', async (c) => {
  const planetId = c.req.param('planetId')
  const userId = c.req.param('userId')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const membership = await db.membership.findUnique({
      where: { userId_planetId: { userId, planetId } },
      include: {
        user: {
          select: { id: true, name: true, avatar: true, globalId: true, location: true },
        },
      },
    })

    if (!membership) {
      return c.json({ success: false, message: 'Member not found' }, 404)
    }

    return c.json({ success: true, data: membership })
  } finally {
    await db.$disconnect()
  }
})

// Update my membership profile
members.patch('/planets/:planetId/members/me', authMiddleware, async (c) => {
  const planetId = c.req.param('planetId')
  const userId = c.get('userId')
  const body = await c.req.json()
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const membership = await db.membership.findUnique({
      where: { userId_planetId: { userId, planetId } },
    })

    if (!membership) {
      return c.json({ success: false, message: 'Not a member' }, 404)
    }

    const updated = await db.membership.update({
      where: { userId_planetId: { userId, planetId } },
      data: {
        nickname: body.nickname,
        bio: body.bio,
        localAvatar: body.localAvatar,
        status: body.status,
        showEmail: body.showEmail,
        showPhone: body.showPhone,
        showLocation: body.showLocation,
        showSocials: body.showSocials,
      },
    })

    return c.json({ success: true, data: updated })
  } finally {
    await db.$disconnect()
  }
})

// Update member role (admin only)
members.patch('/planets/:planetId/members/:userId/role', authMiddleware, async (c) => {
  const planetId = c.req.param('planetId')
  const targetUserId = c.req.param('userId')
  const userId = c.get('userId')
  const body = await c.req.json()
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    // Check admin permission
    const myMembership = await db.membership.findUnique({
      where: { userId_planetId: { userId, planetId } },
    })

    if (!myMembership || myMembership.role !== 'starLord') {
      return c.json({ success: false, message: 'Only Star Lord can change roles' }, 403)
    }

    const targetMembership = await db.membership.findUnique({
      where: { userId_planetId: { userId: targetUserId, planetId } },
    })

    if (!targetMembership) {
      return c.json({ success: false, message: 'Member not found' }, 404)
    }

    if (targetMembership.role === 'starLord') {
      return c.json({ success: false, message: 'Cannot change Star Lord role' }, 400)
    }

    const updated = await db.membership.update({
      where: { userId_planetId: { userId: targetUserId, planetId } },
      data: { role: body.role },
    })

    return c.json({ success: true, data: updated })
  } finally {
    await db.$disconnect()
  }
})

// Remove member (admin only)
members.delete('/planets/:planetId/members/:userId', authMiddleware, async (c) => {
  const planetId = c.req.param('planetId')
  const targetUserId = c.req.param('userId')
  const userId = c.get('userId')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const myMembership = await db.membership.findUnique({
      where: { userId_planetId: { userId, planetId } },
    })

    if (!myMembership || !['starLord', 'elder'].includes(myMembership.role)) {
      return c.json({ success: false, message: 'Permission denied' }, 403)
    }

    const targetMembership = await db.membership.findUnique({
      where: { userId_planetId: { userId: targetUserId, planetId } },
    })

    if (!targetMembership) {
      return c.json({ success: false, message: 'Member not found' }, 404)
    }

    if (targetMembership.role === 'starLord') {
      return c.json({ success: false, message: 'Cannot remove Star Lord' }, 400)
    }

    // Elders can only remove citizens
    if (myMembership.role === 'elder' && targetMembership.role !== 'citizen') {
      return c.json({ success: false, message: 'Elders can only remove citizens' }, 403)
    }

    await db.membership.delete({
      where: { userId_planetId: { userId: targetUserId, planetId } },
    })

    await db.planet.update({
      where: { id: planetId },
      data: { memberCount: { decrement: 1 } },
    })

    return c.json({ success: true, message: 'Member removed' })
  } finally {
    await db.$disconnect()
  }
})

export default members
