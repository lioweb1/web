// Kept as a TS string so it ships inside the server bundle.
export const SCHEMA_SQL = /* sql */ `
-- MedChrono AI schema. Idempotent: safe to run on every deploy.
-- No patient data is ever stored here: only accounts, sessions, billing and usage counts.

create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'free',              -- free | firm | enterprise
  subscription_status text,                        -- Stripe subscription status
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  trial_credits integer not null default 1 check (trial_credits >= 0),
  plan_credits integer not null default 0 check (plan_credits >= 0),
  purchased_credits integer not null default 0 check (purchased_credits >= 0),
  current_period_end timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  email text not null,
  name text not null,
  password_hash text not null,
  role text not null default 'owner',              -- owner | member
  created_at timestamptz not null default now()
);
create unique index if not exists users_email_key on users (lower(email));

create table if not exists sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists sessions_user_idx on sessions (user_id);

-- One row per credit movement. Deliberately has no case name or file names (they can contain PHI).
create table if not exists usage_events (
  id bigserial primary key,
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  kind text not null,                              -- analysis | purchase | plan_renewal | refund | adjustment
  status text not null default 'done',             -- running | done | refunded
  credits integer not null default 0,              -- negative = spent
  trial_used integer not null default 0,
  plan_used integer not null default 0,
  purchased_used integer not null default 0,
  pages integer,
  files integer,
  note text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index if not exists usage_events_org_idx on usage_events (org_id, created_at desc);

-- Stripe webhook idempotency.
create table if not exists stripe_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

-- Login throttling.
create table if not exists login_attempts (
  key text not null,
  at timestamptz not null default now()
);
create index if not exists login_attempts_key_idx on login_attempts (key, at);

-- Password reset links (single use, 1 hour).
create table if not exists password_resets (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists password_resets_user_idx on password_resets (user_id);

-- Team invitations (single use, 7 days).
create table if not exists invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  email text not null,
  role text not null default 'member',
  token_hash text not null unique,
  invited_by uuid references users(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists invites_org_idx on invites (org_id);

-- When a user accepted the Terms (version string).
alter table users add column if not exists terms_version text;
alter table users add column if not exists terms_accepted_at timestamptz;
`;
