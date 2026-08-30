# Environment Configuration

Configuration is loaded from `.env.development` (or `.env.production` when
`NODE_ENV=production`) and validated once during application startup. Runtime
consumers use `TypedConfigService`; do not read security values directly from
`process.env` or root `ConfigService` keys.

## Required values

| Variable | Format | Local example | Production guidance |
|---|---|---|---|
| `DATABASE_URL` | `postgres://` or `postgresql://` URL | `postgres://postgres:postgres@localhost:5432/proof_stell` | Use the managed database URL and TLS options required by your provider |
| `JWT_SECRET` | At least 32 characters | `local-only-secret-change-me-123456` | Use a random secret of at least 32 characters, stored in a secret manager |
| `MAIL_HOST` | SMTP hostname | `localhost` | Use the approved SMTP relay hostname |
| `MAIL_USER` | Non-empty SMTP username | `local-user` | Use a service account |
| `MAIL_PASS` | Non-empty SMTP password or API key | `local-password` | Store as a deployment secret |
| `MAIL_FROM` | Valid sender email | `noreply@localhost` | Use a verified sender address |
| `STARKNET_PRIVATE_KEY` | `0x` followed by 1-64 hex characters | `0xabc123` | Use a funded deployment signer and never log this value |
| `STARKNET_ACCOUNT_ADDRESS` | `0x` followed by 1-64 hex characters | `0x123abc` | Use the production StarkNet account address |
| `MINT_CONTRACT_ADDRESS` | `0x` followed by 1-64 hex characters | `0x456def` | Use the deployed production contract address |

## Optional values and defaults

| Variable | Valid format | Default |
|---|---|---|
| `NODE_ENV` | `development`, `production`, or `test` | `development` |
| `PORT` | Integer `1-65535` | `3000` |
| `JWT_ISSUER` | Non-empty string | `proof-stell-backend` |
| `JWT_AUDIENCE` | Non-empty string | `proof-stell-client` |
| `JWT_ACCESS_TTL` | Positive duration such as `15m`, `1h` | `15m` |
| `JWT_REFRESH_TTL` | Positive duration such as `7d` | `7d` |
| `BCRYPT_SALT_ROUNDS` | Integer `4-31` | `12` |
| `REDIS_HOST` | Non-empty hostname | `localhost` |
| `REDIS_PORT` | Integer `1-65535` | `6379` |
| `MAIL_PORT` | Integer `1-65535` | `587` |
| `LEADERBOARD_RECALCULATION_STRATEGY` | `batch` or `realtime` | `batch` |
| `AUTH_MAX_FAILED_ATTEMPTS` | Positive integer | `5` |
| `AUTH_LOCKOUT_DURATION_SECONDS` | Positive integer | `900` |
| `AUTH_ATTEMPT_WINDOW_SECONDS` | Positive integer | `900` |
| `CRON_LOCK_TTL_MS` | Positive integer | `300000` |
| `SCHEDULER_INSTANCE_ID` | Optional non-empty string | Hostname and process ID |
| `BLOCKCHAIN_RECEIPT_TIMEOUT_MS` | Positive integer | `120000` |
| `ALLOWED_ORIGINS` | Comma-separated `http://` or `https://` URLs; `*` is invalid | `http://localhost:3000` |
| `CORS_ENABLED` | `true` or `false` | `true` |
| `NOTIFICATION_MAX_ATTEMPTS` | Positive integer | `5` |
| `NOTIFICATION_BASE_DELAY_MS` | Positive integer | `100` |
| `NOTIFICATION_DEDUP_WINDOW_MS` | Positive integer | `300000` |

## Local example

```dotenv
NODE_ENV=development
DATABASE_URL=postgres://postgres:postgres@localhost:5432/proof_stell
JWT_SECRET=local-only-secret-change-me-123456
STARKNET_PRIVATE_KEY=0xabc123
STARKNET_ACCOUNT_ADDRESS=0x123abc
MINT_CONTRACT_ADDRESS=0x456def
MAIL_HOST=localhost
MAIL_USER=local-user
MAIL_PASS=local-password
MAIL_FROM=noreply@example.com
REDIS_HOST=localhost
REDIS_PORT=6379
ALLOWED_ORIGINS=http://localhost:3000
```

## Production example

```dotenv
NODE_ENV=production
PORT=8080
DATABASE_URL=postgresql://app_user:REDACTED@db.internal:5432/proof_stell
JWT_SECRET=REPLACE_WITH_A_SECRET_MANAGER_VALUE_AT_LEAST_32_CHARS
JWT_ISSUER=proof-stell-api
JWT_AUDIENCE=proof-stell-web
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=7d
REDIS_HOST=redis.internal
REDIS_PORT=6379
MAIL_HOST=smtp.example.com
MAIL_PORT=587
MAIL_USER=proof-stell
MAIL_PASS=REPLACE_WITH_A_SECRET_MANAGER_VALUE
MAIL_FROM=noreply@example.com
STARKNET_PRIVATE_KEY=0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
STARKNET_ACCOUNT_ADDRESS=0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
MINT_CONTRACT_ADDRESS=0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789
ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
CORS_ENABLED=true
```

Secrets are validated for presence and format, but their values are never
included in startup logs. Production must not use wildcard CORS origins or
development credentials.