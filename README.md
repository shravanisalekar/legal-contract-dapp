# Blockchain-Based Secure Legal Contract Lifecycle Management System
### Domain: Vendor & Supplier / Procurement — Enterprise DApp

A full-stack DApp: Solidity smart contracts (Hardhat), a Node/Express + SQLite
backend, and a React frontend that talks to both. MetaMask signs every
on-chain action, so every approval, signature, escrow deposit and payment
release is cryptographically tied to a real wallet.

This is a working core covering the full contract lifecycle end to end. It's
built to run as a **web app** (most reliable to set up and demo); see
"Packaging as a desktop app" at the bottom if you need a literal `.exe`/`.app`.

---

## 1. Architecture

```
                     ┌───────────────────────────┐
                     │        MetaMask            │
                     │  (signs every on-chain tx)  │
                     └──────────────┬──────────────┘
                                    │
   ┌────────────────┐   REST API   │   ethers.js      ┌───────────────────────┐
   │  React Frontend │◄────────────┼──────────────────►│  Hardhat local chain   │
   │  (Vite, :5173)  │              │                    │  ContractFactory       │
   └───────┬─────────┘              │                    │  ContractLifecycle     │
           │                        │                    └───────────────────────┘
           │ REST API (JWT)
           ▼
   ┌────────────────┐
   │ Express Backend │
   │   (:4000)       │
   │  - Auth/RBAC     │
   │  - Off-chain     │
   │    metadata      │
   │  - Doc hashing    │
   │  - Audit mirror   │
   └───────┬─────────┘
           ▼
   ┌────────────────┐
   │  SQLite DB       │
   └────────────────┘
```

**Why this split:** the smart contract is the *source of truth* for
lifecycle state, approvals, signatures, escrow and payments (nothing there
can be altered after the fact). The backend/DB hold richer off-chain data
(clause text, uploaded files, negotiation history) and mirror on-chain
events into an audit log, so the app doesn't need to re-query the chain for
every screen.

## 2. Roles

| Role | On-chain identity | What they do |
|---|---|---|
| Super Admin | `ContractFactory.superAdmin` | Whitelists vendor wallets after KYC, authorizes buyer wallets |
| Buyer / Procurement Officer | `ContractLifecycle.buyer` | Creates contracts, negotiates, signs, funds escrow, confirms delivery |
| Dept / Finance / Legal Approver | entries in `approvers[]` | Multi-level (+ multi-sig above a threshold) approval |
| Vendor | `ContractLifecycle.vendor` | Registers (KYC), negotiates, signs, delivers milestones |
| Auditor | off-chain role only | Read-only global audit trail & dashboard |

## 3. Validation — 4 layers

1. **Frontend** (`frontend/src/pages/*`) — required fields, regex checks, date logic, instant feedback.
2. **Backend API** (`backend/middleware/validate.js`, Joi schemas) — re-validates everything, enforces business rules (only KYC-verified vendors can be contracted, approver IDs must actually hold an approver role, etc). Never trusts the frontend.
3. **Smart contract** (`contracts/ContractLifecycle.sol`) — `require()` guards + role modifiers on every function; this is what protects the system even if someone calls the contract directly, bypassing the app entirely.
4. **Cryptographic** — every approval/signature/payment release is a transaction signed by the actor's own wallet; document hashes (SHA-256, computed server-side, never trusted from the client) are anchored on-chain so any tampering is detectable via the "Verify integrity" button.

## 4. Prerequisites

