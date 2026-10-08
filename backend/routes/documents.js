const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");
const db = require("../db/db");
const { requireAuth } = require("../middleware/auth");
const { sha256Hex } = require("../utils/hash");

const router = express.Router();
router.use(requireAuth);

const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${uuidv4()}-${file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, "_")}`)
});

const ALLOWED_MIME = ["application/pdf", "image/png", "image/jpeg"];
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB cap - basic validation against abuse
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.includes(file.mimetype)) {
      return cb(new Error("Only PDF, PNG or JPEG files are allowed"));
    }
    cb(null, true);
  }
});

// POST /api/documents/:contractId/upload
// Hashes the uploaded file server-side (never trust a client-supplied hash),
// stores it, and returns the hash for the frontend to anchor on-chain via
// ContractLifecycle.anchorDocument(). This is what makes tampering detectable:
// the hash embedded in the blockchain was computed by the server, not the client.
router.post("/:contractId/upload", upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const { label, milestoneId } = req.body;
  if (!label) return res.status(400).json({ error: "label is required" });

  const contract = db.prepare("SELECT * FROM contracts WHERE id = ?").get(req.params.contractId);
  if (!contract) return res.status(404).json({ error: "Contract not found" });
  if (![contract.buyer_id, contract.vendor_id].includes(req.user.id)) {
    return res.status(403).json({ error: "Only the buyer or vendor on this contract can upload documents" });
  }

  const buffer = fs.readFileSync(req.file.path);
  const docHash = sha256Hex(buffer);

  const id = uuidv4();
  db.prepare(`
    INSERT INTO documents (id, contract_id, milestone_id, label, file_path, doc_hash, uploaded_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, req.params.contractId, milestoneId || null, label, req.file.filename, docHash, req.user.id);

  res.status(201).json({
    documentId: id,
    docHash,
    message: "File stored and hashed. Now call anchorDocument() on-chain with this hash from your wallet."
  });
});

// POST /api/documents/:documentId/verify - re-hash the stored file and
// compare against the hash that was anchored on-chain, to detect tampering.
router.post("/:documentId/verify", (req, res) => {
  const { onChainHash } = req.body;
  const doc = db.prepare("SELECT * FROM documents WHERE id = ?").get(req.params.documentId);
  if (!doc) return res.status(404).json({ error: "Document not found" });

  const filePath = path.join(UPLOAD_DIR, doc.file_path);
  if (!fs.existsSync(filePath)) return res.status(410).json({ error: "Stored file missing on server" });

  const currentHash = sha256Hex(fs.readFileSync(filePath));
  const storedMatches = currentHash === doc.doc_hash;
  const chainMatches = onChainHash ? currentHash === onChainHash : null;

  res.json({
    documentId: doc.id,
    currentHash,
    storedHash: doc.doc_hash,
    storedMatches,
    chainMatches,
    verdict: storedMatches && (chainMatches === null || chainMatches)
      ? "AUTHENTIC - file unchanged since upload"
      : "TAMPERING DETECTED - file content does not match the recorded hash"
  });
});

// GET /api/documents/:contractId - list documents for a contract
router.get("/:contractId", (req, res) => {
  const docs = db.prepare("SELECT * FROM documents WHERE contract_id = ? ORDER BY created_at ASC").all(req.params.contractId);
  res.json({ documents: docs });
});

module.exports = router;
