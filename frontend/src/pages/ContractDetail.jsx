import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import { formatEther } from "ethers";
import Shell from "../components/Shell";
import StatusBadge from "../components/StatusBadge";
import api from "../api";
import { useAuth } from "../context/AuthContext";
import {
  connectWallet,
  getLifecycleContract,
  ethToWei,
  contractExistsOnChain,
} from "../web3";

const STEPS = [
  "DRAFT",
  "NEGOTIATION",
  "PENDING_APPROVAL",
  "APPROVED",
  "ACTIVE",
  "COMPLETED",
  "CLOSED",
];

export default function ContractDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("overview");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  // null = not checked yet, true = contract found on-chain, false = missing
  // (most likely cause: a local hardhat node was restarted, which wipes
  // its chain and orphans every previously-deployed contract address)
  const [chainExists, setChainExists] = useState(null);

  const load = useCallback(() => {
    api.get(`/contracts/${id}`).then((r) => {
      setData(r.data);

      if (r.data?.contract?.chain_address) {
        contractExistsOnChain(r.data.contract.chain_address).then(
          setChainExists
        );
      }
    });
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (!data)
    return (
      <Shell>
        <p className="muted">Loading...</p>
      </Shell>
    );

  const {
    contract,
    buyer,
    vendor,
    versions,
    milestones,
    documents,
    approvals,
    clauseProposals,
    auditTrail,
  } = data;

  const latestVersion = versions[versions.length - 1];
  const clauses = latestVersion
    ? JSON.parse(latestVersion.content_json).clauses
    : {};

  const isBuyer = user.id === contract.buyer_id;
  const isVendor = user.id === contract.vendor_id;

  const isApprover = [
    "DEPT_APPROVER",
    "FINANCE_APPROVER",
    "LEGAL_APPROVER",
  ].includes(user.role);

  async function withWallet(action) {
    setMsg(null);
    setBusy(true);

    try {
      const { signer } = await connectWallet();
      const chain = await getLifecycleContract(
        contract.chain_address,
        signer
      );

      await action(chain, signer);
      load();
    } catch (err) {
      setMsg({
        type: "error",
        text: err.reason || err.message || "Transaction failed",
      });
    } finally {
      setBusy(false);
    }
  }

  async function syncEvent(eventType, txHash, details = {}) {
    await api.post(`/contracts/${id}/record-chain-tx`, {
      contractId: id,
      eventType,
      txHash,
      details,
    });
  }

  // Re-reads the real status straight off the blockchain and syncs it to the
  // database. Needed because the buttons above only trust contract.status
  // from the DB - if the auto-sync after a transaction ever fails (a flaky
  // read, a closed tab, a network hiccup), the DB can get stuck showing an
  // old status even though the chain has already moved on. This button
  // fixes that without re-sending any transaction, so it's always safe to
  // click, even if nothing is actually out of sync.
  const STATUS_NAMES = [
    "DRAFT",
    "NEGOTIATION",
    "PENDING_APPROVAL",
    "APPROVED",
    "ACTIVE",
    "DISPUTED",
    "COMPLETED",
    "CLOSED",
  ];

  const SYNC_EVENT_FOR_STATUS = {
    PENDING_APPROVAL: "SUBMITTED_FOR_APPROVAL",
    APPROVED: "APPROVED_FULLY",
    ACTIVE: "BOTH_SIGNED",
    DISPUTED: "DISPUTE_RAISED",
    COMPLETED: "COMPLETED",
    CLOSED: "CLOSED",
  };

  async function resyncStatusFromChain() {
    setMsg(null);
    setBusy(true);

    try {
      const { signer } = await connectWallet();

      const chain = await getLifecycleContract(
        contract.chain_address,
        signer
      );

      const onChainStatus =
        STATUS_NAMES[Number(await chain.status())];

      if (onChainStatus === contract.status) {
        setMsg({
          type: "success",
          text: `Already in sync (${onChainStatus}).`,
        });
      } else if (SYNC_EVENT_FOR_STATUS[onChainStatus]) {
        await syncEvent(
          SYNC_EVENT_FOR_STATUS[onChainStatus],
          null,
          { resync: true }
        );

        setMsg({
          type: "success",
          text: `Synced: database was ${contract.status}, chain says ${onChainStatus}. Fixed.`,
        });

        load();
      }
    } catch (err) {
      setMsg({
        type: "error",
        text:
          err.reason ||
          err.message ||
          "Could not read chain status",
      });
    } finally {
      setBusy(false);
    }
  }

  async function closeContract() {
    await withWallet(async (chain) => {
      const tx = await chain.closeContract();
      const r = await tx.wait();

      await syncEvent("CLOSED", r.hash);

      setMsg({
        type: "success",
        text: "Contract closed.",
      });
    });
  }

  async function submitForApproval() {
    await withWallet(async (chain) => {
      const tx = await chain.submitForApproval();
      const r = await tx.wait();

      await syncEvent("SUBMITTED_FOR_APPROVAL", r.hash);

      setMsg({
        type: "success",
        text: "Submitted for approval.",
      });
    });
  }

  async function approve() {
    await withWallet(async (chain) => {
      const tx = await chain.approve();
      const r = await tx.wait();

      await syncEvent("APPROVAL_GIVEN", r.hash);

      const status = await chain.status();

      if (Number(status) === 3) {
        await syncEvent("APPROVED_FULLY", r.hash);
      }

      setMsg({
        type: "success",
        text: "Approval recorded on-chain.",
      });
    });
  }

  async function signContract() {
    await withWallet(async (chain) => {
      const tx = isBuyer
        ? await chain.signAsBuyer()
        : await chain.signAsVendor();

      const r = await tx.wait();
      const status = await chain.status();

      await syncEvent(
        Number(status) === 4 ? "BOTH_SIGNED" : "SIGNED",
        r.hash
      );

      setMsg({
        type: "success",
        text: "Signature recorded on-chain.",
      });
    });
  }

  async function fundEscrow() {
    const amount = prompt(
      "Enter amount to deposit into escrow (ETH):",
      formatEther(contract.total_value_wei || "0")
    );

    if (!amount) return;

    await withWallet(async (chain) => {
      const tx = await chain.fundEscrow({
        value: ethToWei(amount),
      });

      const r = await tx.wait();

      await syncEvent("ESCROW_FUNDED", r.hash, {
        amountEth: amount,
      });

      setMsg({
        type: "success",
        text: `Deposited ${amount} ETH into escrow.`,
      });
    });
  }

  async function markDelivered(index) {
    await withWallet(async (chain) => {
      const tx = await chain.markMilestoneDelivered(index);
      const r = await tx.wait();

      await syncEvent("MILESTONE_DELIVERED", r.hash, {
        milestoneIndex: index,
      });

      setMsg({
        type: "success",
        text: "Milestone marked delivered.",
      });
    });
  }

  async function confirmAndRelease(index) {
    await withWallet(async (chain) => {
      const tx = await chain.confirmAndRelease(index);
      const r = await tx.wait();

      await syncEvent("MILESTONE_PAID", r.hash, {
        milestoneIndex: index,
      });

      const status = await chain.status();

      if (Number(status) === 6) {
        await syncEvent("COMPLETED", r.hash);
      }

      setMsg({
        type: "success",
        text: "Payment released to vendor.",
      });
    });
  }

  async function raiseDispute() {
    const reason = prompt(
      "Describe the reason for the dispute:"
    );

    if (!reason) return;

    await withWallet(async (chain) => {
      const tx = await chain.raiseDispute(reason);
      const r = await tx.wait();

      await syncEvent("DISPUTE_RAISED", r.hash, {
        reason,
      });

      setMsg({
        type: "success",
        text: "Dispute raised. Approvers will vote to resolve it.",
      });
    });
  }

  async function voteArbitration(winnerAddress) {
    await withWallet(async (chain) => {
      const tx = await chain.arbitrationVoteFor(winnerAddress);
      const r = await tx.wait();

      const status = await chain.status();

      if (Number(status) === 4) {
        await syncEvent("DISPUTE_RESOLVED", r.hash, {
          winner: winnerAddress,
        });
      }

      setMsg({
        type: "success",
        text: "Arbitration vote recorded.",
      });
    });
  }

  return (
    <Shell>
      <div className="topbar" style={{ marginBottom: 6 }}>
        <div>
          <h1 style={{ marginBottom: 4 }}>{contract.title}</h1>

          <StatusBadge status={contract.status} />

          <span
            className="muted"
            style={{ marginLeft: 10 }}
          >
            {buyer.name} → {vendor.name}
          </span>
        </div>
      </div>

      <div className="stepper">
        {STEPS.map((s, i) => (
          <div
            key={s}
            className={`step ${
              STEPS.indexOf(contract.status) > i
                ? "done"
                : STEPS.indexOf(contract.status) === i
                ? "current"
                : ""
            }`}
          >
            {s.replace("_", " ")}
          </div>
        ))}
      </div>

      {contract.chain_address ? (
        <>
          <p
            className="mono muted"
            style={{ marginTop: -14 }}
          >
            On-chain address: {contract.chain_address}
          </p>

          {chainExists === false && (
            <div
              className="callout error"
              style={{ marginBottom: 12 }}
            >
              ⚠ On-chain contract not found at this address.
              This almost always means the local blockchain (
              <code>hardhat node</code>) was restarted since this
              contract was deployed, which wipes it clean.
              Nothing here can be recovered — the fix is to remove
              this record (see{" "}
              <code>backend/cleanup-orphan.js</code>) and create
              the contract again on the current chain. The buttons
              below will not work until that's done.
            </div>
          )}

          <button
            className="btn btn-outline btn-sm"
            disabled={busy || chainExists === false}
            onClick={resyncStatusFromChain}
            style={{ marginBottom: 12 }}
          >
            Re-sync status from chain
          </button>
        </>
      ) : (
        <div className="callout error">
          Not yet deployed on-chain.
        </div>
      )}

      {msg && (
        <div className={`callout ${msg.type}`}>
          {msg.text}
        </div>
      )}

      <div className="tabs">
        {[
          "overview",
          "negotiation",
          "approvals",
          "escrow",
          "documents",
          "audit",
        ].map((t) => (
          <div
            key={t}
            className={`tab ${
              tab === t ? "active" : ""
            }`}
            onClick={() => setTab(t)}
          >
            {t[0].toUpperCase() + t.slice(1)}
          </div>
        ))}
      </div>

      {tab === "overview" && (
        <div className="ledger-card">
          <h2>
            Clauses (version {latestVersion?.version_no})
          </h2>

          <div className="ledger-row">
            <div>
              <div className="field-label">
                Scope of work
              </div>
              {clauses.scopeOfWork}
            </div>
          </div>

          <div className="ledger-row">
            <div>
              <div className="field-label">
                Payment terms
              </div>
              {clauses.paymentTerms}
            </div>
          </div>

          {clauses.confidentiality && (
            <div className="ledger-row">
              <div>
                <div className="field-label">
                  Confidentiality
                </div>
                {clauses.confidentiality}
              </div>
            </div>
          )}

          {clauses.terminationTerms && (
            <div className="ledger-row">
              <div>
                <div className="field-label">
                  Termination
                </div>
                {clauses.terminationTerms}
              </div>
            </div>
          )}

          <div className="ledger-row">
            <div className="field-label">
              Total value
            </div>

            <div>
              {contract.total_value_wei
                ? formatEther(contract.total_value_wei)
                : "-"}{" "}
              ETH
            </div>
          </div>

          {contract.status === "NEGOTIATION" &&
            isVendor &&
            contract.chain_address && (
              <button
                className="btn btn-brass"
                disabled={busy}
                onClick={submitForApproval}
              >
                Submit for approval
              </button>
            )}

          {contract.status === "APPROVED" &&
            (isBuyer || isVendor) && (
              <button
                className="btn btn-brass"
                disabled={busy}
                onClick={signContract}
              >
                Sign contract as{" "}
                {isBuyer ? "Buyer" : "Vendor"}
              </button>
            )}

          {contract.status === "COMPLETED" &&
            (isBuyer || isVendor) && (
              <button
                className="btn btn-brass"
                disabled={busy}
                onClick={closeContract}
              >
                Close contract
              </button>
            )}

          {contract.status === "ACTIVE" &&
            (isBuyer || isVendor) && (
              <button
                className="btn btn-danger btn-sm"
                style={{ marginLeft: 10 }}
                disabled={busy}
                onClick={raiseDispute}
              >
                Raise dispute
              </button>
            )}

          {contract.status === "DISPUTED" &&
            isApprover && (
              <div style={{ marginTop: 10 }}>
                <p>
                  Vote for who should prevail in this
                  dispute:
                </p>

                <button
                  className="btn btn-outline btn-sm"
                  disabled={busy}
                  onClick={() =>
                    voteArbitration(
                      buyer.wallet_address
                    )
                  }
                >
                  Vote: Buyer
                </button>

                <button
                  className="btn btn-outline btn-sm"
                  style={{ marginLeft: 8 }}
                  disabled={busy}
                  onClick={() =>
                    voteArbitration(
                      vendor.wallet_address
                    )
                  }
                >
                  Vote: Vendor
                </button>
              </div>
            )}
        </div>
      )}

      {tab === "negotiation" && (
        <NegotiationTab
          contractId={id}
          contract={contract}
          isBuyer={isBuyer}
          isVendor={isVendor}
          proposals={clauseProposals}
          onChange={load}
        />
      )}

      {tab === "approvals" && (
        <div className="ledger-card">
          <h2>Approvals</h2>

          {approvals.length === 0 && (
            <p className="muted">
              No approvals recorded yet.
            </p>
          )}

          <table>
            <thead>
              <tr>
                <th>Level</th>
                <th>Status</th>
                <th>Tx</th>
                <th>When</th>
              </tr>
            </thead>

            <tbody>
              {approvals.map((a) => (
                <tr key={a.id}>
                  <td>{a.approval_level}</td>
                  <td>{a.status}</td>
                  <td className="mono">
                    {a.chain_tx_hash?.slice(0, 10)}...
                  </td>
                  <td className="muted">
                    {new Date(
                      a.created_at
                    ).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {contract.status === "PENDING_APPROVAL" &&
            isApprover && (
              <button
                className="btn btn-brass"
                disabled={busy}
                onClick={approve}
                style={{ marginTop: 14 }}
              >
                Approve this contract
              </button>
            )}
        </div>
      )}

      {tab === "escrow" && (
        <div className="ledger-card">
          <h2>Escrow & Milestones</h2>

          {contract.status === "ACTIVE" &&
            isBuyer && (
              <button
                className="btn btn-brass btn-sm"
                disabled={busy}
                onClick={fundEscrow}
                style={{ marginBottom: 14 }}
              >
                Fund escrow
              </button>
            )}

          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Description</th>
                <th>Amount</th>
                <th>Due</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
              {milestones.map((m) => (
                <tr key={m.id}>
                  <td>{m.milestone_index + 1}</td>
                  <td>{m.description}</td>
                  <td>
                    {formatEther(m.amount_wei)} ETH
                  </td>
                  <td className="muted">
                    {new Date(
                      m.due_date
                    ).toLocaleDateString()}
                  </td>
                  <td>{m.status}</td>
                  <td>
                    {contract.status === "ACTIVE" &&
                      m.status === "PENDING" &&
                      isVendor && (
                        <button
                          className="btn btn-outline btn-sm"
                          disabled={busy}
                          onClick={() =>
                            markDelivered(
                              m.milestone_index
                            )
                          }
                        >
                          Mark delivered
                        </button>
                      )}

                    {contract.status === "ACTIVE" &&
                      m.status === "DELIVERED" &&
                      isBuyer && (
                        <button
                          className="btn btn-brass btn-sm"
                          disabled={busy}
                          onClick={() =>
                            confirmAndRelease(
                              m.milestone_index
                            )
                          }
                        >
                          Confirm & release payment
                        </button>
                      )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "documents" && (
        <DocumentsTab
          contractId={id}
          contract={contract}
          documents={documents}
          isBuyer={isBuyer}
          isVendor={isVendor}
          onChange={load}
          withWallet={withWallet}
          syncEvent={syncEvent}
        />
      )}

      {tab === "audit" && (
        <div className="ledger-card">
          <h2>On-chain audit trail</h2>

          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Actor</th>
                <th>Tx hash</th>
                <th>When</th>
              </tr>
            </thead>

            <tbody>
              {auditTrail.map((a) => (
                <tr key={a.id}>
                  <td>{a.event_type}</td>

                  <td>
                    {a.actor_id === contract.buyer_id
                      ? "Buyer"
                      : a.actor_id === contract.vendor_id
                      ? "Vendor"
                      : "Approver/Admin"}
                  </td>

                  <td className="mono">
                    {a.chain_tx_hash
                      ? `${a.chain_tx_hash.slice(
                          0,
                          12
                        )}...`
                      : "-"}
                  </td>

                  <td className="muted">
                    {new Date(
                      a.created_at
                    ).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

function NegotiationTab({
  contractId,
  contract,
  isBuyer,
  isVendor,
  proposals,
  onChange,
}) {
  const [clauseKey, setClauseKey] =
    useState("scopeOfWork");

  const [newValue, setNewValue] = useState("");
  const [busy, setBusy] = useState(false);

  async function propose(e) {
    e.preventDefault();

    if (newValue.trim().length < 3) return;

    setBusy(true);

    try {
      await api.post(
        `/contracts/${contractId}/clause-proposals`,
        {
          clauseKey,
          newValue,
        }
      );

      setNewValue("");
      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function respond(proposalId, decision) {
    await api.post(
      `/contracts/${contractId}/clause-proposals/${proposalId}/respond`,
      { decision }
    );

    onChange();
  }

  return (
    <div className="ledger-card">
      <h2>Clause negotiation</h2>

      {(contract.status === "DRAFT" ||
        contract.status === "NEGOTIATION") &&
      (isBuyer || isVendor) ? (
        <form
          onSubmit={propose}
          style={{ marginBottom: 18 }}
        >
          <div className="form-row">
            <div>
              <label>Clause</label>

              <select
                value={clauseKey}
                onChange={(e) =>
                  setClauseKey(e.target.value)
                }
              >
                <option value="scopeOfWork">
                  Scope of work
                </option>

                <option value="paymentTerms">
                  Payment terms
                </option>

                <option value="confidentiality">
                  Confidentiality
                </option>

                <option value="terminationTerms">
                  Termination terms
                </option>
              </select>
            </div>
          </div>

          <label>Proposed new text</label>

          <textarea
            value={newValue}
            onChange={(e) =>
              setNewValue(e.target.value)
            }
          />

          <button
            className="btn btn-outline btn-sm"
            disabled={busy}
            type="submit"
          >
            Propose change
          </button>
        </form>
      ) : (
        <p className="muted">
          Negotiation is closed for this contract.
        </p>
      )}

      <h3>Proposal history</h3>

      {proposals.length === 0 && (
        <p className="muted">
          No proposals yet.
        </p>
      )}

      {proposals.map((p) => (
        <div
          className="ledger-row"
          key={p.id}
          style={{ display: "block" }}
        >
          <div className="field-label">
            {p.clause_key} — {p.status}
          </div>

          <div>
            <strong>New:</strong> {p.new_value}
          </div>

          {p.old_value && (
            <div className="muted">
              <strong>Was:</strong> {p.old_value}
            </div>
          )}

          {p.status === "PENDING" &&
            (isBuyer || isVendor) && (
              <div style={{ marginTop: 6 }}>
                <button
                  className="btn btn-brass btn-sm"
                  onClick={() =>
                    respond(p.id, "ACCEPTED")
                  }
                >
                  Accept
                </button>

                <button
                  className="btn btn-outline btn-sm"
                  style={{ marginLeft: 8 }}
                  onClick={() =>
                    respond(p.id, "REJECTED")
                  }
                >
                  Reject
                </button>
              </div>
            )}
        </div>
      ))}
    </div>
  );
}

function DocumentsTab({
  contractId,
  contract,
  documents,
  isBuyer,
  isVendor,
  onChange,
  withWallet,
  syncEvent,
}) {
  const [label, setLabel] = useState("");
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);

  async function upload(e) {
    e.preventDefault();

    if (!file || !label) return;

    setBusy(true);

    try {
      const formData = new FormData();

      formData.append("file", file);
      formData.append("label", label);

      const { data } = await api.post(
        `/documents/${contractId}/upload`,
        formData,
        {
          headers: {
            "Content-Type":
              "multipart/form-data",
          },
        }
      );

      // Anchor the hash on-chain
      await withWallet(async (chain) => {
        const tx = await chain.anchorDocument(
          data.docHash,
          `backend-doc:${data.documentId}`,
          label
        );

        const r = await tx.wait();

        await syncEvent(
          "DOCUMENT_ANCHORED",
          r.hash,
          {
            documentId: data.documentId,
            label,
          }
        );
      });

      setLabel("");
      setFile(null);

      onChange();
    } finally {
      setBusy(false);
    }
  }

  async function verify(docId) {
    const { data } = await api.post(
      `/documents/${docId}/verify`,
      {}
    );

    setVerifyResult({
      docId,
      ...data,
    });
  }

  return (
    <div className="ledger-card">
      <h2>
        Documents & integrity verification
      </h2>

      {(isBuyer || isVendor) && (
        <form
          onSubmit={upload}
          style={{ marginBottom: 18 }}
        >
          <div className="form-row">
            <div>
              <label>Label</label>

              <input
                value={label}
                onChange={(e) =>
                  setLabel(e.target.value)
                }
                placeholder="e.g. Signed Contract PDF, Delivery Note M1"
              />
            </div>

            <div>
              <label>
                File (PDF/PNG/JPEG, max 10MB)
              </label>

              <input
                type="file"
                accept=".pdf,.png,.jpg,.jpeg"
                onChange={(e) =>
                  setFile(e.target.files[0])
                }
              />
            </div>
          </div>

          <button
            className="btn btn-brass btn-sm"
            disabled={busy}
            type="submit"
          >
            Upload & anchor hash on-chain
          </button>
        </form>
      )}

      <table>
        <thead>
          <tr>
            <th>Label</th>
            <th>Hash</th>
            <th>Uploaded</th>
            <th></th>
          </tr>
        </thead>

        <tbody>
          {documents.map((d) => (
            <tr key={d.id}>
              <td>{d.label}</td>

              <td className="mono">
                {d.doc_hash.slice(0, 14)}...
              </td>

              <td className="muted">
                {new Date(
                  d.created_at
                ).toLocaleDateString()}
              </td>

              <td>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() =>
                    verify(d.id)
                  }
                >
                  Verify integrity
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {verifyResult && (
        <div
          className={`callout ${
            verifyResult.storedMatches
              ? "success"
              : "error"
          }`}
          style={{ marginTop: 14 }}
        >
          {verifyResult.verdict}
        </div>
      )}
    </div>
  );
}