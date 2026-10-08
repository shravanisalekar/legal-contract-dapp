const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying ContractFactory with account:", deployer.address);

  const Factory = await hre.ethers.getContractFactory("ContractFactory");
  const factory = await Factory.deploy();
  await factory.waitForDeployment();

  const factoryAddress = await factory.getAddress();
  console.log("ContractFactory deployed to:", factoryAddress);
  console.log("Super admin (deployer) address:", deployer.address);

  // Write address + ABI out for the backend and frontend to pick up automatically.
  const artifact = await hre.artifacts.readArtifact("ContractFactory");
  const lifecycleArtifact = await hre.artifacts.readArtifact("ContractLifecycle");

  const outDir = path.join(__dirname, "..", "deployed");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

  fs.writeFileSync(
    path.join(outDir, "factory-address.json"),
    JSON.stringify({ address: factoryAddress, superAdmin: deployer.address, network: hre.network.name }, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, "ContractFactory.abi.json"),
    JSON.stringify(artifact.abi, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, "ContractLifecycle.abi.json"),
    JSON.stringify(lifecycleArtifact.abi, null, 2)
  );

  console.log("\nWrote deployment info to ./deployed/");
  console.log("Copy factory-address.json's address into backend/.env and frontend/.env as FACTORY_ADDRESS / VITE_FACTORY_ADDRESS");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
