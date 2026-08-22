import * as Joi from 'joi';

const jwtTtl = Joi.string()
  .pattern(/^[1-9]\d*(ms|s|m|h|d)$/)
  .message('must be a duration like 15m, 24h, or 7d');

const port = Joi.number().integer().min(1).max(65535);
const positiveInteger = Joi.number().integer().min(1);
const starknetHex = Joi.string().pattern(/^0x[0-9a-fA-F]{1,64}$/);
const origins = Joi.string()
  .custom((value, helpers) => {
    const values = value.split(',').map((origin: string) => origin.trim());
    if (values.some((origin: string) => origin === '*' || !/^https?:\/\/[^\s,]+$/.test(origin))) {
      return helpers.error('string.pattern.base');
    }
    return values.join(',');
  })
  .message('must be comma-separated http(s) origins without wildcard *');

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: port.default(3000),
  DATABASE_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }).required(),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_ISSUER: Joi.string().trim().min(1).default('proof-stell-backend'),
  JWT_AUDIENCE: Joi.string().trim().min(1).default('proof-stell-client'),
  JWT_ACCESS_TTL: jwtTtl.default('15m'),
  JWT_REFRESH_TTL: jwtTtl.default('7d'),
  BCRYPT_SALT_ROUNDS: positiveInteger.min(4).max(31).default(12),
  LEADERBOARD_RECALCULATION_STRATEGY: Joi.string().valid('batch', 'realtime').default('batch'),
  REDIS_HOST: Joi.string().trim().min(1).default('localhost'),
  REDIS_PORT: port.default(6379),
  MAIL_HOST: Joi.string().required(),
  MAIL_PORT: port.default(587),
  MAIL_USER: Joi.string().required(),
  MAIL_PASS: Joi.string().required(),
  MAIL_FROM: Joi.string().email({ tlds: false }).required(),
  AUTH_MAX_FAILED_ATTEMPTS: positiveInteger.default(5),
  AUTH_LOCKOUT_DURATION_SECONDS: positiveInteger.default(900),
  AUTH_ATTEMPT_WINDOW_SECONDS: positiveInteger.default(900),
  CRON_LOCK_TTL_MS: positiveInteger.default(300000),
  SCHEDULER_INSTANCE_ID: Joi.string().optional(),
  STARKNET_PRIVATE_KEY: starknetHex.required(),
  STARKNET_ACCOUNT_ADDRESS: starknetHex.required(),
  MINT_CONTRACT_ADDRESS: starknetHex.required(),
  BLOCKCHAIN_RECEIPT_TIMEOUT_MS: positiveInteger.default(120000),
  ALLOWED_ORIGINS: origins.default('http://localhost:3000'),
  CORS_ENABLED: Joi.string().valid('true', 'false').default('true'),
  // Notification delivery configuration
  NOTIFICATION_MAX_ATTEMPTS: Joi.number().integer().positive().default(5),
  NOTIFICATION_BASE_DELAY_MS: Joi.number().integer().positive().default(100),
  NOTIFICATION_DEDUP_WINDOW_MS: Joi.number().integer().positive().default(300000),
  // Add more validations as needed
});