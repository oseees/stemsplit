// Hand-written types mirroring supabase/schema.sql.
// (You can regenerate richer types with `supabase gen types typescript`.)

export type PlanTier = "free" | "pro" | "agency";
export type SubscriptionStatus =
  | "active"
  | "trialing"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "unpaid";
export type UploadStatus =
  | "uploading"
  | "uploaded"
  | "processing"
  | "analyzed"
  | "failed";
export type ClipLength = "s15" | "s30" | "s60";
export type Platform = "tiktok" | "shorts" | "reels";
export type NarrationMode =
  | "storytelling"
  | "documentary"
  | "educational"
  | "motivational"
  | "news";

export type MomentType =
  | "hook"
  | "emotional"
  | "high-energy"
  | "suspense"
  | "funny"
  | "educational";

export interface Moment {
  start: number;
  end: number;
  type: MomentType;
  intensity: number; // 0–1
  reason: string;
}

export interface RetentionSection {
  start: number;
  end: number;
  label: "strong" | "weak" | "dropoff";
  note: string;
}

export interface RetentionRecommendation {
  at: number; // seconds
  action: "add-zoom" | "add-caption" | "cut" | "add-broll";
  detail: string;
}

export interface RetentionReport {
  sections: RetentionSection[];
  recommendations: RetentionRecommendation[];
  dropoffPoints: number[];
}

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  niche: string | null;
  created_at: string;
  updated_at: string;
}

export interface Subscription {
  id: string;
  user_id: string;
  tier: PlanTier;
  status: SubscriptionStatus;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  created_at: string;
  updated_at: string;
}

export interface Upload {
  id: string;
  user_id: string;
  filename: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  duration_sec: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  status: UploadStatus;
  transcript: { start: number; end: number; text: string }[];
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface Analysis {
  id: string;
  upload_id: string;
  user_id: string;
  moments: Moment[];
  retention: RetentionReport;
  summary: string | null;
  model: string | null;
  created_at: string;
}

export interface Clip {
  id: string;
  upload_id: string;
  user_id: string;
  length: ClipLength;
  start_sec: number;
  end_sec: number;
  title: string | null;
  storage_path: string | null;
  thumbnail_path: string | null;
  exported: boolean;
  created_at: string;
}

export interface ViralScore {
  id: string;
  clip_id: string;
  user_id: string;
  virality: number;
  retention: number;
  engagement: number;
  reasons: string[];
  improvements: string[];
  created_at: string;
}

export interface Narration {
  id: string;
  clip_id: string | null;
  upload_id: string | null;
  user_id: string;
  mode: NarrationMode;
  script: string;
  audio_path: string | null;
  created_at: string;
}

export interface CompetitorReport {
  id: string;
  user_id: string;
  source_url: string;
  platform: Platform | null;
  hook_strength: number | null;
  editing_pace: string | null;
  structure: string | null;
  engagement_drivers: string[];
  recommendations: string[];
  raw: unknown;
  created_at: string;
}

export interface UsageTracking {
  id: string;
  user_id: string;
  period: string;
  uploads: number;
  clips: number;
  ai_calls: number;
  created_at: string;
  updated_at: string;
}
