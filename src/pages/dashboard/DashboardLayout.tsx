import React, { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../supabaseClient';
import { 
  Map, 
  MapPin, 
  Settings, 
  Code, 
  LogOut, 
  Menu, 
  X, 
  User,
  Plus
} from 'lucide-react';

export interface Locator {
  id: string;
  name: string;
  slug: string;
  map_style: string;
  accent_color: string;
  marker_type: string;
  marker_color: string;
  marker_image_url: string | null;
  search_placeholder: string;
  distance_unit: string;
}

export const DashboardLayout: React.FC = () => {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  
  const [locators, setLocators] = useState<Locator[]>([]);
  const [activeLocator, setActiveLocator] = useState<Locator | null>(null);
  const [loading, setLoading] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const fetchLocators = async () => {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('bm_locators')
        .select('*')
        .order('created_at', { ascending: true });

      if (error) throw error;
      
      setLocators(data || []);
      
      // Keep active locator synced
      if (data && data.length > 0) {
        const storedId = localStorage.getItem('bm_active_locator_id');
        const found = data.find(l => l.id === storedId);
        if (found) {
          setActiveLocator(found);
        } else {
          setActiveLocator(data[0]);
          localStorage.setItem('bm_active_locator_id', data[0].id);
        }
      } else {
        setActiveLocator(null);
        localStorage.removeItem('bm_active_locator_id');
      }
    } catch (err) {
      console.error('Error fetching locators:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLocators();
  }, [user]);

  const handleLocatorChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const selected = locators.find(l => l.id === e.target.value);
    if (selected) {
      setActiveLocator(selected);
      localStorage.setItem('bm_active_locator_id', selected.id);
    }
  };

  const handleLogout = async () => {
    await signOut();
    navigate('/');
  };

  const isActive = (path: string) => {
    if (path === '/dashboard') {
      return location.pathname === '/dashboard';
    }
    return location.pathname.startsWith(path);
  };

  return (
    <div className="admin-theme" style={{ display: 'flex', width: '100%' }}>
      {/* Mobile Toggle Button */}
      <button 
        style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          zIndex: 100,
          display: 'none', // Managed by responsive CSS if added, otherwise keep inline logic
          backgroundColor: 'var(--color-dark-surface)',
          border: '1px solid var(--color-dark-border)',
          borderRadius: 'var(--radius-sm)',
          padding: '8px',
          color: 'white',
          cursor: 'pointer'
        }}
        onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
        className="mobile-menu-toggle"
      >
        {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {/* Sidebar */}
      <aside className={`sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`} style={{
        // Add mobile conditional styles manually to ensure zero dependency layout
        zIndex: 50
      }}>
        <div>
          {/* Brand Logo */}
          <div className="sidebar-header">
            <img src="/src/assets/logo.svg" alt="BlissMap Logo" style={{ width: '28px', height: '28px' }} />
            <span className="sidebar-logo-text">BlissMap</span>
          </div>

          {/* Active Locator Selector */}
          <div className="locator-selector-container">
            <label className="form-label" style={{ fontSize: '11px', textTransform: 'uppercase', marginBottom: '6px', letterSpacing: '0.05em' }}>
              Localizador Activo
            </label>
            {locators.length > 0 ? (
              <select 
                value={activeLocator?.id || ''} 
                onChange={handleLocatorChange}
                className="locator-selector"
              >
                {locators.map(l => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </select>
            ) : (
              <button 
                onClick={() => navigate('/dashboard')}
                className="btn btn-secondary" 
                style={{ 
                  width: '100%', 
                  fontSize: '13px', 
                  padding: '8px', 
                  color: 'white', 
                  borderColor: 'var(--color-dark-border)', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  gap: '4px'
                }}
              >
                <Plus size={14} />
                Crear Localizador
              </button>
            )}
          </div>

          {/* Sidebar Menu Items */}
          <nav style={{ padding: '14px 0' }}>
            <ul className="sidebar-menu">
              <li>
                <Link 
                  to="/dashboard" 
                  className={`sidebar-item ${isActive('/dashboard') && location.pathname === '/dashboard' ? 'active' : ''}`}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <Map size={18} />
                  Mis Localizadores
                </Link>
              </li>
              {activeLocator && (
                <>
                  <li>
                    <Link 
                      to="/dashboard/locations" 
                      className={`sidebar-item ${isActive('/dashboard/locations') ? 'active' : ''}`}
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      <MapPin size={18} />
                      Ubicaciones
                    </Link>
                  </li>
                  <li>
                    <Link 
                      to="/dashboard/settings" 
                      className={`sidebar-item ${isActive('/dashboard/settings') ? 'active' : ''}`}
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      <Settings size={18} />
                      Diseño y Marcadores
                    </Link>
                  </li>
                  <li>
                    <Link 
                      to="/dashboard/embed" 
                      className={`sidebar-item ${isActive('/dashboard/embed') ? 'active' : ''}`}
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      <Code size={18} />
                      Integrar y Vista Previa
                    </Link>
                  </li>
                </>
              )}
            </ul>
          </nav>
        </div>

        {/* Sidebar User Footer */}
        <div className="sidebar-footer">
          <div className="user-badge">
            <div className="user-avatar">
              {user?.email ? user.email.charAt(0).toUpperCase() : <User size={16} />}
            </div>
            <div className="user-info">
              <span className="user-name">{user?.user_metadata?.display_name || user?.email}</span>
              <span className="user-role">Administrador</span>
            </div>
          </div>
          <button className="logout-btn" onClick={handleLogout} title="Cerrar Sesión">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      {/* Main Panel Content */}
      <main className="admin-main">
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            <div className="spinner"></div>
          </div>
        ) : (
          <Outlet context={{ 
            locators, 
            activeLocator, 
            setActiveLocator, 
            fetchLocators 
          }} />
        )}
      </main>
    </div>
  );
};
