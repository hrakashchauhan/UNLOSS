import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  APP_ORIGIN: z.string().default('http://localhost:5173').refine(value => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && url.origin === value;
    } catch { return false; }
  }, 'Must be an exact HTTP(S) origin without a path or trailing slash'),
  DATABASE_URL: z.string().refine(value => {
    try {
      const url = new URL(value);
      return ['postgres:', 'postgresql:'].includes(url.protocol) && Boolean(url.hostname) && url.pathname.length > 1;
    } catch { return false; }
  }, 'Must be a PostgreSQL connection URL with a database name'),
  SESSION_SECRET: z.string().refine(value =>
    Buffer.byteLength(value, 'utf8') >= 32 && !/replace|change[-_ ]?me|change[-_ ]?this|development-session-secret/i.test(value),
  'Must contain at least 32 bytes and must not be a placeholder'),
  DEMO_MODE: z.enum(['true', 'false']).default('false'),
  QR_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(90),
}).superRefine((value, context) => {
  if (value.NODE_ENV === 'production' && value.DEMO_MODE === 'true') {
    context.addIssue({ code: 'custom', path: ['DEMO_MODE'], message: 'Demo mode is forbidden in production' });
  }
  if (value.NODE_ENV === 'production' && !value.APP_ORIGIN.startsWith('https://')) {
    context.addIssue({ code: 'custom', path: ['APP_ORIGIN'], message: 'Production requires HTTPS' });
  }
});

export class ConfigurationError extends Error {
  constructor(public readonly fields: string[]) {
    // Field names only: validation errors must never echo connection strings or secrets.
    super(`Invalid configuration: ${fields.join(', ')}`);
    this.name = 'ConfigurationError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = schema.safeParse(env);
  if (!result.success) throw new ConfigurationError([...new Set(result.error.issues.map(issue => String(issue.path[0])))]);
  return Object.freeze({
    nodeEnv: result.data.NODE_ENV,
    port: result.data.API_PORT,
    appOrigin: result.data.APP_ORIGIN,
    databaseUrl: result.data.DATABASE_URL,
    sessionSecret: result.data.SESSION_SECRET,
    demo: result.data.DEMO_MODE === 'true',
    qrTokenTtlDays: result.data.QR_TOKEN_TTL_DAYS,
  });
}

export type Config = ReturnType<typeof loadConfig>;

export class ProductionNotReadyError extends Error {
  constructor() { super('Production serving is disabled pending authentication and workflow security verification'); }
}

export function assertRuntimeSupported(config: Config) {
  // Remove only after Phase 2 and the audited workflow security defects are verified.
  if (config.nodeEnv === 'production') {
    throw new ProductionNotReadyError();
  }
}
