import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Shell from "../components/Shell";
import api from "../api";
import { useAuth } from "../context/AuthContext";
import { getFactoryContract, ethToWei, toUnixSeconds } from "../web3";

const EMPTY_MILESTONE = {
  description: "",
  amountEth: "",
  dueDate: "",
  penaltyBps: 0
};

function minDueDateLocal() {
  const d = new Date();
  d.setSeconds(0, 0);

  const pad = (n) => String(n).padStart(2, "0");

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CreateContract() {
  const { connect, walletAddress } = useAuth();
  const navigate = useNavigate();

  const [vendors, setVendors] = useState([]);
  const [approversList, setApproversList] = useState([]);
  const [form, setForm] = useState({
    title: "",
    templateType: "GOODS_SUPPLY",
    vendorId: "",
    clauses: {
      scopeOfWork: "",
      paymentTerms: "",
      confidentiality: "",
      terminationTerms: ""
    },
    milestones: [{ ...EMPTY_MILESTONE }],
    approverIds: [],
    requiredApprovals: 1,
    multiSigThresholdEth: 5
  });
  const [errors, setErrors] = useState({});
  const [apiError, setApiError] = useState(null);
  const [step, setStep] = useState("form"); // form | deploying | done
  const [deployedAddress, setDeployedAddress] = useState(null);

  useEffect(() => {
    api.get("/users/vendors").then((r) => setVendors(r.data.vendors));
    api.get("/users/approvers").then((r) => setApproversList(r.data.approvers));
  }, []);

  function updateClause(key, value) {
    setForm((f) => ({
      ...f,
      clauses: {
        ...f.clauses,
        [key]: value
      }
    }));
  }

  function updateMilestone(idx, key, value) {
    setForm((f) => {
      const milestones = [...f.milestones];
      milestones[idx] = {
        ...milestones[idx],
        [key]: value
      };
      return {
        ...f,
        milestones
      };
    });
  }

  function addMilestone() {
    setForm((f) => ({
      ...f,
      milestones: [
        ...f.milestones,
        { ...EMPTY_MILESTONE }
      ]
    }));
  }

  function removeMilestone(idx) {
    setForm((f) => ({
      ...f,
      milestones: f.milestones.filter((_, i) => i !== idx)
    }));
  }

  function toggleApprover(id) {
    setForm((f) => {
      const has = f.approverIds.includes(id);

      return {
        ...f,
        approverIds: has
          ? f.approverIds.filter((x) => x !== id)
          : [...f.approverIds, id]
      };
    });
  }

  function validate() {
    const e = {};

    if (form.title.trim().length < 3) {
      e.title = "Title must be at least 3 characters";
    }

    if (!form.vendorId) {
      e.vendorId = "Select a KYC-verified vendor";
    }

    if (form.clauses.scopeOfWork.trim().length < 10) {
      e.scopeOfWork = "Describe the scope in at least 10 characters";
    }

    if (form.clauses.paymentTerms.trim().length < 5) {
      e.paymentTerms = "Payment terms required";
    }

    if (form.approverIds.length === 0) {
      e.approverIds = "Select at least one approver";
    }

    if (form.requiredApprovals > form.approverIds.length) {
      e.requiredApprovals =
        "Cannot exceed number of approvers selected";
    }

    form.milestones.forEach((m, i) => {
      if (!m.description || m.description.length < 3) {
        e[`milestone_${i}_desc`] =
          "Milestone description required";
      }

      if (!m.amountEth || Number(m.amountEth) <= 0) {
        e[`milestone_${i}_amt`] =
          "Amount must be greater than 0";
      }

      if (
        !m.dueDate ||
        new Date(m.dueDate) <= new Date()
      ) {
        e[`milestone_${i}_due`] =
          "Due date must be in the future";
      }
    });

    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setApiError(null);

    if (!validate()) return;

    try {
      setStep("saving");

      // Step 1: save the draft off-chain
      // Backend re-validates everything - Layer 2
      const payload = {
        title: form.title,
        templateType: form.templateType,
        vendorId: form.vendorId,
        clauses: form.clauses,
        milestones: form.milestones.map((m) => ({
          description: m.description,
          amountEth: Number(m.amountEth),
          dueDate: new Date(m.dueDate).toISOString(),
          penaltyBps: Number(m.penaltyBps) || 0
        })),
        approverIds: form.approverIds,
        requiredApprovals: Number(form.requiredApprovals)
      };

      const { data } = await api.post(
        "/contracts",
        payload
      );

      const contractId = data.contractId;

      // Step 2: deploy on-chain
      // Needs the buyer's wallet signature
      setStep("deploying");

      if (!walletAddress) {
        await connect();
      }

      const { signer } = await (async () => {
        const w = await import("../web3");
        return w.connectWallet();
      })();

      const factory = await getFactoryContract(signer);

      const vendor = vendors.find(
        (v) => v.id === form.vendorId
      );

      const approverAddrs = approversList
        .filter((a) =>
          form.approverIds.includes(a.id)
        )
        .map((a) => a.wallet_address);

      const tx = await factory.createContract(
        vendor.wallet_address,
        approverAddrs,
        Number(form.requiredApprovals),
        ethToWei(form.multiSigThresholdEth),
        form.milestones.map((m) => m.description),
        form.milestones.map((m) =>
          ethToWei(m.amountEth)
        ),
        form.milestones.map((m) =>
          toUnixSeconds(m.dueDate)
        ),
        form.milestones.map((m) =>
          Number(m.penaltyBps) || 0
        )
      );

      const receipt = await tx.wait();

      const event = receipt.logs
        .map((l) => {
          try {
            return factory.interface.parseLog(l);
          } catch {
            return null;
          }
        })
        .find(
          (ev) =>
            ev &&
            ev.name === "ContractCreated"
        );

      const chainAddress =
        event.args.contractAddress;

      await api.patch(
        `/contracts/${contractId}/chain-address`,
        {
          chainAddress,
          txHash: receipt.hash
        }
      );

      setDeployedAddress(chainAddress);
      setStep("done");

      setTimeout(
        () => navigate(`/contracts/${contractId}`),
        1200
      );
    } catch (err) {
      setApiError(
        err.response?.data?.error ||
        err.message ||
        "Something went wrong"
      );

      setStep("form");
    }
  }

  return (
    <Shell>
      <h1>New Contract</h1>

      <p
        className="muted"
        style={{ marginTop: -10 }}
      >
        Vendor & Procurement · Goods / Service / AMC template
      </p>

      {apiError && (
        <div className="callout error">
          {apiError}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="ledger-card">
          <h2>Basics</h2>

          <label>Contract title</label>

          <input
            value={form.title}
            onChange={(e) =>
              setForm({
                ...form,
                title: e.target.value
              })
            }
            placeholder="e.g. Office Furniture Supply — FY26 Q3"
          />

          {errors.title && (
            <div className="error-text">
              {errors.title}
            </div>
          )}

          <div className="form-row">
            <div>
              <label>Template type</label>

              <select
                value={form.templateType}
                onChange={(e) =>
                  setForm({
                    ...form,
                    templateType: e.target.value
                  })
                }
              >
                <option value="GOODS_SUPPLY">
                  Goods Supply
                </option>

                <option value="SERVICE_AGREEMENT">
                  Service Agreement
                </option>

                <option value="AMC_MAINTENANCE">
                  AMC / Maintenance
                </option>
              </select>
            </div>

            <div>
              <label>
                Vendor (KYC-verified only)
              </label>

              <select
                value={form.vendorId}
                onChange={(e) =>
                  setForm({
                    ...form,
                    vendorId: e.target.value
                  })
                }
              >
                <option value="">
                  Select vendor...
                </option>

                {vendors.map((v) => (
                  <option
                    key={v.id}
                    value={v.id}
                  >
                    {v.name} (
                    {v.wallet_address.slice(0, 8)}
                    ...)
                  </option>
                ))}
              </select>

              {vendors.length === 0 && (
                <div className="help-text">
                  No verified vendors yet — ask Super
                  Admin to complete KYC review first.
                </div>
              )}

              {errors.vendorId && (
                <div className="error-text">
                  {errors.vendorId}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="ledger-card">
          <h2>Clauses</h2>

          <label>Scope of work</label>

          <textarea
            value={form.clauses.scopeOfWork}
            onChange={(e) =>
              updateClause(
                "scopeOfWork",
                e.target.value
              )
            }
          />

          {errors.scopeOfWork && (
            <div className="error-text">
              {errors.scopeOfWork}
            </div>
          )}

          <label>Payment terms</label>

          <textarea
            value={form.clauses.paymentTerms}
            onChange={(e) =>
              updateClause(
                "paymentTerms",
                e.target.value
              )
            }
            placeholder="e.g. Milestone-based release via escrow smart contract"
          />

          {errors.paymentTerms && (
            <div className="error-text">
              {errors.paymentTerms}
            </div>
          )}

          <label>
            Confidentiality (optional)
          </label>

          <textarea
            value={form.clauses.confidentiality}
            onChange={(e) =>
              updateClause(
                "confidentiality",
                e.target.value
              )
            }
          />

          <label>
            Termination terms (optional)
          </label>

          <textarea
            value={form.clauses.terminationTerms}
            onChange={(e) =>
              updateClause(
                "terminationTerms",
                e.target.value
              )
            }
          />
        </div>

        <div className="ledger-card">
          <h2>
            Milestones (funds escrow releases per milestone)
          </h2>

          {form.milestones.map((m, i) => (
            <div
              key={i}
              className="ledger-row"
              style={{ display: "block" }}
            >
              <div className="form-row">
                <div>
                  <label>
                    Description
                  </label>

                  <input
                    value={m.description}
                    onChange={(e) =>
                      updateMilestone(
                        i,
                        "description",
                        e.target.value
                      )
                    }
                  />

                  {errors[
                    `milestone_${i}_desc`
                  ] && (
                    <div className="error-text">
                      {
                        errors[
                          `milestone_${i}_desc`
                        ]
                      }
                    </div>
                  )}
                </div>

                <div>
                  <label>
                    Amount (ETH)
                  </label>

                  <input
                    type="number"
                    step="0.001"
                    value={m.amountEth}
                    onChange={(e) =>
                      updateMilestone(
                        i,
                        "amountEth",
                        e.target.value
                      )
                    }
                  />

                  {errors[
                    `milestone_${i}_amt`
                  ] && (
                    <div className="error-text">
                      {
                        errors[
                          `milestone_${i}_amt`
                        ]
                      }
                    </div>
                  )}
                </div>
              </div>

              <div className="form-row">
                <div>
                  <label>
                    Due date
                  </label>

                  <input
                    type="datetime-local"
                    min={minDueDateLocal()}
                    value={m.dueDate}
                    onChange={(e) =>
                      updateMilestone(
                        i,
                        "dueDate",
                        e.target.value
                      )
                    }
                  />

                  {errors[
                    `milestone_${i}_due`
                  ] && (
                    <div className="error-text">
                      {
                        errors[
                          `milestone_${i}_due`
                        ]
                      }
                    </div>
                  )}
                </div>

                <div>
                  <label>
                    Late-delivery penalty (basis points, 100 = 1%)
                  </label>

                  <input
                    type="number"
                    min="0"
                    max="10000"
                    value={m.penaltyBps}
                    onChange={(e) =>
                      updateMilestone(
                        i,
                        "penaltyBps",
                        e.target.value
                      )
                    }
                  />
                </div>
              </div>

              {form.milestones.length > 1 && (
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  onClick={() =>
                    removeMilestone(i)
                  }
                >
                  Remove milestone
                </button>
              )}
            </div>
          ))}

          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={addMilestone}
          >
            + Add milestone
          </button>
        </div>

        <div className="ledger-card">
          <h2>Approval chain</h2>

          <label>
            Select approvers
          </label>

          {approversList.length === 0 && (
            <p className="help-text">
              No approver accounts registered yet.
            </p>
          )}

          {approversList.map((a) => (
            <label
              key={a.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontWeight: 400
              }}
            >
              <input
                type="checkbox"
                style={{
                  width: "auto",
                  marginBottom: 0
                }}
                checked={form.approverIds.includes(a.id)}
                onChange={() =>
                  toggleApprover(a.id)
                }
              />

              {a.name} —{" "}
              {a.role.replace("_", " ")}{" "}
              {a.department
                ? `(${a.department})`
                : ""}
            </label>
          ))}

          {errors.approverIds && (
            <div className="error-text">
              {errors.approverIds}
            </div>
          )}

          <div
            className="form-row"
            style={{ marginTop: 14 }}
          >
            <div>
              <label>
                Approvals required (out of selected approvers)
              </label>

              <input
                type="number"
                min="1"
                value={form.requiredApprovals}
                onChange={(e) =>
                  setForm({
                    ...form,
                    requiredApprovals:
                      e.target.value
                  })
                }
              />

              {errors.requiredApprovals && (
                <div className="error-text">
                  {errors.requiredApprovals}
                </div>
              )}
            </div>

            <div>
              <label>
                Multi-sig threshold (ETH) — contracts above
                this value require the full approval count
              </label>

              <input
                type="number"
                step="0.1"
                value={form.multiSigThresholdEth}
                onChange={(e) =>
                  setForm({
                    ...form,
                    multiSigThresholdEth:
                      e.target.value
                  })
                }
              />
            </div>
          </div>
        </div>

        <button
          className="btn btn-brass"
          type="submit"
          disabled={step !== "form"}
        >
          {step === "form" &&
            "Save draft & deploy on-chain"}

          {step === "saving" &&
            "Saving draft..."}

          {step === "deploying" &&
            "Confirm in MetaMask..."}

          {step === "done" &&
            `Deployed at ${deployedAddress?.slice(0, 10)}...`}
        </button>

        <p
          className="help-text"
          style={{ marginTop: 10 }}
        >
          This will ask your wallet to sign a transaction
          deploying a new ContractLifecycle contract
          on-chain.
        </p>
      </form>
    </Shell>
  );
}