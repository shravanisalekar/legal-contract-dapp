const express = require("express");
const db = require("../db/db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validateBody, schemas } = require("../middleware/validate");
const { v4: uuidv4 } = require("uuid");

const router = express.Router();

// All admin routes require SUPER_ADMIN role.
router.use(requireAuth, requireRole("SUPER_ADMIN"));

// GET /api/admin/users - list everyone, for the admin dashboard
router.get("/users", (req, res) => {
  const users = db.prepare(
    "SELECT id, name, email, role, wallet_address, kyc_status, department, created_at FROM users ORDER BY created_at DESC"
  ).all();
  res.json({ users });
});

// GET /api/admin/pending-kyc - vendors awaiting whitelist decision
router.get("/pending-kyc", (req, res) => {
  const users = db.prepare(
    "SELECT id, name, email, wallet_address, kyc_status, created_at FROM users WHERE role='VENDOR' AND kyc_status='PENDING'"
  ).all();
  res.json({ users });
});

// POST /api/admin/kyc-review
// NOTE: This records the admin's *decision* off-chain. The admin must still
// call ContractFactory.setVendorWhitelist(vendorWallet, true) from their own
// wallet in the frontend Admin panel for it to take effect on-chain -
// this keeps the on-chain whitelist authoritative rather than backend-trusted.
router.post("/kyc-review", validateBody(schemas.kycReview), (req, res) => {
  const { userId, decision } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  if (user.role !== "VENDOR") return res.status(400).json({ error: "KYC review only applies to vendors" });

  db.prepare("UPDATE users SET kyc_status = ? WHERE id = ?").run(decision, userId);

  db.prepare(`INSERT INTO audit_logs (id, contract_id, event_type, actor_id, details_json)
              VALUES (?, NULL, 'KYC_REVIEW', ?, ?)`)
    .run(uuidv4(), req.user.id, JSON.stringify({ userId, decision }));

  res.json({ message: `Vendor KYC marked ${decision}. Remember to confirm the on-chain whitelist transaction in your wallet.` });
});

module.exports = router;
