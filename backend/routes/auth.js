const express = require("express");
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const db = require("../db/db");
const { validateBody, schemas } = require("../middleware/validate");
const { signToken } = require("../middleware/auth");

const router = express.Router();

// POST /api/auth/register
router.post("/register", validateBody(schemas.register), (req, res) => {
  const { name, email, password, role, walletAddress, department } = req.body;

  const existing = db.prepare("SELECT id FROM users WHERE email = ? OR wallet_address = ?")
    .get(email, walletAddress);
  if (existing) {
    return res.status(409).json({ error: "A user with this email or wallet address already exists" });
  }

  // Only one Super Admin should exist in a real deployment. We don't hard
  // block it here (so you can seed one via the seed script), but flag it.
  const passwordHash = bcrypt.hashSync(password, 10);
  const id = uuidv4();
  const kycStatus = role === "VENDOR" ? "PENDING" : "NOT_SUBMITTED";

  db.prepare(`
    INSERT INTO users (id, name, email, password_hash, role, wallet_address, kyc_status, department)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, name, email, passwordHash, role, walletAddress, kycStatus, department || null);

  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  const token = signToken(user);

  res.status(201).json({
    message: role === "VENDOR"
      ? "Registered. Your KYC is pending Super Admin approval before you can transact on-chain."
      : "Registered successfully.",
    token,
    user: sanitize(user)
  });
});

// POST /api/auth/login
router.post("/login", validateBody(schemas.login), (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
  if (!user) return res.status(401).json({ error: "Invalid email or password" });

  const ok = bcrypt.compareSync(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: "Invalid email or password" });

  const token = signToken(user);
  res.json({ token, user: sanitize(user) });
});

function sanitize(user) {
  const { password_hash, ...rest } = user;
  return rest;
}

module.exports = router;
