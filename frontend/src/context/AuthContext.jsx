import { createContext, useContext, useEffect, useState } from "react";
import api from "../api";
import { connectWallet, hasWallet } from "../web3";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw) : null;
  });
  const [walletAddress, setWalletAddress] = useState(null);
  const [walletWarning, setWalletWarning] = useState(null);

  useEffect(() => {
    if (hasWallet() && window.ethereum.selectedAddress) {
      setWalletAddress(window.ethereum.selectedAddress);
    }
  }, []);

  async function login(email, password) {
    const { data } = await api.post("/auth/login", { email, password });
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }

  async function register(payload) {
    const { data } = await api.post("/auth/register", payload);
    localStorage.setItem("token", data.token);
    localStorage.setItem("user", JSON.stringify(data.user));
    setUser(data.user);
    return data.user;
  }

  function logout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
    setWalletAddress(null);
  }

  async function connect() {
    const { address } = await connectWallet();
    setWalletAddress(address);
    if (user?.walletAddress && address.toLowerCase() !== user.walletAddress.toLowerCase()) {
      setWalletWarning(
        `Connected wallet (${address.slice(0, 6)}...${address.slice(-4)}) does not match the wallet address registered on your account. On-chain actions may fail role checks in the smart contract.`
      );
    } else {
      setWalletWarning(null);
    }
    return address;
  }

  return (
    <AuthContext.Provider value={{ user, walletAddress, walletWarning, login, register, logout, connect }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
