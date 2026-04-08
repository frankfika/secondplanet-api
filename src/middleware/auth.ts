import { Context, Next } from 'hono'
import { verifyToken } from '../lib/auth'
import { Env, Variables } from '../types/env'

export async function authMiddleware(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  const authHeader = c.req.header('Authorization')

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, message: 'Unauthorized' }, 401)
  }

  const token = authHeader.substring(7)
  const payload = await verifyToken(token, c.env.JWT_SECRET)

  if (!payload) {
    return c.json({ success: false, message: 'Invalid token' }, 401)
  }

  c.set('userId', payload.userId)
  c.set('userEmail', payload.email)

  await next()
}

export async function optionalAuthMiddleware(c: Context<{ Bindings: Env; Variables: Variables }>, next: Next) {
  const authHeader = c.req.header('Authorization')

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7)
    const payload = await verifyToken(token, c.env.JWT_SECRET)

    if (payload) {
      c.set('userId', payload.userId)
      c.set('userEmail', payload.email)
    }
  }

  await next()
}
