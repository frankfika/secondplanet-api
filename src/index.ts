import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { Env } from './types/env'

import auth from './routes/auth'
import users from './routes/users'
import planets from './routes/planets'
import posts from './routes/posts'
import events from './routes/events'
import members from './routes/members'
import upload from './routes/upload'

const app = new Hono<{ Bindings: Env }>()

// Middleware
app.use('*', logger())
app.use('*', cors({
  origin: ['https://secondplanet.app', 'https://www.secondplanet.app', 'http://localhost:5173', 'http://localhost:3000'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  exposeHeaders: ['Content-Length'],
  maxAge: 86400,
  credentials: true,
}))

// Health check
app.get('/', (c) => c.json({ status: 'ok', service: 'SecondPlanet API', version: '1.0.0' }))
app.get('/api/health', (c) => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

// Routes
app.route('/api/auth', auth)
app.route('/api/users', users)
app.route('/api/planets', planets)
app.route('/api', posts)  // Has /planets/:planetId/posts and /posts/:id routes
app.route('/api', events) // Has /planets/:planetId/events and /events/:id routes
app.route('/api', members) // Has /planets/:planetId/members routes
app.route('/api/upload', upload)

// 404 handler
app.notFound((c) => c.json({ success: false, message: 'Not found' }, 404))

// Error handler
app.onError((err, c) => {
  // Handle Hono HTTPException (e.g. zValidator errors)
  if ('status' in err && typeof (err as any).status === 'number') {
    const status = (err as any).status
    return c.json({ success: false, message: err.message || 'Bad request' }, status)
  }
  console.error('Error:', err)
  return c.json({ success: false, message: 'Internal server error' }, 500)
})

export default app
