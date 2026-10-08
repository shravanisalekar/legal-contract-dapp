-- =====================================================================
-- Blockchain-Based Secure Legal Contract Lifecycle Management System
-- PostgreSQL reference schema (production target)
--
-- NOTE: The backend ships configured with SQLite (backend/db/db.js) so it
-- runs with zero external setup for development/demo. This file is the
-- Postgres-equivalent schema — use it for your project report / ER diagram,
-- or point the backend at Postgres for a "real" deployment (swap
-- better-sqlite3 calls for a pg client; the table shapes below match
-- db.js exactly so the port is mechanical).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TYPE user_role AS ENUM (
  'SUPER_ADMIN','BUYER','DEPT_APPROVER','FINANCE_APPROVER',
  'LEGAL_APPROVER','VENDOR','AUDITOR'
);

CREATE TYPE kyc_status_t AS ENUM ('NOT_SUBMITTED','PENDING','VERIFIED','REJECTED');

CREATE TYPE contract_status_t AS ENUM (
  'DRAFT','NEGOTIATION','PENDING_APPROVAL','APPROVED',
  'ACTIVE','DISPUTED','COMPLETED','CLOSED'
);

CREATE TYPE proposal_status_t AS ENUM ('PENDING','ACCEPTED','REJECTED');
CREATE TYPE milestone_status_t AS ENUM ('PENDING','DELIVERED','PAID');
CREATE TYPE approval_status_t AS ENUM ('PENDING','APPROVED','REJECTED');

CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           VARCHAR(150) NOT NULL,
  email          VARCHAR(150) NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  role           user_role NOT NULL,
  wallet_address VARCHAR(42) UNIQUE,
  kyc_status     kyc_status_t NOT NULL DEFAULT 'NOT_SUBMITTED',
  department     VARCHAR(100),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contracts (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title            VARCHAR(200) NOT NULL,
  template_type    VARCHAR(50) NOT NULL,
  buyer_id         UUID NOT NULL REFERENCES users(id),
  vendor_id        UUID NOT NULL REFERENCES users(id),
  status           contract_status_t NOT NULL DEFAULT 'DRAFT',
  chain_address    VARCHAR(42),
  total_value_wei  NUMERIC(78,0),
  current_version  INTEGER NOT NULL DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE contract_versions (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id  UUID NOT NULL REFERENCES contracts(id),
  version_no   INTEGER NOT NULL,
  content_json JSONB NOT NULL,
  doc_hash     CHAR(66) NOT NULL,       -- 0x + 64 hex chars (keccak256/sha256)
  created_by   UUID NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (contract_id, version_no)
);

CREATE TABLE clause_proposals (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id  UUID NOT NULL REFERENCES contracts(id),
  clause_key   VARCHAR(100) NOT NULL,
  proposed_by  UUID NOT NULL REFERENCES users(id),
  old_value    TEXT,
  new_value    TEXT NOT NULL,
  status       proposal_status_t NOT NULL DEFAULT 'PENDING',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE milestones (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id       UUID NOT NULL REFERENCES contracts(id),
  milestone_index   INTEGER NOT NULL,
  description       TEXT NOT NULL,
  amount_wei        NUMERIC(78,0) NOT NULL,
  due_date          DATE NOT NULL,
  penalty_bps       INTEGER NOT NULL DEFAULT 0,   -- basis points, e.g. 500 = 5%
  status            milestone_status_t NOT NULL DEFAULT 'PENDING',
  delivery_doc_hash CHAR(66),
  UNIQUE (contract_id, milestone_index)
);

CREATE TABLE documents (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id   UUID NOT NULL REFERENCES contracts(id),
  milestone_id  UUID REFERENCES milestones(id),
  label         VARCHAR(150) NOT NULL,
  file_path     TEXT NOT NULL,
  doc_hash      CHAR(66) NOT NULL,
  uploaded_by   UUID NOT NULL REFERENCES users(id),
  chain_tx_hash CHAR(66),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE approvals (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id    UUID NOT NULL REFERENCES contracts(id),
  approver_id    UUID NOT NULL REFERENCES users(id),
  approval_level VARCHAR(30) NOT NULL,   -- DEPT / FINANCE / LEGAL / MULTISIG
  status         approval_status_t NOT NULL DEFAULT 'PENDING',
  chain_tx_hash  CHAR(66),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  contract_id   UUID REFERENCES contracts(id),
  event_type    VARCHAR(60) NOT NULL,
  actor_id      UUID REFERENCES users(id),
  chain_tx_hash CHAR(66),
  details_json  JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id),
  message     TEXT NOT NULL,
  read_status BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_contracts_buyer   ON contracts(buyer_id);
CREATE INDEX idx_contracts_vendor  ON contracts(vendor_id);
CREATE INDEX idx_contracts_status  ON contracts(status);
CREATE INDEX idx_audit_contract    ON audit_logs(contract_id);
CREATE INDEX idx_milestones_contract ON milestones(contract_id);
