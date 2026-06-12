// ניתוב ראשי של Kerem Orders
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AdminRoute } from './components/AdminRoute'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AuthProvider } from './lib/auth'
import { CartProvider } from './lib/cart'
import { AdminSyncPage } from './pages/AdminSyncPage'
import { CatalogPage } from './pages/CatalogPage'
import { HomePage } from './pages/HomePage'
import { LoginPage } from './pages/LoginPage'
import { MyOrdersPage } from './pages/MyOrdersPage'
import { OrderDetailPage } from './pages/OrderDetailPage'
import { ResetPasswordPage } from './pages/ResetPasswordPage'
import { SignupPage } from './pages/SignupPage'

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
            <Route path="/admin/sync" element={<AdminRoute><AdminSyncPage /></AdminRoute>} />
          </Routes>
        </CartProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
