import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthProvider";
import { Shell } from "./components/Shell";
import { ClientDetailPage } from "./pages/ClientDetail";
import { ClientsPage } from "./pages/Clients";
import { LoginPage } from "./pages/Login";
import { PiDetailPage } from "./pages/PiDetail";
import { PiEditorPage } from "./pages/PiEditor";
import { PiListPage } from "./pages/PiList";
import { ProductDetailPage } from "./pages/ProductDetail";
import { ProductsPage } from "./pages/Products";
import { ResetPasswordPage } from "./pages/ResetPassword";
import { SettingsPage } from "./pages/Settings";
import { VendorDetailPage } from "./pages/VendorDetail";
import { VendorsPage } from "./pages/Vendors";

function RequireAuth() {
  const { session, profile, loading } = useAuth();
  if (loading) {
    return <p className="p-8 text-sm text-slate-600">Loading…</p>;
  }
  if (!session || !profile) return <Navigate to="/login" replace />;
  return <Shell />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/forgot-password" element={<LoginPage mode="forgot" />} />
      <Route path="/reset-password" element={<ResetPasswordPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<Navigate to="/pis" replace />} />
        <Route path="/pis" element={<PiListPage />} />
        <Route path="/pis/:id" element={<PiDetailPage />} />
        <Route path="/pis/:id/edit" element={<PiEditorPage />} />
        <Route path="/clients" element={<ClientsPage />} />
        <Route path="/clients/new" element={<ClientDetailPage />} />
        <Route path="/clients/:id" element={<ClientDetailPage />} />
        <Route path="/vendors" element={<VendorsPage />} />
        <Route path="/vendors/new" element={<VendorDetailPage />} />
        <Route path="/vendors/:id" element={<VendorDetailPage />} />
        <Route path="/products" element={<ProductsPage />} />
        <Route path="/products/new" element={<ProductDetailPage />} />
        <Route path="/products/:id" element={<ProductDetailPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/pis" replace />} />
    </Routes>
  );
}
