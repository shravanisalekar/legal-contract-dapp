const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "..", "data.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// ---------------------------------------------------------------------
// Schema. Kept deliberately explicit (no ORM) so it's easy to read/defend
// in a viva and easy to inspect directly with a SQLite browser.
// ---------------------------------------------------------------------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN (
                  'SUPER_ADMIN','BUYER','DEPT_APPROVER','FINANCE_APPROVER',
                  'LEGAL_APPROVER','VENDOR','AUDITOR'
                )),
  wallet_address TEXT UNIQUE,
  kyc_status    TEXT NOT NULL DEFAULT 'NOT_SUBMITTED' CHECK (kyc_status IN (
                  'NOT_SUBMITTED','PENDING','VERIFIED','REJECTED'
                )),
  department    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contracts (
  id                  TEXT PRIMARY KEY,
  title               TEXT NOT NULL,
  template_type       TEXT NOT NULL,
  buyer_id            TEXT NOT NULL REFERENCES users(id),
  vendor_id           TEXT NOT NULL REFERENCES users(id),
  status              TEXT NOT NULL DEFAULT 'DRAFT',
  chain_address       TEXT,
  total_value_wei     TEXT,
  current_version     INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contract_versions (
  id            TEXT PRIMARY KEY,
  contract_id   TEXT NOT NULL REFERENCES contracts(id),
  version_no    INTEGER NOT NULL,
  content_json  TEXT NOT NULL,
  doc_hash      TEXT NOT NULL,
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS clause_proposals (
  id            TEXT PRIMARY KEY,
  contract_id   TEXT NOT NULL REFERENCES contracts(id),
  clause_key    TEXT NOT NULL,
  proposed_by   TEXT NOT NULL REFERENCES users(id),
  old_value     TEXT,
  new_value     TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACCEPTED','REJECTED')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS milestones (
  id              TEXT PRIMARY KEY,
  contract_id     TEXT NOT NULL REFERENCES contracts(id),
  milestone_index INTEGER NOT NULL,
  description     TEXT NOT NULL,
  amount_wei      TEXT NOT NULL,
  due_date        TEXT NOT NULL,
  penalty_bps     INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','DELIVERED','PAID')),
  delivery_doc_hash TEXT
);

CREATE TABLE IF NOT EXISTS documents (
  id            TEXT PRIMARY KEY,
  contract_id   TEXT NOT NULL REFERENCES contracts(id),
  milestone_id  TEXT REFERENCES milestones(id),
  label         TEXT NOT NULL,
  file_path     TEXT NOT NULL,
  doc_hash      TEXT NOT NULL,
  uploaded_by   TEXT NOT NULL REFERENCES users(id),
  chain_tx_hash TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS approvals (
  id              TEXT PRIMARY KEY,
  contract_id     TEXT NOT NULL REFERENCES contracts(id),
  approver_id     TEXT NOT NULL REFERENCES users(id),
  approval_level  TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  chain_tx_hash   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id            TEXT PRIMARY KEY,
  contract_id   TEXT REFERENCES contracts(id),
  event_type    TEXT NOT NULL,
  actor_id      TEXT REFERENCES users(id),
  chain_tx_hash TEXT,
  details_json  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  message     TEXT NOT NULL,
  read_status INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

module.exports = db;
