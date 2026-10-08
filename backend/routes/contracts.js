const express = require("express");
const { v4: uuidv4 } = require("uuid");
const db = require("../db/db");
const { requireAuth, requireRole } = require("../middleware/auth");
const { validateBody, schemas } = require("../middleware/validate");
const { sha256Hex } = require("../utils/hash");

const router = express.Router();
router.use(requireAuth);

const ROLE_TO_APPROVAL_LEVEL = {
  DEPT_APPROVER: "DEPARTMENT",
  FINANCE_APPROVER: "FINANCE",
  LEGAL_APPROVER: "LEGAL"
};

// POST /api/contracts - create a DRAFT contract (off-chain). The actual
// on-chain ContractFactory.createContract() call happens from the frontend
// (needs the buyer's wallet signature); the frontend then calls
// PATCH /:id/chain-address to link the deployed address back to this row.
router.post(
  "/",
  requireRole("BUYER"),
  validateBody(schemas.createContract),
  (req, res) => {
    const {
      title,
      templateType,
      vendorId,
      clauses,
      milestones,
      approverIds,
      requiredApprovals
    } = req.body;

    const vendor = db
      .prepare(
        "SELECT * FROM users WHERE id = ? AND role = 'VENDOR'"
      )
      .get(vendorId);

    if (!vendor) {
      return res.status(400).json({
        error: "Selected vendor does not exist"
      });
    }

    if (vendor.kyc_status !== "VERIFIED") {
      return res.status(400).json({
        error:
          "Vendor is not KYC-verified/whitelisted yet. Ask Super Admin to review them first."
      });
    }

    // Business-rule validation: every approverId must actually hold an approver role
    const approvers = approverIds.map((id) =>
      db
        .prepare("SELECT * FROM users WHERE id = ?")
        .get(id)
    );

    if (
      approvers.some(
        (a) => !a || !ROLE_TO_APPROVAL_LEVEL[a.role]
      )
    ) {
      return res.status(400).json({
        error:
          "All approverIds must belong to users with an approver role"
      });
    }

    if (requiredApprovals > approvers.length) {
      return res.status(400).json({
        error:
          "requiredApprovals cannot exceed the number of approvers selected"
      });
    }

    const contractId = uuidv4();

    const totalValueEth = milestones.reduce(
      (sum, m) => sum + m.amountEth,
      0
    );

    db.prepare(`
      INSERT INTO contracts (
        id,
        title,
        template_type,
        buyer_id,
        vendor_id,
        status,
        total_value_wei
      )
      VALUES (?, ?, ?, ?, ?, 'DRAFT', ?)
    `).run(
      contractId,
      title,
      templateType,
      req.user.id,
      vendorId,
      String(
        BigInt(
          Math.round(totalValueEth * 1e18)
        )
      )
    );

    const versionId = uuidv4();

    const contentJson = JSON.stringify({
      clauses,
      milestones,
      approverIds,
      requiredApprovals
    });

    const docHash = sha256Hex(
      Buffer.from(contentJson, "utf-8")
    );

    db.prepare(`
      INSERT INTO contract_versions (
        id,
        contract_id,
        version_no,
        content_json,
        doc_hash,
        created_by
      )
      VALUES (?, ?, 1, ?, ?, ?)
    `).run(
      versionId,
      contractId,
      contentJson,
      docHash,
      req.user.id
    );

    milestones.forEach((m, idx) => {
      db.prepare(`
        INSERT INTO milestones (
          id,
          contract_id,
          milestone_index,
          description,
          amount_wei,
          due_date,
          penalty_bps,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')
      `).run(
        uuidv4(),
        contractId,
        idx,
        m.description,
        String(
          BigInt(
            Math.round(m.amountEth * 1e18)
          )
        ),
        // SQLite cannot bind undefined.
        // Store NULL when no due date was provided.
        new Date(m.dueDate).toString(),
        m.penaltyBps || 0
      );
    });

    logAudit(
      contractId,
      "DRAFT_CREATED",
      req.user.id,
      {
        title,
        totalValueEth
      }
    );

    res.status(201).json({
      contractId,
      docHash,
      message:
        "Draft created. Next: deploy on-chain from the Create Contract screen (wallet signature required)."
    });
  }
);

