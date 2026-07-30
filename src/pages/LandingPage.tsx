import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import logoImg from '../assets/logo.png';

export const LandingPage: React.FC = () => {
  return (
    <div style={{
      backgroundColor: '#FAF8F5',
      color: '#0F172A',
      minHeight: '100vh',
      fontFamily: 'var(--font-sans)',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      alignItems: 'center'
    }}>
      {/* Main Centered Content */}
      <main style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '40px',
        flexGrow: 1,
        padding: '40px 20px',
        textAlign: 'center'
      }}>
        {/* Large PlazaDerma Logo */}
        <div>
          <img 
            src={logoImg} 
            alt="PlazaDerma Logo" 
            style={{ 
              height: '220px', 
              maxWidth: '90vw', 
              objectFit: 'contain',
              filter: 'drop-shadow(0 6px 18px rgba(0,0,0,0.06))'
            }} 
          />
        </div>

        {/* Single Primary CTA Button */}
        <div>
          <Link 
            to="/login" 
            className="btn btn-primary" 
            style={{ 
              padding: '16px 48px', 
              fontSize: '18px',
              fontWeight: 700,
              backgroundColor: '#1EC8AA',
              borderColor: '#1EC8AA',
              color: '#ffffff',
              borderRadius: 'var(--radius-md)',
              boxShadow: '0 8px 25px rgba(30, 200, 170, 0.35)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '12px',
              transition: 'transform 0.2s ease, box-shadow 0.2s ease'
            }}
          >
            Ingresar
            <ArrowRight size={20} />
          </Link>
        </div>
      </main>

      {/* Footer */}
      <footer style={{
        borderTop: '1px solid #E5DFD5',
        padding: '24px 20px',
        textAlign: 'center',
        color: '#64748B',
        fontSize: '14px',
        width: '100%',
        backgroundColor: '#FFFFFF'
      }}>
        <p>&copy; {new Date().getFullYear()} BlissCorp. Todos los derechos reservados.</p>
      </footer>
    </div>
  );
};
