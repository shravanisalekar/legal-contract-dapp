/**
 * Run once after installing backend deps:  node seed.js
 * Creates one Super Admin account so you have a way to log in and
 * whitelist vendors / authorize buyers for the first time.
 *
 * IMPORTANT: change the walletAddress below to the FIRST account shown
 * when you run `npx hardhat node` (that account deployed ContractFactory
 * and is already the on-chain superAdmin).
 */
const bcrypt = require("bcryptjs");
const { v4: uuidv4 } = require("uuid");
const db = require("./db/db");

const SUPER_ADMIN = {
  name: "System Super Admin",
  email: "admin@enterprise.test",
  password: "Admin@12345",
  walletAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb9226" // placeholder, replace with Hardhat account #0 shown by `npx hardhat node`
};

const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(SUPER_ADMIN.email);
if (existing) {
  console.log("Super Admin already exists, skipping seed.");
  process.exit(0);
}

const id = uuidv4();
db.prepare(`
  INSERT INTO users (id, name, email, password_hash, role, wallet_address, kyc_status)
  VALUES (?, ?, ?, ?, 'SUPER_ADMIN', ?, 'VERIFIED')
`).run(id, SUPER_ADMIN.name, SUPER_ADMIN.email, bcrypt.hashSync(SUPER_ADMIN.password, 10), SUPER_ADMIN.walletAddress);

console.log("Seeded Super Admin:");
console.log("  email:   ", SUPER_ADMIN.email);
console.log("  password:", SUPER_ADMIN.password);
console.log("  wallet:  ", SUPER_ADMIN.walletAddress, "<- EDIT seed.js to match your Hardhat account #0 if different");