// PATCH /api/contracts/:id/chain-address - link a deployed on-chain contract address
router.patch(
  "/:id/chain-address",
  requireRole("BUYER"),
  (req, res) => {
    const { chainAddress, txHash } = req.body;

    if (!chainAddress) {
      return res.status(400).json({
        error: "chainAddress is required"
      });
    }

    const contract = getOwnedContractOr404(
      req,
      res,
      "BUYER"
    );

    if (!contract) {
      return;
    }

    db.prepare(`
      UPDATE contracts
      SET
        chain_address = ?,
        status = 'NEGOTIATION',
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      chainAddress,
      req.params.id
    );

    logAudit(
      req.params.id,
      "DEPLOYED_ON_CHAIN",
      req.user.id,
      {
        chainAddress
      },
      txHash
    );

    res.json({
      message:
        "Contract linked to on-chain address.",
      chainAddress
    });
  }
);

// GET /api/contracts - list contracts visible to the current user's role
router.get("/", (req, res) => {
  let rows;

  if (
    req.user.role === "SUPER_ADMIN" ||
    req.user.role === "AUDITOR"
  ) {
    rows = db
      .prepare(
        "SELECT * FROM contracts ORDER BY created_at DESC"
      )
      .all();
  } else if (req.user.role === "BUYER") {
    rows = db
      .prepare(
        "SELECT * FROM contracts WHERE buyer_id = ? ORDER BY created_at DESC"
      )
      .all(req.user.id);
  } else if (req.user.role === "VENDOR") {
    rows = db
      .prepare(
        "SELECT * FROM contracts WHERE vendor_id = ? ORDER BY created_at DESC"
      )
      .all(req.user.id);
  } else if (
    ROLE_TO_APPROVAL_LEVEL[req.user.role]
  ) {
    rows = db
      .prepare(`
        SELECT DISTINCT c.*
        FROM contracts c
        JOIN contract_versions cv
          ON cv.contract_id = c.id
         AND cv.version_no = c.current_version
        WHERE cv.content_json LIKE '%' || ? || '%'
        ORDER BY c.created_at DESC
      `)
      .all(req.user.id);
  } else {
    rows = [];
  }

  res.json({
    contracts: rows
  });
});

// GET /api/contracts/:id - full detail incl. versions, milestones, documents, approvals, audit trail
router.get("/:id", (req, res) => {
  const contract = db
    .prepare(
      "SELECT * FROM contracts WHERE id = ?"
    )
    .get(req.params.id);

  if (!contract) {
    return res.status(404).json({
      error: "Contract not found"
    });
  }

  const versions = db
    .prepare(`
      SELECT *
      FROM contract_versions
      WHERE contract_id = ?
      ORDER BY version_no ASC
    `)
    .all(req.params.id);

  const milestones = db
    .prepare(`
      SELECT *
      FROM milestones
      WHERE contract_id = ?
      ORDER BY milestone_index ASC
    `)
    .all(req.params.id);

  const documents = db
    .prepare(`
      SELECT *
      FROM documents
      WHERE contract_id = ?
      ORDER BY created_at ASC
    `)
    .all(req.params.id);

  const approvals = db
    .prepare(`
      SELECT *
      FROM approvals
      WHERE contract_id = ?
      ORDER BY created_at ASC
    `)
    .all(req.params.id);

  const clauseProposals = db
    .prepare(`
      SELECT *
      FROM clause_proposals
      WHERE contract_id = ?
      ORDER BY created_at DESC
    `)
    .all(req.params.id);

  const auditTrail = db
    .prepare(`
      SELECT *
      FROM audit_logs
      WHERE contract_id = ?
      ORDER BY created_at ASC
    `)
    .all(req.params.id);

  const buyer = db
    .prepare(`
      SELECT
        id,
        name,
        email,
        wallet_address
      FROM users
      WHERE id = ?
    `)
    .get(contract.buyer_id);

  const vendor = db
    .prepare(`
      SELECT
        id,
        name,
        email,
        wallet_address
      FROM users
      WHERE id = ?
    `)
    .get(contract.vendor_id);

  res.json({
    contract,
    buyer,
    vendor,
    versions,
    milestones,
    documents,
    approvals,
    clauseProposals,
    auditTrail
  });
});

// POST /api/contracts/:id/clause-proposals - vendor or buyer proposes a clause edit during negotiation
router.post(
  "/:id/clause-proposals",
  validateBody(schemas.clauseProposal),
  (req, res) => {
    const contract = db
      .prepare(
        "SELECT * FROM contracts WHERE id = ?"
      )
      .get(req.params.id);

    if (!contract) {
      return res.status(404).json({
        error: "Contract not found"
      });
    }

    if (
      ![
        contract.buyer_id,
        contract.vendor_id
      ].includes(req.user.id)
    ) {
      return res.status(403).json({
        error:
          "Only the buyer or vendor on this contract can propose clause changes"
      });
    }

    if (
      contract.status !== "NEGOTIATION" &&
      contract.status !== "DRAFT"
    ) {
      return res.status(400).json({
        error: `Cannot propose clause changes while contract is in status ${contract.status}`
      });
    }

    const latestVersion = db
      .prepare(`
        SELECT *
        FROM contract_versions
        WHERE contract_id = ?
        ORDER BY version_no DESC
        LIMIT 1
      `)
      .get(req.params.id);

    const content = JSON.parse(
      latestVersion.content_json
    );

    const oldValue =
      content.clauses[req.body.clauseKey] || "";

    const id = uuidv4();

    db.prepare(`
      INSERT INTO clause_proposals (
        id,
        contract_id,
        clause_key,
        proposed_by,
        old_value,
        new_value,
        status
      )
      VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
    `).run(
      id,
      req.params.id,
      req.body.clauseKey,
      req.user.id,
      oldValue,
      req.body.newValue
    );

    logAudit(
      req.params.id,
      "CLAUSE_PROPOSED",
      req.user.id,
      {
        clauseKey: req.body.clauseKey
      }
    );

    res.status(201).json({
      proposalId: id
    });
  }
);

// POST /api/contracts/:id/clause-proposals/:proposalId/respond - accept/reject, creates new version on accept
router.post(
  "/:id/clause-proposals/:proposalId/respond",
  (req, res) => {
    const { decision } = req.body;

    if (
      !["ACCEPTED", "REJECTED"].includes(
        decision
      )
    ) {
      return res.status(400).json({
        error:
          "decision must be ACCEPTED or REJECTED"
      });
    }

    const contract = db
      .prepare(
        "SELECT * FROM contracts WHERE id = ?"
      )
      .get(req.params.id);

    if (!contract) {
      return res.status(404).json({
        error: "Contract not found"
      });
    }

    if (
      ![
        contract.buyer_id,
        contract.vendor_id
      ].includes(req.user.id)
    ) {
      return res.status(403).json({
        error:
          "Only the buyer or vendor can respond to a proposal"
      });
    }

    const proposal = db
      .prepare(`
        SELECT *
        FROM clause_proposals
        WHERE id = ?
          AND contract_id = ?
      `)
      .get(
        req.params.proposalId,
        req.params.id
      );

    if (!proposal) {
      return res.status(404).json({
        error: "Proposal not found"
      });
    }

    if (
      proposal.proposed_by === req.user.id
    ) {
      return res.status(400).json({
        error:
          "You cannot respond to your own proposal"
      });
    }

    db.prepare(`
      UPDATE clause_proposals
      SET status = ?
      WHERE id = ?
    `).run(
      decision,
      proposal.id
    );

    if (decision === "ACCEPTED") {
      const latestVersion = db
        .prepare(`
          SELECT *
          FROM contract_versions
          WHERE contract_id = ?
          ORDER BY version_no DESC
          LIMIT 1
        `)
        .get(req.params.id);

      const content = JSON.parse(
        latestVersion.content_json
      );

      if (!content.clauses) {
        content.clauses = {};
      }

      content.clauses[
        proposal.clause_key
      ] = proposal.new_value;

      const newVersionNo =
        latestVersion.version_no + 1;

      const contentJson =
        JSON.stringify(content);

      const docHash = sha256Hex(
        Buffer.from(contentJson, "utf-8")
      );

      db.prepare(`
        INSERT INTO contract_versions (
          id,
          contract_id,
          version_no,
          content_json,
          doc_hash,
          created_by
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        uuidv4(),
        req.params.id,
        newVersionNo,
        contentJson,
        docHash,
        req.user.id
      );

      db.prepare(`
        UPDATE contracts
        SET
          current_version = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        newVersionNo,
        req.params.id
      );
    }

    logAudit(
      req.params.id,
      "CLAUSE_" + decision,
      req.user.id,
      {
        clauseKey: proposal.clause_key
      }
    );

    res.json({
      message: `Proposal ${decision.toLowerCase()}.`
    });
  }
);

// POST /api/contracts/:id/record-chain-tx - generic sync endpoint the frontend
// calls after ANY on-chain transaction succeeds, so off-chain status + the
// audit trail mirror the blockchain. The backend independently re-derives
// status text from eventType rather than trusting an arbitrary status string
// from the client.
router.post(
  "/:id/record-chain-tx",
  validateBody(schemas.recordChainTx),
  (req, res) => {
    const {
      eventType,
      txHash,
      details
    } = req.body;

    const contract = db
      .prepare(
        "SELECT * FROM contracts WHERE id = ?"
      )
      .get(req.params.id);

    if (!contract) {
      return res.status(404).json({
        error: "Contract not found"
      });
    }

    const STATUS_MAP = {
      SUBMITTED_FOR_APPROVAL:
        "PENDING_APPROVAL",
      APPROVED_FULLY:
        "APPROVED",
      BOTH_SIGNED:
        "ACTIVE",
      ESCROW_FUNDED:
        "ACTIVE",
      MILESTONE_DELIVERED:
        "ACTIVE",
      MILESTONE_PAID:
        "ACTIVE",
      DISPUTE_RAISED:
        "DISPUTED",
      DISPUTE_RESOLVED:
        "ACTIVE",
      COMPLETED:
        "COMPLETED",
      CLOSED:
        "CLOSED"
    };

    if (STATUS_MAP[eventType]) {
      db.prepare(`
        UPDATE contracts
        SET
          status = ?,
          updated_at = datetime('now')
        WHERE id = ?
      `).run(
        STATUS_MAP[eventType],
        req.params.id
      );
    }

    if (
      eventType === "APPROVAL_GIVEN" &&
      ROLE_TO_APPROVAL_LEVEL[req.user.role]
    ) {
      db.prepare(`
        INSERT INTO approvals (
          id,
          contract_id,
          approver_id,
          approval_level,
          status,
          chain_tx_hash
        )
        VALUES (?, ?, ?, ?, 'APPROVED', ?)
      `).run(
        uuidv4(),
        req.params.id,
        req.user.id,
        ROLE_TO_APPROVAL_LEVEL[
          req.user.role
        ],
        txHash
      );
    }

    if (
      eventType === "MILESTONE_DELIVERED" &&
      details.milestoneIndex !== undefined
    ) {
      db.prepare(`
        UPDATE milestones
        SET status = 'DELIVERED'
        WHERE contract_id = ?
          AND milestone_index = ?
      `).run(
        req.params.id,
        details.milestoneIndex
      );
    }

    if (
      eventType === "MILESTONE_PAID" &&
      details.milestoneIndex !== undefined
    ) {
      db.prepare(`
        UPDATE milestones
        SET status = 'PAID'
        WHERE contract_id = ?
          AND milestone_index = ?
      `).run(
        req.params.id,
        details.milestoneIndex
      );
    }

    logAudit(
      req.params.id,
      eventType,
      req.user.id,
      details,
      txHash
    );

    res.json({
      message: "Synced."
    });
  }
);

// ---- helpers ----

function getOwnedContractOr404(
  req,
  res,
  expectedRoleField
) {
  const contract = db
    .prepare(
      "SELECT * FROM contracts WHERE id = ?"
    )
    .get(req.params.id);

  if (!contract) {
    res.status(404).json({
      error: "Contract not found"
    });
    return null;
  }

  const ownerField =
    expectedRoleField === "BUYER"
      ? "buyer_id"
      : "vendor_id";

  if (contract[ownerField] !== req.user.id) {
    res.status(403).json({
      error: "Not your contract"
    });
    return null;
  }

  return contract;
}

function logAudit(
  contractId,
  eventType,
  actorId,
  details,
  txHash
) {
  db.prepare(`
    INSERT INTO audit_logs (
      id,
      contract_id,
      event_type,
      actor_id,
      chain_tx_hash,
      details_json
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    uuidv4(),
    contractId,
    eventType,
    actorId,
    txHash || null,
    JSON.stringify(details || {})
  );
}

module.exports = router;