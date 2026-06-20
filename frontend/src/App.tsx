// ניתוב ראשי של Kerem Orders
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AdminRoute } from './components/AdminRoute'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AuthProvider } from './lib/auth'
import { CartProvider } from './lib/cart'
import { AdminSyncPage } from './pages/AdminSyncPage'
import { AdminCustomersPage } from './pages/admin/AdminCustomersPage'
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage'
import { AdminOrderDetailPage } from './pages/admin/AdminOrderDetailPage'
import { AdminOrdersPage } from './pages/admin/AdminOrdersPage'
import { CatalogPage } from './pages/CatalogPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { MyOrdersPage } from './pages/MyOrdersPage'
import { OrderDetailPage } from './pages/OrderDetailPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { SignupPage } from './pages/SignupPage'
import { CRM_ENABLED } from './crm/config'
import { CrmApp } from './crm/CrmApp'
import { CATALOG_ENABLED } from './catalog/config'
import { StorePage } from './catalog/StorePage'
import { AdminCatalogPage } from './catalog/AdminCatalogPage'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CartProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/reset-password" element={<ResetPasswordPage />} />
            <Route path="/" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
            <Route path="/catalog" element={<ProtectedRoute><CatalogPage /></ProtectedRoute>} />
            <Route path="/orders" element={<ProtectedRoute><MyOrdersPage /></ProtectedRoute>} />
            <Route path="/orders/:orderId" element={<ProtectedRoute><OrderDetailPage /></ProtectedRoute>} />
            <Route path="/admin" element={<AdminRoute><AdminDashboardPage /></AdminRoute>} />
            <Route path="/admin/orders" element={<AdminRoute><AdminOrdersPage /></AdminRoute>} />
            <Route path="/admin/orders/:orderId" element={<AdminRoute><AdminOrderDetailPage /></AdminRoute>} />
            <Route path="/admin/customers" element={<AdminRoute><AdminCustomersPage /></AdminRoute>} />
            <Route path="/admin/sync" element={<AdminRoute><AdminSyncPage /></AdminRoute>} />
            {CRM_ENABLED && (
              <Route path="/crm/*" element={<AdminRoute><CrmApp /></AdminRoute>} />
            )}
            {CATALOG_ENABLED && (
              <>
                <Route path="/store" element={<ProtectedRoute><StorePage /></ProtectedRoute>} />
                <Route path="/admin/catalog" element={<AdminRoute><AdminCatalogPage /></AdminRoute>} />
              </>
            )}
          </Routes>
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
