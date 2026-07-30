// ─────────────────────────────────────────────────────────────────────────────
// Shared TypeScript types for the entire backend
// ─────────────────────────────────────────────────────────────────────────────

/** Database row shapes — snake_case to match Postgres columns */

export interface DbUser {
  id: string;
  google_id: string | null;
  email: string;
  name: string;
  avatar_url: string | null;
  password_hash: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface DbSender {
  id: string;
  user_id: string;
  name: string;
  email: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string;
  smtp_pass: string;
  created_at: Date;
}

export type CampaignStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface DbCampaign {
  id: string;
  idempotency_key: string | null;
  user_id: string;
  sender_id: string;
  subject: string;
  body: string;
  scheduled_start: Date;
  delay_between_emails_ms: number;
  hourly_limit: number;    // 0 = use global MAX_EMAILS_PER_HOUR_PER_SENDER
  total_recipients: number;
  status: CampaignStatus;
  attachments?: { filename: string; path: string; contentType: string; size: number }[] | null;
  created_at: Date;
}

export type EmailJobStatus = 'scheduled' | 'rate_limited' | 'sent' | 'failed' | 'cancelled';

export interface DbEmailJob {
  id: string;               // = BullMQ jobId (deterministic UUID v5)
  campaign_id: string;
  sender_id: string;
  recipient_email: string;
  subject: string;
  body: string;
  scheduled_at: Date;
  sent_at: Date | null;
  status: EmailJobStatus;
  attempts: number;
  error_message: string | null;
  starred: boolean;
  created_at: Date;
}

// ─────────────────────────────────────────────────────────────────────────────
// BullMQ job payload
// ─────────────────────────────────────────────────────────────────────────────

export interface EmailJobPayload {
  emailJobId: string;       // = DB id = BullMQ jobId
  campaignId: string;
  senderId: string;
  recipientEmail: string;
  subject: string;
  body: string;
  scheduledAt: string;      // ISO-8601 string
  hourlyLimit: number;      // 0 = use global default
  attachments?: { filename: string; path: string; contentType: string }[];
}

// ─────────────────────────────────────────────────────────────────────────────
// JWT
// ─────────────────────────────────────────────────────────────────────────────

export interface JwtAccessPayload {
  sub: string;       // userId
  type: 'access';
  jti: string;       // unique token ID (for blocklist)
  iat: number;
  exp: number;
}

export interface JwtRefreshPayload {
  sub: string;
  type: 'refresh';
  jti: string;
  iat: number;
  exp: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Express request augmentation
// ─────────────────────────────────────────────────────────────────────────────

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    // Override Express's User with our DbUser shape
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface User extends DbUser {}

    interface Request {
      jti?: string; // set by authenticate middleware
    }
  }
}

export {};
