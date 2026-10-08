// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ContractLifecycle.sol";

/**
 * ContractFactory
 * ----------------
 * - Super Admin whitelists vendor wallet addresses after off-chain KYC review.
 * - Buyers (procurement officers) deploy new ContractLifecycle instances
 *   through this factory, which enforces that the vendor is whitelisted
 *   before a contract can even be created.
 * - Keeps an on-chain registry of every contract address ever created,
 *   which the backend/frontend use to build the audit trail & dashboards.
 */
contract ContractFactory {
    address public superAdmin;

    mapping(address => bool) public isVendorWhitelisted;
    mapping(address => bool) public isBuyerAuthorized;

    address[] public allContracts;
    mapping(address => address[]) public contractsByVendor;
    mapping(address => address[]) public contractsByBuyer;

    event VendorWhitelisted(address indexed vendor, bool status);
    event BuyerAuthorized(address indexed buyer, bool status);
    event ContractCreated(address indexed contractAddress, address indexed buyer, address indexed vendor, uint256 totalValue);

    modifier onlySuperAdmin() {
        require(msg.sender == superAdmin, "Only super admin");
        _;
    }

    constructor() {
        superAdmin = msg.sender;
    }

    function setVendorWhitelist(address vendor, bool status) external onlySuperAdmin {
        isVendorWhitelisted[vendor] = status;
        emit VendorWhitelisted(vendor, status);
    }

    function setBuyerAuthorized(address buyer, bool status) external onlySuperAdmin {
        isBuyerAuthorized[buyer] = status;
        emit BuyerAuthorized(buyer, status);
    }

    function createContract(
        address vendor,
        address[] memory approvers,
        uint8 requiredApprovals,
        uint256 multiSigThreshold,
        string[] memory milestoneDescriptions,
        uint256[] memory milestoneAmounts,
        uint256[] memory milestoneDueDates,
        uint16[] memory milestonePenaltyBps
    ) external returns (address) {
        require(isBuyerAuthorized[msg.sender], "Buyer not authorized");
        require(isVendorWhitelisted[vendor], "Vendor not KYC-whitelisted");

        ContractLifecycle c = new ContractLifecycle(
            msg.sender,
            vendor,
            approvers,
            requiredApprovals,
            multiSigThreshold,
            milestoneDescriptions,
            milestoneAmounts,
            milestoneDueDates,
            milestonePenaltyBps
        );

        address addr = address(c);
        allContracts.push(addr);
        contractsByVendor[vendor].push(addr);
        contractsByBuyer[msg.sender].push(addr);

        uint256 sum = 0;
        for (uint256 i = 0; i < milestoneAmounts.length; i++) {
            sum += milestoneAmounts[i];
        }

        emit ContractCreated(addr, msg.sender, vendor, sum);
        return addr;
    }

    function getAllContracts() external view returns (address[] memory) {
        return allContracts;
    }

    function getContractsByVendor(address vendor) external view returns (address[] memory) {
        return contractsByVendor[vendor];
    }

    function getContractsByBuyer(address buyer) external view returns (address[] memory) {
        return contractsByBuyer[buyer];
    }
}
