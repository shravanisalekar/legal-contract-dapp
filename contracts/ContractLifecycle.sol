// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * ContractLifecycle
 * ------------------
 * On-chain source of truth for a B2B vendor/procurement contract.
 * The backend + frontend keep richer off-chain data (clause text, files),
 * but every state transition, signature, approval, fund movement and
 * document hash is written here so it cannot be altered after the fact.
 *
 * Design notes (for your viva / report):
 *  - State machine enforced with `require` guards -> Layer 3 validation.
 *  - Role checks via modifiers, roles are set once at contract creation
 *    from addresses supplied by the backend (which already verified KYC /
 *    org identity off-chain).
 *  - Multi-signature approval: for contracts above `multiSigThreshold`,
 *    2-of-3 configured approvers must each call approve() before the
 *    contract can move to Approved.
 *  - Escrow: buyer funds the contract; funds are released per-milestone
 *    only after the buyer (or its delegate) confirms delivery.
 *  - Penalty: if a milestone is confirmed after its deadline, a penalty
 *    percentage is deducted from that milestone's payout automatically,
 *    based on block.timestamp vs the agreed due date.
 *  - Document hashing: any document (contract PDF, delivery note, invoice)
 *    is anchored by its keccak256/SHA-256 hash + an off-chain pointer
 *    (IPFS CID or backend file id) - proves integrity without storing the
 *    file itself on-chain.
 */
