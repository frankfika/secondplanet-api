export interface Env {
  DATABASE_URL: string
  JWT_SECRET: string
  JWT_REFRESH_SECRET: string
  ENVIRONMENT: string
  UPLOADS?: R2Bucket
}