- Node.js 18+ and npm
- [MetaMask](https://metamask.io/) browser extension
- Git (optional)

## 5. Setup — step by step

### 5.1 Install & compile the smart contracts

```bash
cd legal-contract-dapp
npm install
npx hardhat compile
npx hardhat test          # confirm everything passes (18+ tests covering RBAC, multi-sig, escrow, penalty, disputes)
```

### 5.2 Start a local blockchain

Open a **new terminal** and leave this running the whole time you develop/demo:

```bash
npx hardhat node
```

This prints 20 funded test accounts with their addresses **and private
keys**. Keep this terminal open — copy a few of these addresses/keys, you'll
assign one to each role (Super Admin, Buyer, Vendor, 3x Approver) in the app.

### 5.3 Deploy the contracts

In your original terminal:

```bash
npm run deploy:local
```

This deploys `ContractFactory` (deployer = Super Admin) and writes:
- `deployed/factory-address.json` — the factory's address
- `deployed/ContractFactory.abi.json`
- `deployed/ContractLifecycle.abi.json`

Copy the two ABI files into the frontend:

```bash
cp deployed/ContractFactory.abi.json frontend/src/abi/
cp deployed/ContractLifecycle.abi.json frontend/src/abi/
```

### 5.4 Configure MetaMask

- Add a network: **Hardhat Local** — RPC URL `http://127.0.0.1:8545`, Chain ID `1337`, currency `ETH`.
- Import at least 2 of the private keys printed by `hardhat node` (Account #0 is the Super Admin/deployer; import a couple more for your Buyer and Vendor test users). You can add more later for approvers.

### 5.5 Backend

```bash
cd backend
npm install
cp .env.example .env       # edit JWT_SECRET to any long random string
```

Edit `seed.js`: replace the placeholder `walletAddress` with **Hardhat
Account #0** (the one that deployed the factory, printed by `hardhat node`
and also written into `deployed/factory-address.json` as `superAdmin`).

```bash
node seed.js                # creates the Super Admin login
npm run dev                 # starts on http://localhost:4000
```

Super Admin login: `admin@enterprise.test` / `Admin@12345`

### 5.6 Frontend

```bash
cd frontend
npm install
cp .env.example .env
```

Edit `.env`: set `VITE_FACTORY_ADDRESS` to the address from
`deployed/factory-address.json`.

```bash
npm run dev                 # starts on http://localhost:5173
```

Open `http://localhost:5173` in the browser where MetaMask is installed.

## 6. Demo script (suggested order)

1. **Log in as Super Admin** (seeded account). Go to Admin panel.
2. **Register a Vendor** and a **Buyer** (Register page) — for each, click
   "Fill from MetaMask" after switching MetaMask to that person's imported
   account, so their registered wallet matches what they'll sign with.
3. Register 2–3 **Approver** accounts (Dept/Finance/Legal), each with its
   own imported wallet.
4. Back in **Super Admin → Admin panel**: verify & whitelist the vendor
   (signs an on-chain tx), authorize the buyer.
5. **Log in as Buyer**, go to *New Contract*: pick the vendor, fill clauses,
   add 2 milestones, pick approvers + required approval count. Submit —
   this saves a draft, then asks MetaMask to deploy the on-chain contract.
6. Open the contract → **Documents** tab: upload a sample PDF, anchor its
   hash on-chain.
7. **Negotiation** tab: propose a clause change as buyer or vendor, accept
   it from the other role's login — creates version 2, re-hashed.
8. Vendor: **Submit for approval**.
9. Log in as each **Approver**: **Approvals** tab → Approve. Once enough
   approvals are in (per your multi-sig settings), status flips to Approved.
10. Buyer and Vendor each **sign** — status flips to Active.
11. Buyer **funds escrow**.
12. Vendor **marks a milestone delivered**; Buyer **confirms & releases**
    payment — watch the vendor's ETH balance change in MetaMask. Deliver
    the second milestone late to see the penalty auto-deduct.
13. Try **Verify integrity** on an uploaded document — then (for a live demo
    of tamper detection) manually edit the file in
    `backend/uploads/` and click Verify again to see it flip to failed.
14. **Raise a dispute**, have 2 approvers vote, watch it resolve.
15. Log in as **Auditor** (register one) to show the read-only global audit
    trail and dashboard stats.

## 7. Project structure

```
legal-contract-dapp/
├── contracts/              Solidity smart contracts
│   ├── ContractLifecycle.sol
│   └── ContractFactory.sol
├── scripts/deploy.js
├── test/ContractLifecycle.test.js
├── backend/
│   ├── server.js
│   ├── db/db.js             SQLite schema
│   ├── middleware/          auth.js (JWT+RBAC), validate.js (Joi schemas)
│   ├── routes/               auth, admin, contracts, documents, users, audit
│   ├── utils/hash.js         SHA-256 document hashing
│   └── seed.js                creates the first Super Admin
└── frontend/
    ├── src/pages/            Login, Register, Dashboard, CreateContract,
    │                          ContractDetail, AdminPanel, AuditTrail
    ├── src/components/       Shell (nav), StatusBadge
    ├── src/context/          AuthContext
    ├── src/web3.js            wallet + contract connection helpers
    └── src/api.js              REST client
```

## 8. What's built vs. what's a natural next step

**Built (working core):**
RBAC across 7 roles · draft → negotiation → multi-level/multi-sig approval →
wallet e-signature → escrow funding → milestone delivery & confirmation →
automatic late-penalty deduction → dispute + approver arbitration voting ·
clause-level negotiation with version history · document hashing +
on-chain anchoring + tamper detection · full on-chain audit trail ·
4-layer validation.

**Good Phase-2 additions** (the report/synopsis you already have lists these
as differentiators — the codebase is structured so each slots in cleanly):
vendor performance scoring, QR/public verification link, NFT completion
certificate, email/in-app notifications, PDF/CSV compliance export,
contract renewal/amendment linking, analytics dashboard charts.

## 9. Packaging as a desktop app (optional)

The brief asked for a desktop application. The most reliable path for a
project deadline is to demo this as a local web app (above) — it's the same
code either way. If you specifically need a native window, wrap the built
frontend with Electron:

```bash
cd frontend
npm run build                     # outputs frontend/dist
npm install --save-dev electron
```

Add a minimal `frontend/electron.js` that opens a `BrowserWindow` loading
`dist/index.html`, plus an `electron-start` script in `package.json`. Keep
the backend and Hardhat node running separately (or spawn them from
Electron's main process) — Electron here is just a native shell around the
same React app talking to the same backend/blockchain.

## 10. Troubleshooting

- **"VITE_FACTORY_ADDRESS is not set"** — you skipped copying the address into `frontend/.env`.
- **Transactions revert with "Only a designated approver..."** — the wallet connected in MetaMask doesn't match the address you registered/were added as an approver with. Switch accounts in MetaMask.
- **"Vendor not KYC-whitelisted"** — Super Admin must both mark KYC "Verified" *and* confirm the resulting MetaMask transaction (it's a real on-chain write).
- **Backend won't start / better-sqlite3 errors** — run `npm install` again inside `backend/`; better-sqlite3 compiles a native module and needs build tools (on Windows, `npm install --global windows-build-tools` if it fails, or use WSL).
