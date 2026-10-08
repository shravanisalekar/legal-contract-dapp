import { useEffect, useState } from "react";
import Shell from "../components/Shell";
import api from "../api";

export default function AuditTrail() {
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    api.get("/audit").then((r) => setLogs(r.data.logs));
    api.get("/audit/dashboard").then((r) => setStats(r.data));
  }, []);

  return (
    <Shell>
      <h1>Audit Trail</h1>

      {stats && (
        <div className="grid-2" style={{ marginBottom: 20 }}>
          <div className="ledger-card">
            <h3>Contracts by status</h3>
            {stats.byStatus.map((s) => (
              <div className="ledger-row" key={s.status}><div>{s.status}</div><div>{s.count}</div></div>
            ))}
          </div>
          <div className="ledger-card">
            <h3>Overview</h3>
            <div className="ledger-row"><div>Total contracts</div><div>{stats.totalContracts}</div></div>
            <div className="ledger-row"><div>Total vendors</div><div>{stats.totalVendors}</div></div>
            <div className="ledger-row"><div>Pending KYC</div><div>{stats.pendingKyc}</div></div>
          </div>
        </div>
      )}

      <div className="ledger-card">
        <h2>Global event log</h2>
        <table>
          <thead><tr><th>Contract</th><th>Event</th><th>Actor</th><th>Tx</th><th>When</th></tr></thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.id}>
                <td>{l.contract_title || "-"}</td>
                <td>{l.event_type}</td>
                <td>{l.actor_name} <span className="muted">({l.actor_role})</span></td>
                <td className="mono">{l.chain_tx_hash ? `${l.chain_tx_hash.slice(0, 10)}...` : "-"}</td>
                <td className="muted">{new Date(l.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
