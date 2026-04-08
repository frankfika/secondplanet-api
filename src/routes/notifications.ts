import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { Env, Variables } from '../types/env'
import { createPrismaClient } from '../lib/db'
import { authMiddleware } from '../middleware/auth'

const notifications = new Hono<{ Bindings: Env; Variables: Variables }>()

const createNotificationSchema = z.object({
  userId: z.string().min(1),
  type: z.string().min(1),
  title: z.string().min(1),
  content: z.string().min(1),
  relatedId: z.string().optional(),
  relatedType: z.string().optional(),
})

// List my notifications
notifications.get('/', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const page = parseInt(c.req.query('page') || '1')
  const limit = parseInt(c.req.query('limit') || '20')
  const unreadOnly = c.req.query('unread') === 'true'
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const where = {
      userId,
      ...(unreadOnly ? { isRead: false } : {}),
    }

    const [items, total] = await Promise.all([
      db.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.notification.count({ where }),
    ])

    const unreadCount = await db.notification.count({
      where: { userId, isRead: false },
    })

    return c.json({
      success: true,
      data: {
        items,
        pagination: {
          page,
          pageSize: limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        unreadCount,
      },
    })
  } finally {
    await db.$disconnect()
  }
})

// Get unread count
notifications.get('/unread-count', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const count = await db.notification.count({
      where: { userId, isRead: false },
    })

    return c.json({
      success: true,
      data: { count },
    })
  } finally {
    await db.$disconnect()
  }
})

// Mark as read
notifications.patch('/:id/read', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const notification = await db.notification.findFirst({
      where: { id, userId },
    })

    if (!notification) {
      return c.json({ success: false, message: 'Notification not found' }, 404)
    }

    const updated = await db.notification.update({
      where: { id },
      data: { isRead: true },
    })

    return c.json({
      success: true,
      data: updated,
    })
  } finally {
    await db.$disconnect()
  }
})

// Mark all as read
notifications.patch('/read-all', authMiddleware, async (c) => {
  const userId = c.get('userId')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const { count } = await db.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    })

    return c.json({
      success: true,
      data: { markedAsRead: count },
    })
  } finally {
    await db.$disconnect()
  }
})

// Delete notification
notifications.delete('/:id', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const notification = await db.notification.findFirst({
      where: { id, userId },
    })

    if (!notification) {
      return c.json({ success: false, message: 'Notification not found' }, 404)
    }

    await db.notification.delete({ where: { id } })

    return c.json({
      success: true,
      message: 'Notification deleted',
    })
  } finally {
    await db.$disconnect()
  }
})

// Create notification (internal use, could be protected by API key in production)
notifications.post('/', zValidator('json', createNotificationSchema), async (c) => {
  const body = c.req.valid('json')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const notification = await db.notification.create({
      data: body,
    })

    return c.json({
      success: true,
      data: notification,
    }, 201)
  } finally {
    await db.$disconnect()
  }
})

export default notifications
