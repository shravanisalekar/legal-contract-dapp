import { useEffect, useState } from "react";
import Shell from "../components/Shell";
import api from "../api";
import { connectWallet, getFactoryContract } from "../web3";

export default function AdminPanel() {
  const [users, setUsers] = useState([]);
  const [pendingKyc, setPendingKyc] = useState([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  function load() {
    api.get("/admin/users").then((r) => setUsers(r.data.users));
    api.get("/admin/pending-kyc").then((r) => setPendingKyc(r.data.users));
  }
  useEffect(load, []);

  async function reviewVendor(user, decision) {
    setBusy(true);
    setMsg(null);
    try {
      await api.post("/admin/kyc-review", { userId: user.id, decision });
      if (decision === "VERIFIED") {
        const { signer } = await connectWallet();
        const factory = await getFactoryContract(signer);
        const tx = await factory.setVendorWhitelist(user.wallet_address, true);
        await tx.wait();
      }
      setMsg({ type: "success", text: `${user.name} marked ${decision}${decision === "VERIFIED" ? " and whitelisted on-chain." : "."}` });
      load();
    } catch (err) {
      setMsg({ type: "error", text: err.reason || err.message || "Action failed" });
    } finally { setBusy(false); }
  }

  async function authorizeBuyer(user) {
    setBusy(true);
    setMsg(null);
    try {
      const { signer } = await connectWallet();
      const factory = await getFactoryContract(signer);
      const tx = await factory.setBuyerAuthorized(user.wallet_address, true);
      await tx.wait();
      setMsg({ type: "success", text: `${user.name} authorized as a buyer on-chain.` });
    } catch (err) {
      setMsg({ type: "error", text: err.reason || err.message || "Action failed" });
    } finally { setBusy(false); }
  }

  // Re-sends the on-chain whitelist call for a vendor that the database
  // already marks VERIFIED. Needed because restarting `hardhat node` wipes
  // the local chain's state (including this mapping) but does NOT touch
  // the off-chain database, so the two can drift out of sync after a
  // restart. This button re-syncs them without changing KYC status again.
  async function rewhitelistVendor(user) {
    setBusy(true);
    setMsg(null);
    try {
      const { signer } = await connectWallet();
      const factory = await getFactoryContract(signer);
      const tx = await factory.setVendorWhitelist(user.wallet_address, true);
      await tx.wait();
      setMsg({ type: "success", text: `${user.name} re-whitelisted on-chain.` });
    } catch (err) {
      setMsg({ type: "error", text: err.reason || err.message || "Action failed" });
    } finally { setBusy(false); }
  }

  return (
    <Shell>
      <h1>Admin — Users & KYC</h1>
      {msg && <div className={`callout ${msg.type}`}>{msg.text}</div>}

      <div className="ledger-card">
        <h2>Vendors pending KYC review</h2>
        {pendingKyc.length === 0 && <p className="muted">Nothing pending.</p>}
        {pendingKyc.map((v) => (
          <div className="ledger-row" key={v.id}>
            <div>
              <strong>{v.name}</strong> — {v.email}
              <div className="mono muted">{v.wallet_address}</div>
            </div>
            <div>
              <button className="btn btn-brass btn-sm" disabled={busy} onClick={() => reviewVendor(v, "VERIFIED")}>Verify & whitelist</button>
              <button className="btn btn-danger btn-sm" style={{ marginLeft: 8 }} disabled={busy} onClick={() => reviewVendor(v, "REJECTED")}>Reject</button>
            </div>
          </div>
        ))}
      </div>

      <div className="ledger-card">
        <h2>All users</h2>
        <table>
          <thead><tr><th>Name</th><th>Role</th><th>KYC</th><th>Wallet</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.name}</td>
                <td>{u.role}</td>
                <td>{u.kyc_status}</td>
                <td className="mono">{u.wallet_address?.slice(0, 10)}...</td>
                <td>
                  {u.role === "BUYER" && (
                    <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => authorizeBuyer(u)}>Authorize as buyer on-chain</button>
                  )}
                  {u.role === "VENDOR" && u.kyc_status === "VERIFIED" && (
                    <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => rewhitelistVendor(u)}>Re-sync whitelist on-chain</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Shell>
  );
}
