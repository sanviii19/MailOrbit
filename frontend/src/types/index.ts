export interface EmailJob {
  id: string;
  recipient_email: string;
  subject: string;
  status: string;
  starred: boolean;
  scheduled_at: string;
  sent_at?: string;
  campaign_id: string;
  sender_id: string;
  body?: string;
  sender?: {
    name: string;
    email: string;
  };
  created_at: string;
  campaign_attachments?: any;
}

export interface Sender {
  id: string;
  email: string;
  name?: string;
}
