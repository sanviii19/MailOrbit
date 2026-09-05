# MailOrbit

Production-grade full-stack email scheduling service built with **Express + TypeScript + BullMQ + Redis + PostgreSQL** (Backend) and **React + Vite** (Frontend).

## Features Implemented

### Backend
- **Scheduler**: Utilizes BullMQ delayed jobs for precise email scheduling without relying on cron jobs.
- **Persistence on Restart**: Jobs and their states are stored in Redis. If the server restarts, workers automatically resume processing pending jobs at the correct times without needing recalculation.
- **Rate Limiting**: Implements both a global rate limiter (minimum gap between any two emails) and a per-sender hourly limit using Redis Lua scripts. Excess jobs are gracefully delayed to the next hour rather than being dropped.
- **Concurrency**: Configurable BullMQ worker concurrency to process multiple email jobs in parallel.
- **Auth**: Secure authentication with Email/Password and Google OAuth, using JWT access tokens and HttpOnly refresh cookies.
- **Ethereal Integration**: Automatically provisions free Ethereal SMTP test accounts for senders.

### Frontend
- **Login & Auth**: Seamless Google OAuth integration and standard Email/Password authentication.
- **Dashboard**: Overview of your campaigns, providing aggregate statistics.
- **Compose**: A rich UI to create and schedule new email campaigns, with support for staggered sending delays and CSV recipient uploads.
- **Data Tables**: Comprehensive views of scheduled, sent, and failed email jobs, featuring pagination, search, and filtering.

---

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
| Framework | Express 4 (Backend) / React + Vite (Frontend) |
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

### 4. Frontend Setup
```bash
cd frontend

# Copy and fill in environment variables
cp .env.example .env.local
# Make sure VITE_API_URL is pointing to your backend:
# VITE_API_URL=http://localhost:4000/api

npm install
npm run dev
```

Frontend will be available at **http://localhost:5173**

### 5. Verify
Backend Health Check:
```
GET http://localhost:4000/health
```

---

## Environment Variables & Ethereal Email Setup

**Ethereal Email Setup**:
You **do not** need to manually create an Ethereal account or set it in your `.env`. The backend automatically generates a free Ethereal SMTP test account behind the scenes when you create a new "Sender" via the API or frontend UI.

**Backend (`backend/.env`)**
See [`.env.example`](backend/.env.example) for all available variables with inline documentation.

**Required before first run:**
- `DATABASE_URL` — PostgreSQL connection string
- `REDIS_URL` — Redis connection string
- `JWT_SECRET` — 64-char hex string (generate with `node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`)
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` — from Google Cloud Console (if using OAuth)

**Frontend (`frontend/.env.local`)**
- `VITE_API_URL=http://localhost:4000/api`

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

## Architecture Overview: Scheduling & Workers

### How delayed jobs work (no cron)

1. `POST /api/campaigns` receives recipients + `scheduledStart`
2. For each recipient[i], a BullMQ delayed job is enqueued with:
   ```
   delay[i] = max(0, scheduledStart - now) + i × delayBetweenEmailsMs
   ```
3. BullMQ stores jobs as Redis sorted sets keyed by fire timestamp.
4. When the delay expires, the worker picks the job up.

### Persistence on Restart

- **Redis Sorted Sets**: BullMQ uses persistent Redis sorted sets.
- **On server restart**: BullMQ reads the same Redis data — jobs fire at the correct time automatically. Workers simply pick up where they left off. No recalculation or cron-style catch-up is needed.

### Idempotency

- Job ID = `uuidv5(campaignId + ":" + recipientEmail, NAMESPACE)` — deterministic
- BullMQ: adding a job with an existing `jobId` is silently ignored
- DB: `UNIQUE(campaign_id, recipient_email)` — `ON CONFLICT DO NOTHING`
- API: optional `idempotencyKey` header returns the existing campaign

### Rate Limiting & Concurrency

#### Worker Concurrency
```
WORKER_CONCURRENCY=5       # 5 jobs processed in parallel
```
Controls how many jobs the worker can process at the exact same time.

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

### Behavior under 1000+ emails
- All 1000 jobs are enqueued upfront with staggered delays (chunks of 1000)
- BullMQ stores them in Redis sorted set — no memory pressure on the app
- Worker concurrency + limiter throttle consumption
- Per-sender hourly cap pushes excess to next hour (no drops)
- The app server can restart at any time without losing progress

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
