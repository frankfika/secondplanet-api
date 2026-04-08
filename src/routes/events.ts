import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { Env, Variables } from '../types/env'
import { createPrismaClient } from '../lib/db'
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth'
import { notifyEventApproved, notifyEventRejected, notifyNewEventRsvp } from '../lib/notifications'

const events = new Hono<{ Bindings: Env; Variables: Variables }>()

// Create event schema
const createEventSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  coverImage: z.string().optional(),
  type: z.string().min(1),
  location: z.string().min(1),
  startTime: z.string(),
  endTime: z.string().optional(),
})

const updateEventSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  coverImage: z.string().optional(),
  type: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
})

const rsvpSchema = z.object({
  status: z.enum(['going', 'interested', 'not_going']).optional().default('going'),
  name: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  note: z.string().max(500).optional(),
})

// List events for a planet
events.get('/planets/:planetId/events', optionalAuthMiddleware, async (c) => {
  const planetId = c.req.param('planetId')
  const page = parseInt(c.req.query('page') || '1')
  const limit = parseInt(c.req.query('limit') || '20')
  const status = c.req.query('status')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const where: any = { planetId }
    if (status) where.status = status

    const [list, total] = await Promise.all([
      db.event.findMany({
        where,
        include: {
          organizer: {
            select: { id: true, name: true, avatar: true },
          },
        },
        orderBy: { startTime: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.event.count({ where }),
    ])

    return c.json({
      success: true,
      data: {
        items: list,
        pagination: { page, pageSize: limit, total, totalPages: Math.ceil(total / limit) },
      },
    })
  } finally {
    await db.$disconnect()
  }
})

// Create event
events.post('/planets/:planetId/events', authMiddleware, zValidator('json', createEventSchema), async (c) => {
  const planetId = c.req.param('planetId')
  const userId = c.get('userId')
  const data = c.req.valid('json')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    // Check membership
    const membership = await db.membership.findUnique({
      where: { userId_planetId: { userId, planetId } },
    })

    if (!membership) {
      return c.json({ success: false, message: 'Not a member' }, 403)
    }

    // Auto-approve for admins
    const autoApprove = ['starLord', 'elder'].includes(membership.role)

    const event = await db.event.create({
      data: {
        planetId,
        organizerId: userId,
        title: data.title,
        description: data.description,
        coverImage: data.coverImage,
        type: data.type,
        location: data.location,
        startTime: new Date(data.startTime),
        endTime: data.endTime ? new Date(data.endTime) : null,
        status: autoApprove ? 'approved' : 'pending',
        reviewedBy: autoApprove ? userId : null,
        reviewedAt: autoApprove ? new Date() : null,
      },
      include: {
        organizer: {
          select: { id: true, name: true, avatar: true },
        },
      },
    })

    return c.json({ success: true, data: event })
  } finally {
    await db.$disconnect()
  }
})

// Get event by ID
events.get('/events/:id', optionalAuthMiddleware, async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const event = await db.event.findUnique({
      where: { id },
      include: {
        organizer: {
          select: { id: true, name: true, avatar: true },
        },
        rsvps: userId ? { where: { userId }, select: { status: true } } : false,
      },
    })

    if (!event) {
      return c.json({ success: false, message: 'Event not found' }, 404)
    }

    return c.json({
      success: true,
      data: {
        ...event,
        myRsvp: userId && event.rsvps.length > 0 ? event.rsvps[0].status : null,
        rsvps: undefined,
      },
    })
  } finally {
    await db.$disconnect()
  }
})

// Update event
events.patch('/events/:id', authMiddleware, zValidator('json', updateEventSchema), async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId')
  const body = c.req.valid('json')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const event = await db.event.findUnique({ where: { id } })
    if (!event) {
      return c.json({ success: false, message: 'Event not found' }, 404)
    }

    // Check permission
    if (event.organizerId !== userId) {
      const membership = await db.membership.findUnique({
        where: { userId_planetId: { userId, planetId: event.planetId } },
      })
      if (!membership || !['starLord', 'elder'].includes(membership.role)) {
        return c.json({ success: false, message: 'Permission denied' }, 403)
      }
    }

    const updated = await db.event.update({
      where: { id },
      data: {
        ...body,
        startTime: body.startTime ? new Date(body.startTime) : undefined,
        endTime: body.endTime ? new Date(body.endTime) : undefined,
      },
    })

    return c.json({ success: true, data: updated })
  } finally {
    await db.$disconnect()
  }
})

