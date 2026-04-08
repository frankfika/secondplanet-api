import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { Env, Variables } from '../types/env'
import { createPrismaClient } from '../lib/db'
import { authMiddleware, optionalAuthMiddleware } from '../middleware/auth'

const posts = new Hono<{ Bindings: Env; Variables: Variables }>()

// Create post schema
const createPostSchema = z.object({
  content: z.string().min(1),
  images: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
})

const createCommentSchema = z.object({
  content: z.string().min(1).max(2000),
  parentId: z.string().optional(),
})

// List posts for a planet
posts.get('/planets/:planetId/posts', optionalAuthMiddleware, async (c) => {
  const planetId = c.req.param('planetId')
  const page = parseInt(c.req.query('page') || '1')
  const limit = parseInt(c.req.query('limit') || '20')
  const userId = c.get('userId')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const [list, total] = await Promise.all([
      db.post.findMany({
        where: { planetId },
        include: {
          author: {
            select: { id: true, name: true, avatar: true, globalId: true },
          },
          likes: userId ? { where: { userId }, select: { id: true } } : false,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.post.count({ where: { planetId } }),
    ])

    const data = list.map((p: typeof list[0]) => ({
      ...p,
      images: JSON.parse(p.images),
      tags: JSON.parse(p.tags),
      isLiked: userId ? p.likes.length > 0 : false,
      likes: undefined,
    }))

    return c.json({
      success: true,
      data: {
        items: data,
        pagination: { page, pageSize: limit, total, totalPages: Math.ceil(total / limit) },
      },
    })
  } finally {
    await db.$disconnect()
  }
})

// Create post
posts.post('/planets/:planetId/posts', authMiddleware, zValidator('json', createPostSchema), async (c) => {
  const planetId = c.req.param('planetId')
  const userId = c.get('userId')
  const { content, images, tags } = c.req.valid('json')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    // Check membership
    const membership = await db.membership.findUnique({
      where: { userId_planetId: { userId, planetId } },
    })

    if (!membership) {
      return c.json({ success: false, message: 'Not a member' }, 403)
    }

    const post = await db.post.create({
      data: {
        planetId,
        authorId: userId,
        content,
        images: JSON.stringify(images || []),
        tags: JSON.stringify(tags || []),
      },
      include: {
        author: {
          select: { id: true, name: true, avatar: true, globalId: true },
        },
      },
    })

    // Award points
    const pointRules = JSON.parse((await db.planet.findUnique({ where: { id: planetId } }))?.pointRules || '{}')
    if (pointRules.post) {
      await db.membership.update({
        where: { userId_planetId: { userId, planetId } },
        data: { balance: { increment: pointRules.post } },
      })
    }

    return c.json({
      success: true,
      data: {
        ...post,
        images: JSON.parse(post.images),
        tags: JSON.parse(post.tags),
      },
    })
  } finally {
    await db.$disconnect()
  }
})

// Get post by ID
posts.get('/posts/:id', optionalAuthMiddleware, async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const post = await db.post.findUnique({
      where: { id },
      include: {
        author: {
          select: { id: true, name: true, avatar: true, globalId: true },
        },
        likes: userId ? { where: { userId }, select: { id: true } } : false,
      },
    })

    if (!post) {
      return c.json({ success: false, message: 'Post not found' }, 404)
    }

    return c.json({
      success: true,
      data: {
        ...post,
        images: JSON.parse(post.images),
        tags: JSON.parse(post.tags),
        isLiked: userId ? post.likes.length > 0 : false,
        likes: undefined,
      },
    })
  } finally {
    await db.$disconnect()
  }
})

// Delete post
posts.delete('/posts/:id', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const post = await db.post.findUnique({ where: { id } })
    if (!post) {
      return c.json({ success: false, message: 'Post not found' }, 404)
    }

    // Check permission
    if (post.authorId !== userId) {
      const membership = await db.membership.findUnique({
        where: { userId_planetId: { userId, planetId: post.planetId } },
      })
      if (!membership || !['starLord', 'elder'].includes(membership.role)) {
        return c.json({ success: false, message: 'Permission denied' }, 403)
      }
    }

    await db.post.delete({ where: { id } })
    return c.json({ success: true, message: 'Post deleted' })
  } finally {
    await db.$disconnect()
  }
})

// Like post
posts.post('/posts/:id/like', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const post = await db.post.findUnique({ where: { id } })
    if (!post) {
      return c.json({ success: false, message: 'Post not found' }, 404)
    }

    const existing = await db.like.findUnique({
      where: { postId_userId: { postId: id, userId } },
    })

    if (existing) {
      return c.json({ success: false, message: 'Already liked' }, 400)
    }

    await db.like.create({ data: { postId: id, userId } })
    await db.post.update({
      where: { id },
      data: { likeCount: { increment: 1 } },
    })

    // Award points to author
    const pointRules = JSON.parse((await db.planet.findUnique({ where: { id: post.planetId } }))?.pointRules || '{}')
    if (pointRules.like_received) {
      await db.membership.updateMany({
        where: { userId: post.authorId, planetId: post.planetId },
        data: { balance: { increment: pointRules.like_received } },
      })
    }

    return c.json({ success: true, message: 'Liked' })
  } finally {
    await db.$disconnect()
  }
})

// Unlike post
posts.delete('/posts/:id/like', authMiddleware, async (c) => {
  const id = c.req.param('id')
  const userId = c.get('userId')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const existing = await db.like.findUnique({
      where: { postId_userId: { postId: id, userId } },
    })

    if (!existing) {
      return c.json({ success: false, message: 'Not liked' }, 400)
    }

    await db.like.delete({ where: { postId_userId: { postId: id, userId } } })
    await db.post.update({
      where: { id },
      data: { likeCount: { decrement: 1 } },
    })

    return c.json({ success: true, message: 'Unliked' })
  } finally {
    await db.$disconnect()
  }
})

// Get comments
posts.get('/posts/:id/comments', async (c) => {
  const postId = c.req.param('id')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const comments = await db.comment.findMany({
      where: { postId, parentId: null },
      include: {
        author: {
          select: { id: true, name: true, avatar: true },
        },
        replies: {
          include: {
            author: {
              select: { id: true, name: true, avatar: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    })

    return c.json({ success: true, data: comments })
  } finally {
    await db.$disconnect()
  }
})

// Create comment
posts.post('/posts/:id/comments', authMiddleware, zValidator('json', createCommentSchema), async (c) => {
  const postId = c.req.param('id')
  const userId = c.get('userId')
  const body = c.req.valid('json')
  const db = createPrismaClient(c.env.DATABASE_URL)

  try {
    const post = await db.post.findUnique({ where: { id: postId } })
    if (!post) {
      return c.json({ success: false, message: 'Post not found' }, 404)
    }

    const comment = await db.comment.create({
      data: {
        postId,
        authorId: userId,
        content: body.content,
        parentId: body.parentId,
      },
      include: {
        author: {
          select: { id: true, name: true, avatar: true },
        },
      },
    })

    await db.post.update({
      where: { id: postId },
      data: { commentCount: { increment: 1 } },
    })

    // Award points
    const pointRules = JSON.parse((await db.planet.findUnique({ where: { id: post.planetId } }))?.pointRules || '{}')
    if (pointRules.comment) {
      await db.membership.updateMany({
        where: { userId, planetId: post.planetId },
        data: { balance: { increment: pointRules.comment } },
      })
    }

    return c.json({ success: true, data: comment })
  } finally {
    await db.$disconnect()
  }
})

export default posts
