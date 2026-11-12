import { config } from 'dotenv';
import { resolve } from 'node:path';

// Load apps/api/.env regardless of the working directory (src/config or dist/config -> ../../.env)
config({ path: resolve(__dirname, '..', '..', '.env'), quiet: true } as any);
import { z } from 'zod';

const base64Key = (min: number) =>
  z.string().refine((v) => Buffer.from(v, 'base64').length >= min, `must be base64 encoded, at least ${min} bytes`);

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  APP_NAME: z.string().default('KCS ERP'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('127.0.0.1'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  /** sites allowed to read /public/website and post its contact form (no cookies) */
  WEBSITE_ORIGINS: z.string().default('https://karyaciptasolusi.com,https://www.karyaciptasolusi.com'),
  /** company whose content the public website shows (code); empty = the oldest active company */
  WEBSITE_COMPANY_CODE: z.string().default(''),
  DATABASE_URL: z.string().url(),
  JWT_ACCESS_SECRET: base64Key(32),
  ENCRYPTION_KEY: base64Key(32),
  HMAC_KEY: base64Key(32),
  PASSWORD_PEPPER: base64Key(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(7),
  STORAGE_DIR: z.string().default('./storage'),
  MAX_UPLOAD_MB: z.coerce.number().positive().default(25),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast: never boot with an insecure / incomplete configuration
  console.error('Invalid environment configuration:\n' + parsed.error.issues.map((i) => ` - ${i.path.join('.')}: ${i.message}`).join('\n'));
  console.error('Run `node scripts/init-env.mjs` in apps/api to generate a secure .env');
  process.exit(1);
}

export const env = parsed.data;
export const isProd = env.NODE_ENV === 'production';
