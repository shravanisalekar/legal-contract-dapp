// One-off cleanup script.
// Deletes a contract whose chain_address no longer has any deployed code
// (e.g. because hardhat node was restarted and the local chain was wiped),
// along with all its child rows, so it stops cluttering "My Contracts".
//
// Usage:
//   cd backend
//   node cleanup-orphan.js 3fa74823-25b0-4844-82f4-2b1670329ec2
//
// Safe to run any time: only deletes rows tied to the exact contract id
// you pass in. Does not touch users, KYC status, or any other contract.

const Database = require("better-sqlite3");
const path = require("path");

const contractId = process.argv[2];
if (!contractId) {
  console.error("Usage: node cleanup-orphan.js <contract-id>");
  process.exit(1);
}

const db = new Database(path.join(__dirname, "data.sqlite"));

const contract = db.prepare("SELECT * FROM contracts WHERE id = ?").get(contractId);
if (!contract) {
  console.error(`No contract found with id ${contractId}`);
  process.exit(1);
}

console.log(`Deleting: "${contract.title}" (status: ${contract.status}, chain_address: ${contract.chain_address})`);

const tables = [
  "milestones", "documents", "approvals", "audit_logs",
  "clause_proposals", "contract_versions", "notifications"
];

const txn = db.transaction(() => {
  for (const t of tables) {
    const info = db.prepare(`DELETE FROM ${t} WHERE contract_id = ?`).run(contractId);
    if (info.changes) console.log(`  removed ${info.changes} row(s) from ${t}`);
  }
  db.prepare("DELETE FROM contracts WHERE id = ?").run(contractId);
  console.log("  removed the contract record itself");
});

txn();
console.log("Done.");
