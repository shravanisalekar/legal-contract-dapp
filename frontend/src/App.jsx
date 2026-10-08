import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";
import CreateContract from "./pages/CreateContract";
import ContractDetail from "./pages/ContractDetail";
import AdminPanel from "./pages/AdminPanel";
import AuditTrail from "./pages/AuditTrail";

function ProtectedRoute({ children, roles }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  const { user } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" /> : <Login />} />
      <Route path="/register" element={user ? <Navigate to="/dashboard" /> : <Register />} />

      <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
      <Route path="/contracts/new" element={<ProtectedRoute roles={["BUYER"]}><CreateContract /></ProtectedRoute>} />
      <Route path="/contracts/:id" element={<ProtectedRoute><ContractDetail /></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute roles={["SUPER_ADMIN"]}><AdminPanel /></ProtectedRoute>} />
      <Route path="/audit" element={<ProtectedRoute roles={["SUPER_ADMIN", "AUDITOR"]}><AuditTrail /></ProtectedRoute>} />

      <Route path="*" element={<Navigate to={user ? "/dashboard" : "/login"} replace />} />
    </Routes>
  );
}
