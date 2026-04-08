import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { Env, Variables } from '../types/env'
import { createPrismaClient } from '../lib/db'
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth'

const quests = new Hono<{ Bindings: Env; Variables: Variables }>()

// Create quest schema
const createQuestSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  type: z.enum(['daily', 'weekly', 'oneTime', 'repeatable']),
  actionType: z.enum(['post', 'comment', 'like', 'joinEvent', 'invite', 'login']),
  actionCount: z.number().int().min(1),
  reward: z.number().int().min(0),
})

const updateQuestSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  type: z.enum(['daily', 'weekly', 'oneTime', 'repeatable']).optional(),
  actionType: z.enum(['post', 'comment', 'like', 'joinEvent', 'invite', 'login']).optional(),
  actionCount: z.number().int().min(1).optional(),
  reward: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
})

// List quests for a planet
quests.get('/planets/:planetId/quests', optionalAuthMiddleware, async (c) => {
  const planetId = c.req.param('planetId')
  const userId = c.get('userId')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const quests = await db.quest.findMany({
      where: {
        planetId,
        isActive: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    // If user is logged in, include their progress
    let result = quests
    if (userId) {
      const progressList = await db.questProgress.findMany({
        where: {
          userId,
          questId: { in: quests.map(q => q.id) },
        },
      })

      const progressMap = new Map(progressList.map(p => [p.questId, p]))

      result = quests.map(quest => ({
        ...quest,
        myProgress: progressMap.get(quest.id) || {
          progress: 0,
          completed: false,
          completedAt: null,
        },
      }))
    }

    return c.json({
      success: true,
      data: result,
    })
  } finally {
    await db.$disconnect()
  }
})

// Get my quest progress for a planet
quests.get('/planets/:planetId/quests/my-progress', authMiddleware, async (c) => {
  const planetId = c.req.param('planetId')
  const userId = c.get('userId')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    // Get all quests for this planet
    const planetQuests = await db.quest.findMany({
      where: {
        planetId,
        isActive: true,
      },
    })

    // Get user's progress
    const progressList = await db.questProgress.findMany({
      where: {
        userId,
        questId: { in: planetQuests.map(q => q.id) },
      },
      include: { quest: true },
    })

    // Calculate stats
    const totalQuests = planetQuests.length
    const completedQuests = progressList.filter(p => p.completed).length
    const totalRewards = progressList
      .filter(p => p.completed)
      .reduce((sum, p) => sum + (p.quest.reward || 0), 0)

    return c.json({
      success: true,
      data: {
        progress: progressList,
        stats: {
          totalQuests,
          completedQuests,
          totalRewards,
        },
      },
    })
  } finally {
    await db.$disconnect()
  }
})

// Create quest (admin only)
quests.post('/planets/:planetId/quests', authMiddleware, zValidator('json', createQuestSchema), async (c) => {
  const planetId = c.req.param('planetId')
  const userId = c.get('userId')
  const body = c.req.valid('json')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    // Check user is starLord or elder
    const membership = await db.membership.findUnique({
      where: { userId_planetId: { userId, planetId } },
    })

    if (!membership || !['starLord', 'elder'].includes(membership.role)) {
      return c.json({ success: false, message: 'Permission denied' }, 403)
    }

    const quest = await db.quest.create({
      data: {
        ...body,
        planetId,
      },
    })

    return c.json({
      success: true,
      data: quest,
    }, 201)
  } finally {
    await db.$disconnect()
  }
})

// Update quest (admin only)
quests.patch('/quests/:id', authMiddleware, zValidator('json', updateQuestSchema), async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId')
  const body = c.req.valid('json')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    // Get quest to check planet
    const quest = await db.quest.findUnique({
      where: { id },
    })

    if (!quest) {
      return c.json({ success: false, message: 'Quest not found' }, 404)
    }

    // Check permissions
    const membership = await db.membership.findUnique({
      where: { userId_planetId: { userId, planetId: quest.planetId } },
    })

    if (!membership || !['starLord', 'elder'].includes(membership.role)) {
      return c.json({ success: false, message: 'Permission denied' }, 403)
    }

    const updated = await db.quest.update({
      where: { id },
      data: body,
    })

    return c.json({
      success: true,
      data: updated,
    })
  } finally {
    await db.$disconnect()
  }
})

// Delete quest (admin only)
quests.delete('/quests/:id', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    // Get quest to check planet
    const quest = await db.quest.findUnique({
      where: { id },
    })

    if (!quest) {
      return c.json({ success: false, message: 'Quest not found' }, 404)
    }

    // Check permissions
    const membership = await db.membership.findUnique({
      where: { userId_planetId: { userId, planetId: quest.planetId } },
    })

    if (!membership || !['starLord', 'elder'].includes(membership.role)) {
      return c.json({ success: false, message: 'Permission denied' }, 403)
    }

    await db.quest.delete({ where: { id } })

    return c.json({
      success: true,
      message: 'Quest deleted',
    })
  } finally {
    await db.$disconnect()
  }
})

// Helper: Track quest progress
// This would be called internally when users perform actions
async function trackQuestProgress(
  db: any,
  userId: string,
  planetId: string,
  actionType: string
) {
  // Find active quests for this planet and action type
  const quests = await db.quest.findMany({
    where: {
      planetId,
      actionType,
      isActive: true,
    },
  })

  for (const quest of quests) {
    // Get or create progress
    let progress = await db.questProgress.findUnique({
      where: {
        questId_userId: { questId: quest.id, userId },
      },
    })

    if (!progress) {
      progress = await db.questProgress.create({
        data: {
          questId: quest.id,
          userId,
          progress: 0,
          completed: false,
        },
      })
    }

    // Skip if already completed and quest is not repeatable
    if (progress.completed && quest.type !== 'repeatable') {
      continue
    }

    // Update progress
    const newProgress = progress.completed && quest.type === 'repeatable'
      ? 1 // Reset for repeatable quests
      : progress.progress + 1

    const completed = newProgress >= quest.actionCount

    await db.questProgress.update({
      where: { id: progress.id },
      data: {
        progress: newProgress,
        completed,
        completedAt: completed ? new Date() : null,
      },
    })

    // TODO: Grant reward and create notification when completed
  }
}

export default quests