// Delete event
events.delete('/events/:id', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const event = await db.event.findUnique({ where: { id } })
    if (!event) {
      return c.json({ success: false, message: 'Event not found' }, 404)
    }

    // Check permission
    if (event.organizerId !== userId) {
      const membership = await db.membership.findUnique({
        where: { userId_planetId: { userId, planetId: event.planetId } },
      })
      if (!membership || !['starLord', 'elder'].includes(membership.role)) {
        return c.json({ success: false, message: 'Permission denied' }, 403)
      }
    }

    await db.event.delete({ where: { id } })
    return c.json({ success: true, message: 'Event deleted' })
  } finally {
    await db.$disconnect()
  }
})

// RSVP to event
events.post('/events/:id/rsvp', authMiddleware, zValidator('json', rsvpSchema), async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId')
  const body = c.req.valid('json')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const event = await db.event.findUnique({ where: { id } })
    if (!event) {
      return c.json({ success: false, message: 'Event not found' }, 404)
    }

    if (event.status !== 'approved') {
      return c.json({ success: false, message: 'Event not approved' }, 400)
    }

    const existing = await db.eventRsvp.findUnique({
      where: { eventId_userId: { eventId: id, userId } },
    })

    if (existing) {
      // Update RSVP
      const updated = await db.eventRsvp.update({
        where: { eventId_userId: { eventId: id, userId } },
        data: {
          status: body.status,
          name: body.name,
          phone: body.phone,
          note: body.note,
        },
      })
      return c.json({ success: true, data: updated })
    }

    // Create RSVP
    const rsvp = await db.eventRsvp.create({
      data: {
        eventId: id,
        userId,
        status: body.status || 'going',
        name: body.name,
        phone: body.phone,
        note: body.note,
      },
    })

    await db.event.update({
      where: { id },
      data: { attendeeCount: { increment: 1 } },
    })

    // Award points
    const pointRules = JSON.parse((await db.planet.findUnique({ where: { id: event.planetId } }))?.pointRules || '{}')
    if (pointRules.rsvp) {
      await db.membership.updateMany({
        where: { userId, planetId: event.planetId },
        data: { balance: { increment: pointRules.rsvp } },
      })
    }

    // Notify event organizer
    const attendee = await db.user.findUnique({ where: { id: userId }, select: { name: true } })
    if (attendee && event.organizerId !== userId) {
      await notifyNewEventRsvp(
        c.env.DATABASE_URL,
        event.organizerId,
        attendee.name,
        id,
        event.title
      )
    }

    return c.json({ success: true, data: rsvp })
  } finally {
    await db.$disconnect()
  }
})

// Get attendees
events.get('/events/:id/attendees', async (c) => {
  const id = c.req.param('id')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const rsvps = await db.eventRsvp.findMany({
      where: { eventId: id },
      include: {
        user: {
          select: { id: true, name: true, avatar: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    return c.json({ success: true, data: rsvps })
  } finally {
    await db.$disconnect()
  }
})

// Approve event
events.post('/events/:id/approve', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const event = await db.event.findUnique({ where: { id } })
    if (!event) {
      return c.json({ success: false, message: 'Event not found' }, 404)
    }

    const membership = await db.membership.findUnique({
      where: { userId_planetId: { userId, planetId: event.planetId } },
    })

    if (!membership || !['starLord', 'elder'].includes(membership.role)) {
      return c.json({ success: false, message: 'Permission denied' }, 403)
    }

    const updated = await db.event.update({
      where: { id },
      data: {
        status: 'approved',
        reviewedBy: userId,
        reviewedAt: new Date(),
      },
    })

    // Notify event organizer
    const approver = await db.user.findUnique({ where: { id: userId }, select: { name: true } })
    if (approver && event.organizerId !== userId) {
      await notifyEventApproved(
        c.env.DATABASE_URL,
        id,
        event.title,
        event.organizerId,
        approver.name
      )
    }

    return c.json({ success: true, data: updated })
  } finally {
    await db.$disconnect()
  }
})

// Reject event
events.post('/events/:id/reject', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const event = await db.event.findUnique({ where: { id } })
    if (!event) {
      return c.json({ success: false, message: 'Event not found' }, 404)
    }

    const membership = await db.membership.findUnique({
      where: { userId_planetId: { userId, planetId: event.planetId } },
    })

    if (!membership || !['starLord', 'elder'].includes(membership.role)) {
      return c.json({ success: false, message: 'Permission denied' }, 403)
    }

    const updated = await db.event.update({
      where: { id },
      data: {
        status: 'rejected',
        reviewedBy: userId,
        reviewedAt: new Date(),
      },
    })

    // Notify event organizer
    const rejecter = await db.user.findUnique({ where: { id: userId }, select: { name: true } })
    if (rejecter && event.organizerId !== userId) {
      await notifyEventRejected(
        c.env.DATABASE_URL,
        id,
        event.title,
        event.organizerId,
        rejecter.name
      )
    }

    return c.json({ success: true, data: updated })
  } finally {
    await db.$disconnect()
  }
})

export default events
