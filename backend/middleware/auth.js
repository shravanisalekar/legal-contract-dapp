const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

/**
 * Layer 2 validation: verifies the JWT and attaches the authenticated
 * user's id/role/wallet to req.user. Every route below this must not
 * trust any role/identity claim coming from the request body.
 */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: "Missing or malformed Authorization header" });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { id, role, walletAddress, email }
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

/**
 * RBAC guard. Usage: requireRole('BUYER', 'SUPER_ADMIN')
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ error: `Role '${req.user.role}' is not permitted to perform this action` });
    }
    next();
  };
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, walletAddress: user.wallet_address, email: user.email, name: user.name },
    JWT_SECRET,
    { expiresIn: "12h" }
  );
}

module.exports = { requireAuth, requireRole, signToken, JWT_SECRET };
