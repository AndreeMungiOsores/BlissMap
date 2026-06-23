import React from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Palette, Code, Map, ArrowRight } from 'lucide-react';

export const LandingPage: React.FC = () => {
  return (
    <div style={{
      backgroundColor: '#090d16',
      color: '#f9fafb',
      minHeight: '100vh',
      fontFamily: 'var(--font-sans)',
      overflowX: 'hidden'
    }}>
      {/* Header / Nav */}
      <header style={{
        display: 'flex',
        justifyContent: 'between',
        alignItems: 'center',
        padding: '20px 80px',
        maxWidth: '1200px',
        margin: '0 auto',
        flexWrap: 'wrap',
        gap: '20px'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <img src="/src/assets/logo.svg" alt="BlissMap Logo" style={{ width: '36px', height: '36px' }} />
          <span style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: '24px',
            background: 'linear-gradient(135deg, #ec4899, #8b5cf6)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent'
          }}>BlissMap</span>
        </div>
        
        <nav style={{ display: 'flex', gap: '30px', alignItems: 'center' }}>
          <Link to="/login" style={{ color: '#9ca3af', fontWeight: 500, transition: 'color 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.color = '#f9fafb'} onMouseLeave={(e) => e.currentTarget.style.color = '#9ca3af'}>Iniciar Sesión</Link>
          <Link to="/register" className="btn btn-primary" style={{ padding: '8px 18px', borderRadius: 'var(--radius-sm)' }}>
            Crear mi Localizador
            <ArrowRight size={16} />
          </Link>
        </nav>
      </header>

      {/* Hero Section */}
      <section style={{
        maxWidth: '1000px',
        margin: '0 auto',
        padding: '100px 20px',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '24px'
      }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          backgroundColor: 'rgba(99, 102, 241, 0.1)',
          border: '1px solid rgba(99, 102, 241, 0.2)',
          padding: '6px 16px',
          borderRadius: 'var(--radius-full)',
          fontSize: '14px',
          color: '#818cf8',
          fontWeight: 500
        }}>
          <MapPin size={14} />
          Localizadores Personalizados de Tiendas
        </div>
        
        <h1 style={{
          fontFamily: 'var(--font-display)',
          fontSize: '56px',
          fontWeight: 800,
          lineHeight: '1.15',
          background: 'linear-gradient(to right, #ffffff, #9ca3af)',
          WebkitBackgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
          maxWidth: '800px'
        }}>
          Un hermoso localizador de tiendas para tu sitio web
        </h1>
        
        <p style={{
          color: '#9ca3af',
          fontSize: '18px',
          maxWidth: '600px',
          lineHeight: '1.6'
        }}>
          Configúralo en minutos sin código y mantenlo actualizado. Adaptado a tu marca con todo lo que necesitas para que tus clientes te encuentren.
        </p>

        <div style={{ display: 'flex', gap: '16px', marginTop: '16px' }}>
          <Link to="/register" className="btn btn-primary" style={{ padding: '12px 28px', fontSize: '16px' }}>
            Comienza tu prueba gratis
          </Link>
          <Link to="/login" className="btn btn-secondary" style={{
            padding: '12px 28px',
            fontSize: '16px',
            borderColor: '#1f2937',
            color: '#f9fafb'
          }} onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#111827'} onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}>
            Ver Demo
          </Link>
        </div>
      </section>

      {/* Features Grid */}
      <section style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: '0 40px 100px 40px',
      }}>
        <div style={{
          textAlign: 'center',
          marginBottom: '60px'
        }}>
          <h2 style={{ fontSize: '36px', fontFamily: 'var(--font-display)', fontWeight: 800 }}>Todo lo que necesitas en una sola plataforma</h2>
          <p style={{ color: '#9ca3af', marginTop: '10px' }}>Agrega, diseña e integra sin complicaciones.</p>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
          gap: '30px'
        }}>
          {/* Feature 1 */}
          <div style={{
            backgroundColor: '#111827',
            border: '1px solid #1f2937',
            borderRadius: 'var(--radius-lg)',
            padding: '30px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'rgba(236, 72, 153, 0.1)',
              color: '#ec4899',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Palette size={24} />
            </div>
            <h3 style={{ fontSize: '20px', fontWeight: 700 }}>Diseño Personalizable</h3>
            <p style={{ color: '#9ca3af', fontSize: '15px' }}>
              Cambia el estilo de tu mapa, los colores del widget y sube tu propio icono de marcador para adaptarlo perfectamente a tu marca corporativa.
            </p>
          </div>

          {/* Feature 2 */}
          <div style={{
            backgroundColor: '#111827',
            border: '1px solid #1f2937',
            borderRadius: 'var(--radius-lg)',
            padding: '30px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'rgba(139, 92, 246, 0.1)',
              color: '#8b5cf6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Map size={24} />
            </div>
            <h3 style={{ fontSize: '20px', fontWeight: 700 }}>Geocodificación Precisa</h3>
            <p style={{ color: '#9ca3af', fontSize: '15px' }}>
              Buscador integrado impulsado por Google Maps para ubicar direcciones y un marcador arrastrable para correcciones milimétricas en el mapa.
            </p>
          </div>

          {/* Feature 3 */}
          <div style={{
            backgroundColor: '#111827',
            border: '1px solid #1f2937',
            borderRadius: 'var(--radius-lg)',
            padding: '30px',
            display: 'flex',
            flexDirection: 'column',
            gap: '16px'
          }}>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: 'var(--radius-md)',
              backgroundColor: 'rgba(99, 102, 241, 0.1)',
              color: '#6366f1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}>
              <Code size={24} />
            </div>
            <h3 style={{ fontSize: '20px', fontWeight: 700 }}>Integración Rápida</h3>
            <p style={{ color: '#9ca3af', fontSize: '15px' }}>
              Copia y pega un simple código iframe en tu web (WordPress, Shopify, Webflow o código propio) y tu mapa estará listo en segundos.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{
        borderTop: '1px solid #1f2937',
        padding: '40px 20px',
        textAlign: 'center',
        color: '#6b7280',
        fontSize: '14px'
      }}>
        <p>&copy; {new Date().getFullYear()} BlissMap. Todos los derechos reservados.</p>
      </footer>
    </div>
  );
};
