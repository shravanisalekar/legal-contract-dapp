const express = require("express");
const db = require("../db/db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// GET /api/audit - global audit log (Auditor + Super Admin only, others 403)
router.get("/", (req, res) => {
  if (!["AUDITOR", "SUPER_ADMIN"].includes(req.user.role)) {
    return res.status(403).json({ error: "Only the Auditor or Super Admin can view the global audit log" });
  }
  const logs = db.prepare(`
    SELECT al.*, u.name as actor_name, u.role as actor_role, c.title as contract_title
    FROM audit_logs al
    LEFT JOIN users u ON u.id = al.actor_id
    LEFT JOIN contracts c ON c.id = al.contract_id
    ORDER BY al.created_at DESC
    LIMIT 500
  `).all();
  res.json({ logs });
});

// GET /api/audit/dashboard - simple aggregate stats for the admin/auditor dashboard
router.get("/dashboard", (req, res) => {
  if (!["AUDITOR", "SUPER_ADMIN"].includes(req.user.role)) {
    return res.status(403).json({ error: "Not permitted" });
  }
  const byStatus = db.prepare("SELECT status, COUNT(*) as count FROM contracts GROUP BY status").all();
  const totalContracts = db.prepare("SELECT COUNT(*) as count FROM contracts").get().count;
  const totalVendors = db.prepare("SELECT COUNT(*) as count FROM users WHERE role='VENDOR'").get().count;
  const pendingKyc = db.prepare("SELECT COUNT(*) as count FROM users WHERE role='VENDOR' AND kyc_status='PENDING'").get().count;

  res.json({ byStatus, totalContracts, totalVendors, pendingKyc });
});

module.exports = router;
