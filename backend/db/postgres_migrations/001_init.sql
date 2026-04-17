CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_code VARCHAR(10) UNIQUE NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES entities(id),
  location_code VARCHAR(30) UNIQUE NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  city VARCHAR(80),
  state VARCHAR(80),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID NOT NULL REFERENCES entities(id),
  name VARCHAR(100) NOT NULL,
  short_code VARCHAR(20) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (entity_id, name),
  UNIQUE (entity_id, short_code)
);

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(60) UNIQUE NOT NULL,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(80) UNIQUE NOT NULL,
  label VARCHAR(150)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  emp_id VARCHAR(10) UNIQUE NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  entity_id UUID REFERENCES entities(id),
  dept_id UUID REFERENCES departments(id),
  location_id UUID REFERENCES locations(id),
  role_id UUID NOT NULL REFERENCES roles(id),
  google_sub VARCHAR(100),
  password_hash TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_entity_access (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, entity_id)
);

CREATE TABLE IF NOT EXISTS hostname_sequences (
  entity_id UUID NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  dept_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  next_seq INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (entity_id, dept_id)
);

CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_tag VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(150) NOT NULL,
  hostname VARCHAR(100) UNIQUE,
  category VARCHAR(50) NOT NULL,
  is_compute BOOLEAN NOT NULL DEFAULT FALSE,
  serial_number VARCHAR(100),
  model VARCHAR(100),
  entity_id UUID NOT NULL REFERENCES entities(id),
  assigned_to UUID REFERENCES users(id),
  dept_id UUID REFERENCES departments(id),
  location_id UUID REFERENCES locations(id),
  purchase_date DATE,
  warranty_until DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'in_use',
  condition VARCHAR(30) NOT NULL DEFAULT 'good',
  glpi_id INTEGER,
  salt_minion_id VARCHAR(100),
  wazuh_agent_id VARCHAR(50),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS asset_compute_details (
  asset_id UUID PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  processor TEXT,
  ram TEXT,
  storage TEXT,
  gpu TEXT,
  display TEXT,
  bios_version TEXT,
  mac_address TEXT,
  os_name TEXT,
  kernel TEXT,
  last_boot TIMESTAMPTZ,
  last_seen TIMESTAMPTZ,
  pending_updates INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS asset_software_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  name VARCHAR(150) NOT NULL,
  version VARCHAR(80),
  install_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS asset_network_snapshots (
  asset_id UUID PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  wired_ip INET,
  wireless_ip INET,
  netbird_ip INET,
  dns TEXT,
  gateway INET,
  interface_stats JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS asset_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id),
  action VARCHAR(60) NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS asset_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  source VARCHAR(30) NOT NULL,
  severity VARCHAR(20) NOT NULL,
  title VARCHAR(200) NOT NULL,
  detail TEXT,
  is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES users(id),
  entity_id UUID REFERENCES entities(id),
  action VARCHAR(60) NOT NULL,
  target_type VARCHAR(50),
  target_id UUID,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address INET,
  auth_method VARCHAR(20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_entity_id ON users(entity_id);
CREATE INDEX IF NOT EXISTS idx_users_dept_id ON users(dept_id);
CREATE INDEX IF NOT EXISTS idx_assets_entity_id ON assets(entity_id);
CREATE INDEX IF NOT EXISTS idx_assets_assigned_to ON assets(assigned_to);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_asset_history_asset_id ON asset_history(asset_id, created_at DESC);