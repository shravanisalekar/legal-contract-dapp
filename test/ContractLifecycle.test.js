const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

describe("ContractLifecycle + ContractFactory", function () {
  let factory, superAdmin, buyer, vendor, deptApprover, financeApprover, legalApprover, outsider;

  beforeEach(async function () {
    [superAdmin, buyer, vendor, deptApprover, financeApprover, legalApprover, outsider] =
      await ethers.getSigners();

    const Factory = await ethers.getContractFactory("ContractFactory");
    factory = await Factory.deploy();

    await factory.connect(superAdmin).setVendorWhitelist(vendor.address, true);
    await factory.connect(superAdmin).setBuyerAuthorized(buyer.address, true);
  });

  async function createSampleContract({ multiSigThreshold = ethers.parseEther("1000") } = {}) {
    const due = (await time.latest()) + 3600; // 1 hour from now
    const tx = await factory.connect(buyer).createContract(
      vendor.address,
      [deptApprover.address, financeApprover.address, legalApprover.address],
      2, // requiredApprovals
      multiSigThreshold,
      ["Design phase", "Delivery phase"],
      [ethers.parseEther("1"), ethers.parseEther("2")],
      [due, due + 7200],
      [500, 1000] // 5%, 10% penalty
    );
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((l) => { try { return factory.interface.parseLog(l); } catch { return null; } })
      .find((e) => e && e.name === "ContractCreated");
    const contractAddr = event.args.contractAddress;
    const Lifecycle = await ethers.getContractFactory("ContractLifecycle");
    return Lifecycle.attach(contractAddr);
  }

  it("rejects contract creation for non-whitelisted vendor", async function () {
    await expect(
      factory.connect(buyer).createContract(
        outsider.address,
        [deptApprover.address, financeApprover.address, legalApprover.address],
        2,
        ethers.parseEther("1000"),
        ["Only phase"],
        [ethers.parseEther("1")],
        [(await time.latest()) + 3600],
        [0]
      )
    ).to.be.revertedWith("Vendor not KYC-whitelisted");
  });

  it("runs the full lifecycle: negotiation -> approval -> signing -> escrow -> milestone payout", async function () {
    const c = await createSampleContract();

    // Negotiation: anchor a document hash (e.g. hash of the draft PDF)
    const hash = ethers.keccak256(ethers.toUtf8Bytes("draft-contract-v1"));
    await c.connect(buyer).anchorDocument(hash, "ipfs://fake-cid", "ContractPDF v1");
    expect(await c.status()).to.equal(1); // Negotiation

    await c.connect(vendor).submitForApproval();
    expect(await c.status()).to.equal(2); // PendingApproval

    // Below multiSigThreshold in this default case would need 1 approval,
    // but total value here (3 ETH) < threshold (1000 ETH) so single approval suffices
    await c.connect(deptApprover).approve();
    expect(await c.status()).to.equal(3); // Approved

    await c.connect(vendor).signAsVendor();
    await c.connect(buyer).signAsBuyer();
    expect(await c.status()).to.equal(4); // Active

    await c.connect(buyer).fundEscrow({ value: ethers.parseEther("3") });
    expect(await c.fundedAmount()).to.equal(ethers.parseEther("3"));

    await c.connect(vendor).markMilestoneDelivered(0);
    const vendorBalBefore = await ethers.provider.getBalance(vendor.address);
    await c.connect(buyer).confirmAndRelease(0);
    const vendorBalAfter = await ethers.provider.getBalance(vendor.address);
    expect(vendorBalAfter - vendorBalBefore).to.equal(ethers.parseEther("1")); // on time, no penalty
  });

  it("requires 2 approvals (multi-sig) when contract value exceeds threshold", async function () {
    const c = await createSampleContract({ multiSigThreshold: ethers.parseEther("1") }); // 3 ETH total > 1 ETH threshold

    await c.connect(vendor).anchorDocument(ethers.keccak256(ethers.toUtf8Bytes("x")), "ipfs://x", "Draft");
    await c.connect(vendor).submitForApproval();

    await c.connect(deptApprover).approve();
    expect(await c.status()).to.equal(2); // still PendingApproval, only 1 of 2 needed approvals given

    await c.connect(financeApprover).approve();
    expect(await c.status()).to.equal(3); // now Approved
  });

  it("applies a penalty when a milestone is confirmed after its due date", async function () {
    const c = await createSampleContract();
    await c.connect(vendor).anchorDocument(ethers.keccak256(ethers.toUtf8Bytes("x")), "ipfs://x", "Draft");
    await c.connect(vendor).submitForApproval();
    await c.connect(deptApprover).approve();
    await c.connect(vendor).signAsVendor();
    await c.connect(buyer).signAsBuyer();
    await c.connect(buyer).fundEscrow({ value: ethers.parseEther("3") });

    // fast-forward past milestone 0's due date before delivering
    await time.increase(7300);

    await c.connect(vendor).markMilestoneDelivered(0);
    const before = await ethers.provider.getBalance(vendor.address);
    await c.connect(buyer).confirmAndRelease(0);
    const after = await ethers.provider.getBalance(vendor.address);

    // 5% penalty on 1 ETH => 0.95 ETH paid out
    expect(after - before).to.equal(ethers.parseEther("0.95"));
  });

  it("blocks a non-approver from approving and a non-party from signing", async function () {
    const c = await createSampleContract();
    await c.connect(vendor).anchorDocument(ethers.keccak256(ethers.toUtf8Bytes("x")), "ipfs://x", "Draft");
    await c.connect(vendor).submitForApproval();

    await expect(c.connect(outsider).approve()).to.be.revertedWith(
      "Only a designated approver can call this"
    );

    await c.connect(deptApprover).approve();
    await expect(c.connect(outsider).signAsVendor()).to.be.revertedWith("Only vendor can call this");
  });

  it("supports dispute -> arbitration vote -> resolution", async function () {
    const c = await createSampleContract();
    await c.connect(vendor).anchorDocument(ethers.keccak256(ethers.toUtf8Bytes("x")), "ipfs://x", "Draft");
    await c.connect(vendor).submitForApproval();
    await c.connect(deptApprover).approve();
    await c.connect(vendor).signAsVendor();
    await c.connect(buyer).signAsBuyer();

    await c.connect(buyer).raiseDispute("Quality issue with milestone 1");
    expect(await c.status()).to.equal(5); // Disputed

    await c.connect(deptApprover).arbitrationVoteFor(vendor.address);
    await c.connect(financeApprover).arbitrationVoteFor(vendor.address);

    expect(await c.arbitrationWinner()).to.equal(vendor.address);
    expect(await c.status()).to.equal(4); // back to Active
  });
});
