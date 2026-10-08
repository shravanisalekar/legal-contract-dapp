const crypto = require("crypto");

/**
 * SHA-256 hash of a file buffer, returned as a 0x-prefixed hex string so
 * it's directly comparable to hashes anchored on-chain (which use the same
 * hex representation, even though the contract stores them as bytes32).
 */
function sha256Hex(buffer) {
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  return "0x" + hash;
}

module.exports = { sha256Hex };
