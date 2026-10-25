// The parts of the /v1 responses the CLI reads. The full document is at
// https://kinsy.ai/v1/openapi.json; cli/scripts/check-openapi.mjs checks
// these names against it.

export type Credits = {
  monthly_grant: number;
  period_used: number;
  period_remaining: number;
  extra: number;
  total: number;
  resets_at: string | null;
  degraded: boolean;
};

export type KeyInfo = {
  key_id: string;
  hint: string;
  label: string;
  src: string;
  created_at: string;
  last_used_at: string | null;
};

export type Me = {
  uid: string;
  email: string | null;
  email_verified: boolean;
  plan: string;
  credits: Credits;
  watermark: boolean;
  target_max: number;
  client: string;
  key: KeyInfo | null;
};

export type DeviceStart = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete: string;
  expires_in: number;
  interval: number;
};

export type DeviceToken = {
  status: "pending" | "slow_down" | "approved" | "denied" | "expired" | "claimed";
  interval: number;
  api_key?: string | null;
  key_hint?: string | null;
  email?: string | null;
};

export type Theme = { id: string; name: string; description?: string };
export type Template = { id: string; name: string; description?: string };

export type DeckArtifact = { url: string; filename: string; expires_at: string };

export type DeckStatus = {
  deck_id: string;
  status: "queued" | "running" | "done" | "error" | string;
  phase: string | null;
  progress: number;
  slides_rendered: number;
  slides_total: number | null;
  title: string | null;
  client: string | null;
  created_at: string | null;
  updated_at: string | null;
  error: string | null;
  watermark: boolean | null;
  artifacts: { pptx: DeckArtifact | null; pdf: DeckArtifact | null } | null;
};

export type DeckCreateResponse = {
  deck_id: string;
  status: "queued";
  status_url: string;
  created_at: string;
  credits_charged: number;
};

export type FileLink = { url: string; filename: string; expires_at: string };

export type FileResponse = { name: string; char_count: number; truncated: boolean; text: string };

export type SlideInfo = { num: number; layout: string; headline: string | null; png_url: string };

export type EditResponse = {
  deck_id: string;
  slide: SlideInfo | null;
  clarify: string | null;
  layout_changed: boolean;
  title: string;
  images_generated: number;
  credits_charged: number;
};
