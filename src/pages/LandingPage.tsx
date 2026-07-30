import React from 'react';
import { Link } from 'react-router-dom';
import { MapPin, ArrowRight } from 'lucide-react';

export const LandingPage: React.FC = () => {
  return (
    <div style={{
      backgroundColor: '#FAF8F5',
      color: '#0F172A',
      minHeight: '100vh',
      fontFamily: 'var(--font-sans)',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between'
    }}>
      {/* Header / Nav */}
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '24px 60px',
        maxWidth: '1200px',
        width: '100%',
        margin: '0 auto'
      }}>
        {/* Brand New Logo */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <img 
            src="/src/assets/logo.png" 
            alt="BlissCorp Logo" 
            style={{ height: '48px', objectFit: 'contain' }} 
          />
        </div>
        
        {/* Single Navigation Action */}
        <nav>
          <Link 
            to="/login" 
            className="btn btn-primary" 
            style={{ 
              padding: '10px 24px', 
              borderRadius: 'var(--radius-md)', 
              fontSize: '15px', 
              fontWeight: 600,
              backgroundColor: '#1EC8AA',
              borderColor: '#1EC8AA',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              boxShadow: '0 4px 12px rgba(30, 200, 170, 0.25)'
            }}
          >
            Ingresar
            <ArrowRight size={16} />
          </Link>
        </nav>
      </header>

      {/* Main Hero Section */}
      <section style={{
        maxWidth: '900px',
        margin: '0 auto',
        padding: '60px 20px 100px 20px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '24px',
        flexGrow: 1,
        justifyContent: 'center'
      }}>
        {/* Company Badge */}
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          backgroundColor: 'rgba(30, 200, 170, 0.1)',
          border: '1px solid rgba(30, 200, 170, 0.3)',
          padding: '6px 18px',
          borderRadius: 'var(--radius-full)',
          fontSize: '14px',
          color: '#00506E',
          fontWeight: 600
        }}>
          <MapPin size={15} style={{ color: '#1EC8AA' }} />
          PlazaDerma — BlissCorp
        </div>
        
        {/* Heading */}
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: '52px',
          fontWeight: 800,
          lineHeight: '1.15',
          color: '#00506E',
          maxWidth: '750px',
          letterSpacing: '-0.02em'
        }}>
          Mapa de Médicos BlissCorp
        </h1>
        
        {/* Simple Subtitle */}
        <p style={{
          color: '#475569',
          fontSize: '18px',
          maxWidth: '580px',
          lineHeight: '1.6'
        }}>
          Directorio interactivo de médicos especialistas y catálogo de productos de la empresa BlissCorp.
        </p>

        {/* Single CTA Action Button */}
        <div style={{ marginTop: '12px' }}>
          <Link 
            to="/login" 
            className="btn btn-primary" 
            style={{ 
              padding: '14px 38px', 
              fontSize: '17px',
              fontWeight: 700,
              backgroundColor: '#1EC8AA',
              borderColor: '#1EC8AA',
              color: '#ffffff',
              borderRadius: 'var(--radius-md)',
              boxShadow: '0 8px 20px rgba(30, 200, 170, 0.3)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '10px'
            }}
          >
            Ingresar
            <ArrowRight size={18} />
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer style={{
        borderTop: '1px solid #E5DFD5',
        padding: '24px 20px',
        textAlign: 'center',
        color: '#64748B',
        fontSize: '14px',
        backgroundColor: '#FFFFFF'
      }}>
        <p>&copy; {new Date().getFullYear()} BlissCorp. Todos los derechos reservados.</p>
      </footer>
    </div>
  );
};
