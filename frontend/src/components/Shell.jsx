import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const NAV_BY_ROLE = {
  SUPER_ADMIN: [
    { to: "/dashboard", label: "Dashboard" },
    { to: "/admin", label: "Admin — Users & KYC" },
    { to: "/audit", label: "Audit Trail" }
  ],
  BUYER: [
    { to: "/dashboard", label: "My Contracts" },
    { to: "/contracts/new", label: "New Contract" }
  ],
  VENDOR: [
    { to: "/dashboard", label: "My Contracts" }
  ],
  DEPT_APPROVER: [{ to: "/dashboard", label: "Approvals Queue" }],
  FINANCE_APPROVER: [{ to: "/dashboard", label: "Approvals Queue" }],
  LEGAL_APPROVER: [{ to: "/dashboard", label: "Approvals Queue" }],
  AUDITOR: [
    { to: "/dashboard", label: "Contracts (Read-only)" },
    { to: "/audit", label: "Audit Trail" }
  ]
};

export default function Shell({ children }) {
  const { user, walletAddress, walletWarning, connect, logout } = useAuth();
  const location = useLocation();
  const navItems = NAV_BY_ROLE[user?.role] || [];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          Contract Ledger
          <small>Vendor &amp; Procurement Lifecycle</small>
        </div>
        <ul className="nav-list">
          {navItems.map((item) => (
            <li key={item.to}>
              <Link to={item.to} className={location.pathname === item.to ? "active" : ""}>
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="sidebar-footer">
          <div style={{ marginBottom: 8 }}>{user?.name}</div>
          <button className="btn btn-outline btn-sm" style={{ color: "#E6E2D6", borderColor: "#57606a", width: "100%" }} onClick={logout}>
            Log out
          </button>
        </div>
      </aside>
      <main className="main">
        <div className="topbar">
          <div>
            <span className="role-pill">{user?.role}</span>
          </div>
          <div>
            {walletAddress ? (
              <span className="mono muted">{walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}</span>
            ) : (
              <button className="btn btn-brass btn-sm" onClick={connect}>Connect Wallet</button>
            )}
          </div>
        </div>
        {walletWarning && <div className="callout error">{walletWarning}</div>}
        {children}
      </main>
    </div>
  );
}
