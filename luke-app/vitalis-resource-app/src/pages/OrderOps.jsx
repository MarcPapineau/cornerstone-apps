/**
 * OrderOps.jsx — legacy entry point. The monolithic Order Ops page was split (Sprint 3) into
 * banner-per-screen sub-routes under /admin/orders/* (see src/pages/order-ops/). This stub simply
 * redirects to the new Order Ops overview so any old link/import still resolves.
 */
import { Navigate } from 'react-router-dom';

export default function OrderOps() {
  return <Navigate to="/admin/orders" replace />;
}
