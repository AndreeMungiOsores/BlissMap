import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { DashboardLayout } from './pages/dashboard/DashboardLayout';
import { Overview } from './pages/dashboard/Overview';
import { ManageLocations } from './pages/dashboard/ManageLocations';
import { LocationForm } from './pages/dashboard/LocationForm';
import { WidgetSettings } from './pages/dashboard/WidgetSettings';
import { EmbedPreview } from './pages/dashboard/EmbedPreview';
import { PublicLocator } from './pages/PublicLocator';

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          
          <Route path="/dashboard" element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }>
            <Route index element={<Overview />} />
            <Route path="locations" element={<ManageLocations />} />
            <Route path="locations/new" element={<LocationForm />} />
            <Route path="locations/:id/edit" element={<LocationForm />} />
            <Route path="settings" element={<WidgetSettings />} />
            <Route path="embed" element={<EmbedPreview />} />
          </Route>

          <Route path="/l/:slug" element={<PublicLocator />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
