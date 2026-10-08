import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Shell from "../components/Shell";
import StatusBadge from "../components/StatusBadge";
import api from "../api";
import { useAuth } from "../context/AuthContext";
import { formatEther } from "ethers";

export default function Dashboard() {
  const { user } = useAuth();
  const [contracts, setContracts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get("/contracts")
      .then((res) => setContracts(res.data.contracts))
      .catch((err) => setError(err.response?.data?.error || "Failed to load contracts"))
      .finally(() => setLoading(false));
  }, []);

  return (
    <Shell>
      <h1>{user?.role === "VENDOR" ? "Contracts you're party to" : "Contracts"}</h1>
      {error && <div className="callout error">{error}</div>}
      <div className="ledger-card">
        {loading ? (
          <p className="muted">Loading...</p>
        ) : contracts.length === 0 ? (
          <div className="empty-state">
            No contracts yet.
            {user?.role === "BUYER" && <div style={{ marginTop: 10 }}><Link className="btn btn-brass btn-sm" to="/contracts/new">Create your first contract</Link></div>}
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Title</th>
                <th>Status</th>
                <th>Value</th>
                <th>On-chain</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {contracts.map((c) => (
                <tr key={c.id}>
                  <td>{c.title}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td>{c.total_value_wei ? `${formatEther(c.total_value_wei)} ETH` : "-"}</td>
                  <td className="mono">{c.chain_address ? `${c.chain_address.slice(0, 6)}...${c.chain_address.slice(-4)}` : "not deployed"}</td>
                  <td className="muted">{new Date(c.created_at).toLocaleDateString()}</td>
                  <td><Link className="btn btn-outline btn-sm" to={`/contracts/${c.id}`}>Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </Shell>
  );
}
