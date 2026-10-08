const CLASS_MAP = {
  DRAFT: "badge-draft",
  NEGOTIATION: "badge-negotiation",
  PENDING_APPROVAL: "badge-pending",
  APPROVED: "badge-approved",
  ACTIVE: "badge-active",
  DISPUTED: "badge-disputed",
  COMPLETED: "badge-completed",
  CLOSED: "badge-closed"
};

export default function StatusBadge({ status }) {
  return <span className={`badge ${CLASS_MAP[status] || "badge-draft"}`}>{status?.replace("_", " ")}</span>;
}
