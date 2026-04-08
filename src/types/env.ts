export interface Env {
  DATABASE_URL: string
  JWT_SECRET: string
  JWT_REFRESH_SECRET: string
  ENVIRONMENT: string
  UPLOADS?: R2Bucket
}

// Context variables set by auth middleware
export interface Variables {
  userId: string
  userEmail?: string
}
