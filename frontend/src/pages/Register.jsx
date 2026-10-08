import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { connectWallet, hasWallet } from "../web3";

const ROLES = [
  { value: "BUYER", label: "Buyer / Procurement Officer" },
  { value: "VENDOR", label: "Vendor / Supplier" },
  { value: "DEPT_APPROVER", label: "Department Approver" },
  { value: "FINANCE_APPROVER", label: "Finance Approver" },
  { value: "LEGAL_APPROVER", label: "Legal Approver" },
  { value: "AUDITOR", label: "Auditor (read-only)" },
  { value: "SUPER_ADMIN", label: "Super Admin" }
];

const ETH_ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    role: "BUYER",
    walletAddress: "",
    department: ""
  });

  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState(null);
  const [loading, setLoading] = useState(false);

  function update(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // ---- Frontend (Layer 1) validation: instant feedback before hitting the API ----
  function validate() {
    const e = {};

    if (form.name.trim().length < 2) {
      e.name = "Name must be at least 2 characters";
    }

    if (!/^\S+@\S+\.\S+$/.test(form.email)) {
      e.email = "Enter a valid email address";
    }

    if (
      form.password.length < 8 ||
      form.password.length > 72 ||
      !/[A-Z]/.test(form.password) ||
      !/[a-z]/.test(form.password) ||
      !/\d/.test(form.password) ||
      !/[^A-Za-z0-9]/.test(form.password)
    ) {
      e.password =
        "Password must be 8-72 characters with upper and lower case letters, a number and a special character";
    }

    if (!ETH_ADDRESS_RE.test(form.walletAddress)) {
      e.walletAddress =
        "Enter a valid 0x-prefixed Ethereum address (from MetaMask)";
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleConnectWallet() {
    try {
      if (!hasWallet()) {
        setApiError(
          "MetaMask not detected. Install it, or paste your address manually."
        );
        return;
      }

      const { address } = await connectWallet();
      update("walletAddress", address);
    } catch (err) {
      setApiError(err.message);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setApiError(null);

    if (!validate()) return;

    setLoading(true);

    try {
      await register(form);
      navigate("/dashboard");
    } catch (err) {
      setApiError(
        err.response?.data?.error ||
          err.response?.data?.details?.join(", ") ||
          "Registration failed"
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-shell" style={{ maxWidth: 480 }}>
      <h1>Register</h1>

      <div className="ledger-card">
        {apiError && <div className="callout error">{apiError}</div>}

        <form onSubmit={handleSubmit}>
          <label>Full name</label>

          <input
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
          />

          {errors.name && (
            <div className="error-text">{errors.name}</div>
          )}

          <label>Email</label>

          <input
            type="email"
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
          />

          {errors.email && (
            <div className="error-text">{errors.email}</div>
          )}

          <label>Password</label>

          <input
            type="password"
            value={form.password}
            onChange={(e) => update("password", e.target.value)}
          />

          {errors.password && (
            <div className="error-text">{errors.password}</div>
          )}

          <label>Role</label>

          <select
            value={form.role}
            onChange={(e) => update("role", e.target.value)}
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>

          {["DEPT_APPROVER"].includes(form.role) && (
            <>
              <label>Department</label>

              <input
                value={form.department}
                onChange={(e) =>
                  update("department", e.target.value)
                }
                placeholder="e.g. Engineering"
              />
            </>
          )}

          <label>Wallet address</label>

          <div className="form-row">
            <div>
              <input
                value={form.walletAddress}
                onChange={(e) =>
                  update("walletAddress", e.target.value)
                }
                placeholder="0x..."
              />
            </div>
          </div>

          <button
            type="button"
            className="btn btn-outline btn-sm"
            style={{ marginTop: -10, marginBottom: 14 }}
            onClick={handleConnectWallet}
          >
            Fill from MetaMask
          </button>

          {errors.walletAddress && (
            <div className="error-text">
              {errors.walletAddress}
            </div>
          )}

          <div className="help-text">
            Every on-chain action (signing, approving, releasing payment)
            is verified against this address, so use the wallet you'll
            actually sign with.
          </div>

          <button
            className="btn btn-brass"
            type="submit"
            disabled={loading}
            style={{ width: "100%" }}
          >
            {loading ? "Creating account..." : "Create account"}
          </button>
        </form>
      </div>

      <p className="muted">
        Already registered? <Link to="/login">Sign in</Link>
      </p>
    </div>
  );
}