# Email Job Scheduler — Backend

Production-grade email scheduling service built with **Express + TypeScript + BullMQ + Redis + PostgreSQL**.

## Architecture

```
React SPA ──► Express API ──► PostgreSQL (metadata)
                       │
                       └──► Redis ──► BullMQ Worker ──► Ethereal SMTP
                                  (jobs + rate-limit counters + JWT store)
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 LTS |
| Language | TypeScript 5 (strict) |
| Framework | Express 4 |
| Database | PostgreSQL 16 (Knex.js) |
| Queue | BullMQ 5 |
| Cache/Queue Store | Redis 7 (ioredis) |
| Auth | Passport (Google OAuth) + bcrypt + JWT |
| SMTP | Nodemailer + Ethereal (test accounts) |
| Validation | Zod |

---

## Quick Start

### 1. Prerequisites
- **Docker Desktop** running
- **Node.js 20+**

### 2. Infrastructure
```bash
# From the root of the project (EMAIL JOB SCHEDULER/)
docker compose up -d
```
This starts **PostgreSQL** on port 5432 and **Redis** on port 6379.

### 3. Backend Setup
```bash
cd backend

# Copy and fill in environment variables
cp ../.env.example .env
# Edit .env — at minimum set:
#   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, JWT_SECRET

npm install
npm run migrate          # Run database migrations
npm run dev              # Start dev server with hot-reload
```

Server will be available at **http://localhost:4000**

### 4. Verify
```
GET http://localhost:4000/health
```

---

## Environment Variables

See [`.env.example`](../.env.example) for all available variables with inline documentation.

**Required before first run:**
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `JWT_SECRET` — 64-char hex string (generate with `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — from Google Cloud Console

---

## API Reference

### Auth
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/register` | ❌ | Email/password registration |
| POST | `/api/auth/login` | ❌ | Login → access token + refresh cookie |
| POST | `/api/auth/refresh` | ❌ | Rotate refresh token (reads httpOnly cookie) |
| POST | `/api/auth/logout` | ✅ | Blocklist token + clear cookie |
| GET | `/api/auth/me` | ✅ | Current user profile |
| GET | `/api/auth/google` | ❌ | Start Google OAuth flow |
| GET | `/api/auth/google/callback` | ❌ | OAuth callback |

### Senders
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/senders` | List sender accounts |
| POST | `/api/senders` | Create sender (auto-provisions Ethereal account) |
| DELETE | `/api/senders/:id` | Delete sender |

**Create sender body:**
```json
{ "name": "Oliver Brown" }
```
The backend automatically creates a free Ethereal SMTP test account.

### Campaigns
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/campaigns` | Schedule a campaign |
| GET | `/api/campaigns` | List campaigns (paginated) |
| GET | `/api/campaigns/:id` | Campaign detail + job stats |

**Create campaign body (JSON):**
```json
{
  "senderId": "uuid",
  "recipients": ["alice@example.com", "bob@example.com"],
  "subject": "Hello from the scheduler",
  "body": "<p>Hi there!</p>",
  "scheduledStart": "2024-11-05T10:00:00Z",
  "delayBetweenEmailsMs": 3000,
  "hourlyLimit": 100,
  "idempotencyKey": "my-campaign-v1"
}
```

**Create campaign multipart (CSV upload):**
```
POST /api/campaigns
Content-Type: multipart/form-data

Fields: senderId, subject, body, scheduledStart, delayBetweenEmailsMs, hourlyLimit
File: csv (CSV file with email addresses, one per row or comma-separated)
```

### Email Jobs
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/emails/stats` | Aggregate counts |
| GET | `/api/emails/scheduled` | Scheduled + rate-limited jobs |
| GET | `/api/emails/sent` | Sent + failed jobs |
| GET | `/api/emails/:id` | Full email detail |
| PATCH | `/api/emails/:id/star` | Toggle star |
| DELETE | `/api/emails/:id` | Cancel scheduled / remove from view |

**Query params for list endpoints:**
- `page` (default: 1)
- `limit` (default: 20, max: 100)
- `search` (searches recipient_email and subject)
- `campaignId` (filter by campaign)

---

