import { BrowserProvider, Contract, parseEther } from "ethers";
import factoryAbi from "./abi/ContractFactory.abi.json";
import lifecycleAbi from "./abi/ContractLifecycle.abi.json";

const FACTORY_ADDRESS = import.meta.env.VITE_FACTORY_ADDRESS;

export function hasWallet() {
  return typeof window !== "undefined" && !!window.ethereum;
}

const LOCAL_CHAIN_ID_HEX = "0x539"; // 1337 = the local Hardhat network this app is built against

// Makes sure MetaMask is actually pointed at the local Hardhat chain before
// any transaction is sent. Without this, if MetaMask happens to be left on
// real Ethereum (or any other network) from browsing elsewhere, transactions
// either fail with a confusing "malicious address" warning or, worse, look
// like they might send real funds. Adds the network if it isn't already
// in MetaMask.
async function ensureLocalNetwork() {
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: LOCAL_CHAIN_ID_HEX }]
    });
  } catch (err) {
    if (err.code === 4902 || err.code === -32603) {
      await window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: LOCAL_CHAIN_ID_HEX,
          chainName: "Localhost 8545",
          rpcUrls: ["http://127.0.0.1:8545"],
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }
        }]
      });
    } else {
      throw err;
    }
  }
}

/**
 * Connects to MetaMask and returns { provider, signer, address }.
 * Every on-chain write in this app (approve, sign, fund escrow, etc.)
 * goes through a signer obtained here - meaning the person's own wallet
 * key signs the action. Nothing is ever signed by the backend.
 *
 * Always re-prompts for which account to use (wallet_requestPermissions)
 * instead of silently reusing whatever MetaMask connected last. This app
 * is used by switching between Buyer/Vendor/Approver wallets constantly,
 * so silently reusing the last account is a common source of "wrong
 * signer" errors - forcing the picker every time makes the active role
 * explicit at the moment it matters.
 */
export async function connectWallet() {
  if (!hasWallet()) {
    throw new Error("MetaMask not found. Please install the MetaMask browser extension.");
  }
  await ensureLocalNetwork();
  const provider = new BrowserProvider(window.ethereum);
  await window.ethereum.request({
    method: "wallet_requestPermissions",
    params: [{ eth_accounts: {} }]
  });
  await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  return { provider, signer, address };
}

/**
 * Checks whether a contract actually has deployed code at the given
 * address on the CURRENT chain. Returns false if the address is empty,
 * or if it points at code that existed on a previous local chain that
 * has since been wiped (e.g. hardhat node was restarted) - which is
 * exactly the failure mode that caused the FURNITURE issue. Read-only:
 * does not prompt MetaMask and works even before a wallet is connected.
 */
export async function contractExistsOnChain(address) {
  if (!address || !hasWallet()) return null; // null = "couldn't check", not "missing"
  try {
    const provider = new BrowserProvider(window.ethereum);
    const code = await provider.getCode(address);
    return code !== "0x";
  } catch {
    return null;
  }
}

export async function getFactoryContract(signerOrProvider) {
  if (!FACTORY_ADDRESS) {
    throw new Error("VITE_FACTORY_ADDRESS is not set. Deploy the contracts and set it in frontend/.env");
  }
  return new Contract(FACTORY_ADDRESS, factoryAbi, signerOrProvider);
}

export async function getLifecycleContract(address, signerOrProvider) {
  return new Contract(address, lifecycleAbi, signerOrProvider);
}

export function ethToWei(ethAmount) {
  return parseEther(String(ethAmount));
}

export function toUnixSeconds(dateString) {
  return Math.floor(new Date(dateString).getTime() / 1000);
}

export const FACTORY_ADDR = FACTORY_ADDRESS;
