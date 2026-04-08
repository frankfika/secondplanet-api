import { Hono } from 'hono'
import { Env, Variables } from '../types/env'
import { authMiddleware } from '../middleware/auth'

const upload = new Hono<{ Bindings: Env; Variables: Variables }>()

// Upload file to R2
upload.post('/', authMiddleware, async (c) => {
  const userId = c.get('userId')

  try {
    const formData = await c.req.formData()
    const file = formData.get('file') as unknown as File

    if (!file) {
      return c.json({ success: false, message: 'No file provided' }, 400)
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      return c.json({ success: false, message: 'File too large. Max 5MB' }, 400)
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      return c.json({ success: false, message: 'Invalid file type' }, 400)
    }

    // Generate unique filename
    const ext = file.name.split('.').pop() || 'jpg'
    const filename = `${userId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`

    // Upload to R2
    const bucket = c.env.UPLOADS
    if (!bucket) {
      return c.json({ success: false, message: 'Upload service not configured' }, 500)
    }
    const arrayBuffer = await file.arrayBuffer()
    await bucket.put(filename, arrayBuffer, {
      httpMetadata: {
        contentType: file.type,
      },
    })

    // Return public URL
    const url = `https://uploads.secondplanet.app/${filename}`

    return c.json({
      success: true,
      data: { url, filename },
    })
  } catch (error) {
    console.error('Upload error:', error)
    return c.json({ success: false, message: 'Upload failed' }, 500)
  }
})

// Delete file from R2
upload.delete('/:filename', authMiddleware, async (c) => {
  const filename = c.req.param('filename')
  const userId = c.get('userId')

  try {
    // Only allow deleting own files
    if (!filename.startsWith(`${userId}/`)) {
      return c.json({ success: false, message: 'Permission denied' }, 403)
    }

    const bucket = c.env.UPLOADS
    if (!bucket) {
      return c.json({ success: false, message: 'Upload service not configured' }, 500)
    }
    await bucket.delete(filename)
    return c.json({ success: true, message: 'File deleted' })
  } catch (error) {
    console.error('Delete error:', error)
    return c.json({ success: false, message: 'Delete failed' }, 500)
  }
})

export default upload
