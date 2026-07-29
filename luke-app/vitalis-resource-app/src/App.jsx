import { Routes, Route, Navigate } from 'react-router-dom';
import { Layout } from './components/Layout.jsx';
import { useRole, ROLE_HOME } from './lib/roleContext.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Clients from './pages/Clients.jsx';
import LabRecommend from './pages/LabRecommend.jsx';
import LabResults from './pages/LabResults.jsx';
import Catalog from './pages/Catalog.jsx';
import Research from './pages/Research.jsx';
import Compliance from './pages/Compliance.jsx';
import Draft from './pages/Draft.jsx';
import ProtocolChat from './pages/ProtocolChat.jsx';
import Referrals from './pages/Referrals.jsx';
import Outcomes from './pages/Outcomes.jsx';
import Nutrition from './pages/Nutrition.jsx';
import Diet from './pages/Diet.jsx';
import ClientPackage from './pages/ClientPackage.jsx';
import DocumentPreview from './pages/DocumentPreview.jsx';
import NotFound from './pages/NotFound.jsx';
// Multi-tenant role surfaces
import AdminOverview from './pages/AdminOverview.jsx';
import AdminPlans from './pages/AdminPlans.jsx';
import AdminSystem from './pages/AdminSystem.jsx';
import AdminPractitioners from './pages/AdminPractitioners.jsx';
import AdminPractitionerDetail from './pages/AdminPractitionerDetail.jsx';
import AdminDirectClients from './pages/AdminDirectClients.jsx';
import OrderOpsLayout from './pages/order-ops/OrderOpsLayout.jsx';
import OrderOpsOverview from './pages/order-ops/OrderOpsOverview.jsx';
import OrderOpsNewOrder from './pages/order-ops/OrderOpsNewOrder.jsx';
import OrderOpsOrders from './pages/order-ops/OrderOpsOrders.jsx';
import OrderOpsCustomers from './pages/order-ops/OrderOpsCustomers.jsx';
import OrderOpsInventory from './pages/order-ops/OrderOpsInventory.jsx';
import OrderOpsSuppliers from './pages/order-ops/OrderOpsSuppliers.jsx';
import OrderOpsReferrals from './pages/order-ops/OrderOpsReferrals.jsx';
import OrderOpsOrderDetail from './pages/order-ops/OrderOpsOrderDetail.jsx';
import OrderOpsCustomerDetail from './pages/order-ops/OrderOpsCustomerDetail.jsx';
import PracticeHome from './pages/PracticeHome.jsx';
import PracticeClients from './pages/PracticeClients.jsx';
import PracticeClientDetail from './pages/PracticeClientDetail.jsx';
import PracticeReviews from './pages/PracticeReviews.jsx';
import PracticeInvitations from './pages/PracticeInvitations.jsx';
import PracticeAddOns from './pages/PracticeAddOns.jsx';
import PortalHome from './pages/PortalHome.jsx';
import PortalProtocols from './pages/PortalProtocols.jsx';
import PortalPackage from './pages/PortalPackage.jsx';
import PortalLabs from './pages/PortalLabs.jsx';
import PortalProgress from './pages/PortalProgress.jsx';
import PortalProfile from './pages/PortalProfile.jsx';
import PortalIntake from './pages/PortalIntake.jsx';
import PortalDocuments from './pages/PortalDocuments.jsx';
import PortalUsage from './pages/PortalUsage.jsx';
import PortalAddOns from './pages/PortalAddOns.jsx';

// The index route lands each role on their home surface (IA: no global workbench landing).
function RoleIndex() {
  const { role } = useRole();
  return <Navigate to={ROLE_HOME[role] || '/admin'} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* Index → role home (admin → platform, practitioner → practice, client → portal) */}
        <Route index element={<RoleIndex />} />

        {/* Client-work tools — reached as per-client DOSSIER actions (?clientId), not nav items.
            Mounted so the dossier "Generate package / Add lab" buttons resolve; off the nav. */}
        <Route path="clients" element={<Clients />} />
        <Route path="labs/recommend" element={<LabRecommend />} />
        <Route path="labs/results" element={<LabResults />} />
        <Route path="generate" element={<ProtocolChat />} />
        <Route path="catalog" element={<Catalog />} />
        <Route path="research" element={<Research />} />
        <Route path="compliance" element={<Compliance />} />
        <Route path="draft" element={<Draft />} />
        <Route path="referrals" element={<Referrals />} />
        <Route path="outcomes" element={<Outcomes />} />
        <Route path="nutrition" element={<Nutrition />} />
        <Route path="diet" element={<Diet />} />
        <Route path="package" element={<ClientPackage />} />
        {/* Vitalis dossier renderer — /document/:silo/:id?role= (peptide live) */}
        <Route path="document/:silo/:id" element={<DocumentPreview />} />

        {/* Vitalis Admin surface — platform operations */}
        <Route path="admin" element={<AdminOverview />} />
        <Route path="admin/plans" element={<AdminPlans />} />
        <Route path="admin/system" element={<AdminSystem />} />
        <Route path="admin/practitioners" element={<AdminPractitioners />} />
        <Route path="admin/practitioners/:id" element={<AdminPractitionerDetail />} />
        <Route path="admin/direct-clients" element={<AdminDirectClients />} />
        {/* Order Ops — internal/operator surface, split into banner-per-screen sub-routes (admin only) */}
        <Route path="admin/orders" element={<OrderOpsLayout />}>
          <Route index element={<OrderOpsOverview />} />
          <Route path="new" element={<OrderOpsNewOrder />} />
          <Route path="list" element={<OrderOpsOrders />} />
          <Route path="customers" element={<OrderOpsCustomers />} />
          <Route path="customers/:id" element={<OrderOpsCustomerDetail />} />
          <Route path="inventory" element={<OrderOpsInventory />} />
          <Route path="suppliers" element={<OrderOpsSuppliers />} />
          <Route path="referrals" element={<OrderOpsReferrals />} />
          <Route path=":id" element={<OrderOpsOrderDetail />} />
        </Route>

        {/* Practitioner surface */}
        <Route path="practice" element={<PracticeHome />} />
        <Route path="practice/clients" element={<PracticeClients />} />
        <Route path="practice/clients/:id" element={<PracticeClientDetail />} />
        <Route path="practice/reviews" element={<PracticeReviews />} />
        <Route path="practice/invitations" element={<PracticeInvitations />} />
        <Route path="practice/add-ons" element={<PracticeAddOns />} />

        {/* Client portal surface (approved resources only) */}
        <Route path="portal" element={<PortalHome />} />
        <Route path="portal/package" element={<PortalPackage />} />
        <Route path="portal/add-ons" element={<PortalAddOns />} />
        <Route path="portal/documents" element={<PortalDocuments />} />
        <Route path="portal/usage" element={<PortalUsage />} />
        <Route path="portal/intake" element={<PortalIntake />} />
        <Route path="portal/protocols" element={<PortalProtocols />} />
        <Route path="portal/explore" element={<ProtocolChat />} />
        <Route path="portal/nutrition" element={<Nutrition />} />
        <Route path="portal/labs" element={<PortalLabs />} />
        <Route path="portal/progress" element={<PortalProgress />} />
        <Route path="portal/profile" element={<PortalProfile />} />

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
