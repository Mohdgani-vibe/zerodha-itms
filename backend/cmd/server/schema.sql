CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  short_code VARCHAR(10) UNIQUE NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID REFERENCES entities(id),
  location_code VARCHAR(30) UNIQUE NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  city VARCHAR(80),
  state VARCHAR(80),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id UUID REFERENCES entities(id),
  name VARCHAR(100) NOT NULL,
  short_code VARCHAR(20) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (entity_id, name)
);

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(60) UNIQUE NOT NULL,
  is_system BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(80) UNIQUE NOT NULL,
  label VARCHAR(150)
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id UUID REFERENCES roles(id),
  permission_id UUID REFERENCES permissions(id),
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
  role_id UUID REFERENCES roles(id),
  google_sub VARCHAR(100),
  password_hash TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_tag VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(150) NOT NULL,
  hostname VARCHAR(100) UNIQUE,
  category VARCHAR(50) NOT NULL,
  is_compute BOOLEAN DEFAULT FALSE,
  serial_number VARCHAR(100),
  model VARCHAR(100),
  entity_id UUID REFERENCES entities(id),
  assigned_to UUID REFERENCES users(id),
  dept_id UUID REFERENCES departments(id),
  location_id UUID REFERENCES locations(id),
  purchase_date DATE,
  warranty_until DATE,
  status VARCHAR(30) DEFAULT 'in_use',
  condition VARCHAR(30) DEFAULT 'good',
  glpi_id INTEGER,
  salt_minion_id VARCHAR(100),
  wazuh_agent_id VARCHAR(50),
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES users(id),
  entity_id UUID REFERENCES entities(id),
  action VARCHAR(60) NOT NULL,
  target_type VARCHAR(50),
  target_id UUID,
  detail JSONB,
  ip_address INET,
  auth_method VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT NOW()
);