const express = require("express");
const db = require("../db/db");
const { requireAuth, requireRole } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// GET /api/users/vendors - verified vendors only, for the "select vendor" dropdown
router.get("/vendors", requireRole("BUYER", "SUPER_ADMIN"), (req, res) => {
  const vendors = db.prepare(
    "SELECT id, name, email, wallet_address, kyc_status FROM users WHERE role = 'VENDOR' AND kyc_status = 'VERIFIED'"
  ).all();
  res.json({ vendors });
});

// GET /api/users/approvers - all approver-role users, for building an approval chain
router.get("/approvers", requireRole("BUYER", "SUPER_ADMIN"), (req, res) => {
  const approvers = db.prepare(
    "SELECT id, name, email, wallet_address, role, department FROM users WHERE role IN ('DEPT_APPROVER','FINANCE_APPROVER','LEGAL_APPROVER')"
  ).all();
  res.json({ approvers });
});

// GET /api/users/me
router.get("/me", (req, res) => {
  const user = db.prepare(
    "SELECT id, name, email, role, wallet_address, kyc_status, department FROM users WHERE id = ?"
  ).get(req.user.id);
  res.json({ user });
});

module.exports = router;