## Authentication Flow

### Email / Password
```
POST /api/auth/register or /api/auth/login
→ { accessToken, user }
→ Set-Cookie: refresh_token=<token>; HttpOnly; SameSite=Strict

Include in subsequent requests:
Authorization: Bearer <accessToken>

Refresh before expiry:
POST /api/auth/refresh  (refresh token sent automatically via cookie)
→ { accessToken }
```

### Google OAuth
```
1. Redirect browser to GET /api/auth/google
2. User consents on Google
3. Backend callback at GET /api/auth/google/callback
4. Backend issues JWT, sets refresh cookie
5. Redirects to FRONTEND_URL/auth/callback?token=<accessToken>
6. React reads token from URL, stores in memory, clears URL
```

---

## Scheduling Design

### How delayed jobs work (no cron)

1. `POST /api/campaigns` receives recipients + `scheduledStart`
2. For each recipient[i], a BullMQ delayed job is enqueued with:
   ```
   delay[i] = max(0, scheduledStart - now) + i × delayBetweenEmailsMs
   ```
3. BullMQ stores jobs as Redis sorted sets keyed by fire timestamp
4. When the delay expires, the worker picks the job up
5. **On server restart**: BullMQ reads the same Redis data — jobs fire at the correct time automatically, no recalculation needed

### Idempotency

- Job ID = `uuidv5(campaignId + ":" + recipientEmail, NAMESPACE)` — deterministic
- BullMQ: adding a job with an existing `jobId` is silently ignored
- DB: `UNIQUE(campaign_id, recipient_email)` — `ON CONFLICT DO NOTHING`
- API: optional `idempotencyKey` header returns the existing campaign

### Rate Limiting

#### BullMQ Global Limiter
Controls minimum gap between any two sends globally:
```
RATE_LIMITER_MAX=1
RATE_LIMITER_DURATION_MS=2000   # = 1 email per 2 seconds = 30/min
```

#### Per-Sender Per-Hour Cap (Redis Lua, multi-worker safe)
```
MAX_EMAILS_PER_HOUR_PER_SENDER=200
```
Before each send attempt, a Redis Lua script atomically:
1. `INCR rate:<senderId>:<YYYY-MM-DD-HH>` 
2. If count > limit → DECR (rollback), return 0 (rate limited)
3. If count == 1 → set 2-hour TTL on the key

**When rate-limited**: the job calls `job.moveToDelayed(startOfNextHour)` and throws `DelayedError`. BullMQ handles this gracefully — the attempt is NOT counted as a failure. The job reschedules itself to the next UTC hour. Jobs are preserved in order as much as possible.

**No jobs are ever dropped.**

### Worker Configuration
```
WORKER_CONCURRENCY=5       # 5 jobs processed in parallel
RATE_LIMITER_MAX=1         # 1 job per RATE_LIMITER_DURATION_MS
RATE_LIMITER_DURATION_MS=2000   # 2 second minimum gap
```

### Behavior under 1000+ emails
- All 1000 jobs are enqueued upfront with staggered delays (chunks of 1000)
- BullMQ stores them in Redis sorted set — no memory pressure on the app
- Worker concurrency + limiter throttle consumption
- Per-sender hourly cap pushes excess to next hour (no drops)
- The app server can restart at any time without losing progress

---

## Database Schema

```
users         — auth accounts (Google + email/password, linked by email)
senders       — SMTP credentials per user (Ethereal test accounts)
campaigns     — batch email metadata + scheduling config
email_jobs    — one row per recipient per campaign (= BullMQ jobId)
              UNIQUE(campaign_id, recipient_email)
```

---

## Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a project → Enable "Google+ API" or "Google Identity"  
3. Create OAuth 2.0 credentials (Web application)
4. Add authorized redirect URI: `http://localhost:4000/api/auth/google/callback`
5. Copy Client ID and Secret into `.env`

---

## Development Scripts

```bash
npm run dev              # ts-node-dev with hot-reload
npm run build            # compile to dist/
npm run start            # run compiled JS
npm run migrate          # run pending migrations
npm run migrate:rollback # roll back last migration
npm run migrate:status   # show migration status
```
