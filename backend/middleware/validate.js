const Joi = require("joi");

/**
 * Generic middleware factory: validates req.body against a Joi schema.
 * Rejects the request BEFORE any business logic or DB write runs.
 * This is Layer 2 of the 4-layer validation model (frontend, backend,
 * smart contract, cryptographic).
 */
function validateBody(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      return res.status(400).json({
        error: "Validation failed",
        details: error.details.map((d) => d.message)
      });
    }

    req.body = value;
    next();
  };
}

const ETH_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const HEX_HASH = /^0x[a-fA-F0-9]{64}$/;

// tlds: { allow: false } turns off Joi's public-suffix-list check on the
// domain part of an email. Without this, Joi rejects perfectly valid-looking
// addresses on internal/test domains (e.g. admin@enterprise.test) because
// ".test" isn't a registered public TLD. Standard emails like @gmail.com or
// a real company domain are unaffected either way - this only widens what's
// accepted, it never narrows it.
const EMAIL_RULE = Joi.string().email({ tlds: { allow: false } }).required();

const schemas = {
  register: Joi.object({
    name: Joi.string().min(2).max(100).required(),

    email: EMAIL_RULE,

    password: Joi.string().min(8).max(72).required()
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).+$/)
      .message(
        "Password must be 8-72 characters with upper and lower case letters, a number and a special character"
      ),

    role: Joi.string().valid(
      "SUPER_ADMIN",
      "BUYER",
      "DEPT_APPROVER",
      "FINANCE_APPROVER",
      "LEGAL_APPROVER",
      "VENDOR",
      "AUDITOR"
    ).required(),

    walletAddress: Joi.string().pattern(ETH_ADDRESS).required()
      .messages({
        "string.pattern.base":
          "walletAddress must be a valid 0x Ethereum address"
      }),

    department: Joi.string().max(100).allow("", null)
  }),

  login: Joi.object({
    email: EMAIL_RULE,
    password: Joi.string().required()
  }),

  createContract: Joi.object({
    title: Joi.string().min(3).max(200).required(),

    templateType: Joi.string().valid(
      "GOODS_SUPPLY",
      "SERVICE_AGREEMENT",
      "AMC_MAINTENANCE"
    ).required(),

    vendorId: Joi.string().required(),

    clauses: Joi.object({
      scopeOfWork: Joi.string().min(10).required(),
      paymentTerms: Joi.string().min(5).required(),
      confidentiality: Joi.string().allow("", null),
      terminationTerms: Joi.string().allow("", null)
    }).required(),

    milestones: Joi.array().items(
      Joi.object({
        description: Joi.string().min(3).required(),
        amountEth: Joi.number().positive().required(),
        dueDate: Joi.date().iso().greater("now").required(),
        penaltyBps: Joi.number().integer().min(0).max(10000).default(0)
      })
    ).min(1).required(),

    approverIds: Joi.array().items(Joi.string()).min(1).max(5).required(),

    requiredApprovals: Joi.number().integer().min(1).max(5).required()
  }),

  clauseProposal: Joi.object({
    clauseKey: Joi.string().valid(
      "scopeOfWork",
      "paymentTerms",
      "confidentiality",
      "terminationTerms"
    ).required(),

    newValue: Joi.string().min(3).required()
  }),

  anchorDocMeta: Joi.object({
    label: Joi.string().min(2).max(150).required(),
    docHash: Joi.string().pattern(HEX_HASH).required(),
    milestoneId: Joi.string().allow(null, "")
  }),

  recordChainTx: Joi.object({
    contractId: Joi.string().required(),
    eventType: Joi.string().required(),
    txHash: Joi.string().pattern(/^0x[a-fA-F0-9]{64}$/).required(),
    details: Joi.object().unknown(true).default({})
  }),

  kycReview: Joi.object({
    userId: Joi.string().required(),
    decision: Joi.string().valid("VERIFIED", "REJECTED").required()
  })
};

module.exports = {
  validateBody,
  schemas,
  ETH_ADDRESS,
  HEX_HASH
};