contract ContractLifecycle {
    enum Status {
        Draft,
        Negotiation,
        PendingApproval,
        Approved,
        Active,
        Disputed,
        Completed,
        Closed
    }

    struct Milestone {
        string description;
        uint256 amount;        // in wei
        uint256 dueDate;        // unix timestamp
        uint16 penaltyBps;      // penalty in basis points (1% = 100 bps) per late confirmation
        bool delivered;
        bool paid;
        uint256 deliveredAt;
    }

    struct DocRecord {
        bytes32 docHash;
        string pointer;   // e.g. IPFS CID or backend file reference
        address submittedBy;
        uint256 timestamp;
        string label;      // "ContractPDF v2", "DeliveryNote-M1", etc.
    }

    address public buyer;
    address public vendor;
    address[] public approvers;         // dept, finance, legal (in order) - or more
    uint256 public multiSigThreshold;   // contract value above which N approvals are required
    uint8 public requiredApprovals;     // how many of `approvers` must sign off

    Status public status;
    uint256 public totalValue;          // sum of milestone amounts, in wei
    uint256 public fundedAmount;        // how much buyer has deposited so far

    bool public vendorSigned;
    bool public buyerSigned;

    Milestone[] public milestones;
    DocRecord[] public documents;

    mapping(address => bool) public hasApproved;
    uint8 public approvalCount;

    address public arbitrationWinner; // set when a dispute is resolved, 0 = unresolved

    event StatusChanged(Status oldStatus, Status newStatus, uint256 timestamp);
    event ApprovalGiven(address indexed approver, uint256 timestamp);
    event Signed(address indexed signer, string role, uint256 timestamp);
    event Funded(address indexed from, uint256 amount, uint256 totalFunded);
    event MilestoneDelivered(uint256 indexed index, uint256 timestamp);
    event MilestonePaid(uint256 indexed index, uint256 amountPaid, uint16 penaltyBpsApplied);
    event DocumentAnchored(uint256 indexed index, bytes32 docHash, string label, address submittedBy);
    event DisputeRaised(address indexed raisedBy, string reason, uint256 timestamp);
    event DisputeResolved(address indexed winner, uint256 timestamp);

    modifier onlyBuyer() {
        require(msg.sender == buyer, "Only buyer can call this");
        _;
    }

    modifier onlyVendor() {
        require(msg.sender == vendor, "Only vendor can call this");
        _;
    }

    modifier onlyApprover() {
        bool ok = false;
        for (uint256 i = 0; i < approvers.length; i++) {
            if (approvers[i] == msg.sender) { ok = true; break; }
        }
        require(ok, "Only a designated approver can call this");
        _;
    }

    modifier onlyParty() {
        require(msg.sender == buyer || msg.sender == vendor, "Only buyer or vendor");
        _;
    }

    modifier inStatus(Status s) {
        require(status == s, "Invalid state for this action");
        _;
    }

    constructor(
        address _buyer,
        address _vendor,
        address[] memory _approvers,
        uint8 _requiredApprovals,
        uint256 _multiSigThreshold,
        string[] memory milestoneDescriptions,
        uint256[] memory milestoneAmounts,
        uint256[] memory milestoneDueDates,
        uint16[] memory milestonePenaltyBps
    ) {
        require(_buyer != address(0) && _vendor != address(0), "Invalid party address");
        require(_requiredApprovals > 0 && _requiredApprovals <= _approvers.length, "Bad approval threshold");
        require(
            milestoneDescriptions.length == milestoneAmounts.length &&
            milestoneAmounts.length == milestoneDueDates.length &&
            milestoneDueDates.length == milestonePenaltyBps.length,
            "Milestone arrays length mismatch"
        );
        require(milestoneDescriptions.length > 0, "At least one milestone required");

        buyer = _buyer;
        vendor = _vendor;
        approvers = _approvers;
        requiredApprovals = _requiredApprovals;
        multiSigThreshold = _multiSigThreshold;
        status = Status.Draft;

        uint256 sum = 0;
        for (uint256 i = 0; i < milestoneDescriptions.length; i++) {
            require(milestoneAmounts[i] > 0, "Milestone amount must be > 0");
            require(milestonePenaltyBps[i] <= 10000, "Penalty cannot exceed 100%");
            milestones.push(Milestone({
                description: milestoneDescriptions[i],
                amount: milestoneAmounts[i],
                dueDate: milestoneDueDates[i],
                penaltyBps: milestonePenaltyBps[i],
                delivered: false,
                paid: false,
                deliveredAt: 0
            }));
            sum += milestoneAmounts[i];
        }
        totalValue = sum;

        emit StatusChanged(Status.Draft, Status.Draft, block.timestamp);
    }

    // ---------- Negotiation / document anchoring ----------

    function anchorDocument(bytes32 docHash, string calldata pointer, string calldata label)
        external
        onlyParty
    {
        require(status == Status.Draft || status == Status.Negotiation, "Docs only anchored pre-approval flow");
        documents.push(DocRecord({
            docHash: docHash,
            pointer: pointer,
            submittedBy: msg.sender,
            timestamp: block.timestamp,
            label: label
        }));
        if (status == Status.Draft) {
            _setStatus(Status.Negotiation);
        }
        emit DocumentAnchored(documents.length - 1, docHash, label, msg.sender);
    }

    function submitForApproval() external onlyParty inStatus(Status.Negotiation) {
        _setStatus(Status.PendingApproval);
    }

    // ---------- Multi-level / multi-sig approval ----------

    function approve() external onlyApprover inStatus(Status.PendingApproval) {
        require(!hasApproved[msg.sender], "Already approved by this approver");
        hasApproved[msg.sender] = true;
        approvalCount += 1;
        emit ApprovalGiven(msg.sender, block.timestamp);

        uint8 needed = totalValue >= multiSigThreshold ? requiredApprovals : 1;
        if (approvalCount >= needed) {
            _setStatus(Status.Approved);
        }
    }

    // ---------- Wallet e-signature ----------

    function signAsVendor() external onlyVendor inStatus(Status.Approved) {
        require(!vendorSigned, "Vendor already signed");
        vendorSigned = true;
        emit Signed(msg.sender, "vendor", block.timestamp);
        _maybeActivate();
    }

    function signAsBuyer() external onlyBuyer inStatus(Status.Approved) {
        require(!buyerSigned, "Buyer already signed");
        buyerSigned = true;
        emit Signed(msg.sender, "buyer", block.timestamp);
        _maybeActivate();
    }

    function _maybeActivate() internal {
        if (vendorSigned && buyerSigned) {
            _setStatus(Status.Active);
        }
    }

    // ---------- Escrow funding ----------

    function fundEscrow() external payable onlyBuyer {
        require(status == Status.Active, "Contract must be Active to fund");
        require(msg.value > 0, "Must send funds");
        fundedAmount += msg.value;
        emit Funded(msg.sender, msg.value, fundedAmount);
    }

    // ---------- Milestone delivery + payment release ----------

    function markMilestoneDelivered(uint256 index) external onlyVendor inStatus(Status.Active) {
        require(index < milestones.length, "Bad milestone index");
        Milestone storage m = milestones[index];
        require(!m.delivered, "Already marked delivered");
        m.delivered = true;
        m.deliveredAt = block.timestamp;
        emit MilestoneDelivered(index, block.timestamp);
    }

    function confirmAndRelease(uint256 index) external onlyBuyer inStatus(Status.Active) {
        require(index < milestones.length, "Bad milestone index");
        Milestone storage m = milestones[index];
        require(m.delivered, "Not marked delivered by vendor yet");
        require(!m.paid, "Already paid");
        require(fundedAmount >= m.amount, "Escrow underfunded for this milestone");

        uint16 penaltyBpsApplied = 0;
        uint256 payout = m.amount;
        if (m.deliveredAt > m.dueDate && m.penaltyBps > 0) {
            penaltyBpsApplied = m.penaltyBps;
            uint256 penalty = (m.amount * penaltyBpsApplied) / 10000;
            payout = m.amount - penalty;
        }

        m.paid = true;
        fundedAmount -= m.amount;

        (bool sent, ) = payable(vendor).call{value: payout}("");
        require(sent, "Payment transfer failed");

        emit MilestonePaid(index, payout, penaltyBpsApplied);

        if (_allMilestonesPaid()) {
            _setStatus(Status.Completed);
        }
    }

    function _allMilestonesPaid() internal view returns (bool) {
        for (uint256 i = 0; i < milestones.length; i++) {
            if (!milestones[i].paid) return false;
        }
        return true;
    }

    // ---------- Dispute handling ----------

    function raiseDispute(string calldata reason) external onlyParty {
        require(status == Status.Active, "Can only dispute an active contract");
        _setStatus(Status.Disputed);
        emit DisputeRaised(msg.sender, reason, block.timestamp);
    }

    /// @dev Simple 2-of-3 approver arbitration: majority of approvers pick the winner.
    mapping(address => address) public arbitrationVote; // approver => vote (buyer or vendor address)
    mapping(address => uint8) internal voteCount;        // candidate => votes
    address[] internal candidatesVoted;

    function arbitrationVoteFor(address winner) external onlyApprover inStatus(Status.Disputed) {
        require(winner == buyer || winner == vendor, "Winner must be buyer or vendor");
        require(arbitrationVote[msg.sender] == address(0), "Already voted");
        arbitrationVote[msg.sender] = winner;

        if (voteCount[winner] == 0) {
            candidatesVoted.push(winner);
        }
        voteCount[winner] += 1;

        uint8 needed = (uint8(approvers.length) / 2) + 1;
        if (voteCount[winner] >= needed) {
            arbitrationWinner = winner;
            _setStatus(Status.Active); // resume; funds distribution / refund handled off-chain per ruling
            emit DisputeResolved(winner, block.timestamp);
        }
    }

    // ---------- Closure ----------

    function closeContract() external onlyParty inStatus(Status.Completed) {
        _setStatus(Status.Closed);
    }

    // ---------- Views ----------

    function getMilestoneCount() external view returns (uint256) {
        return milestones.length;
    }

    function getDocumentCount() external view returns (uint256) {
        return documents.length;
    }

    function getApprovers() external view returns (address[] memory) {
        return approvers;
    }

    function _setStatus(Status newStatus) internal {
        Status old = status;
        status = newStatus;
        emit StatusChanged(old, newStatus, block.timestamp);
    }
}
