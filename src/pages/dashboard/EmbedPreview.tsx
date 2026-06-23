import React, { useState } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import type { Locator } from './DashboardLayout';
import { 
  Code, 
  Copy, 
  Check, 
  ExternalLink, 
  Monitor, 
  Smartphone, 
  Globe 
} from 'lucide-react';

interface OutletContextType {
  activeLocator: Locator | null;
}

export const EmbedPreview: React.FC = () => {
  const { activeLocator } = useOutletContext<OutletContextType>();
  const [copied, setCopied] = useState(false);
  const [previewMode, setPreviewMode] = useState<'desktop' | 'mobile'>('desktop');

  if (!activeLocator) {
    return (
      <div style={{ color: 'white', textAlign: 'center', padding: '40px' }}>
        No hay ningún localizador seleccionado.
      </div>
    );
  }

  const widgetUrl = `${window.location.origin}/l/${activeLocator.slug}`;
  const iframeCode = `<iframe src="${widgetUrl}" width="100%" height="650px" style="border:0; border-radius:12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08);" allow="geolocation" title="${activeLocator.name}"></iframe>`;

  const handleCopy = () => {
    navigator.clipboard.writeText(iframeCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div>
      {/* Header */}
      <div className="admin-header">
        <div>
          <h1 className="admin-title">Integrar Localizador</h1>
          <p className="admin-subtitle">Inserta el buscador de tiendas en tu sitio web con un simple código</p>
        </div>
        <Link to={`/l/${activeLocator.slug}`} target="_blank" className="btn btn-primary">
          Abrir en pestaña nueva
          <ExternalLink size={14} />
        </Link>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px', alignItems: 'start' }}>
        
        {/* Left Side: Embed Instructions */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          
          {/* Card 1: Copy Code */}
          <div className="panel" style={{ margin: 0 }}>
            <h3 style={{ fontSize: '16px', color: 'white', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Code size={18} style={{ color: 'var(--color-primary)' }} /> Código de Inserción (IFrame)
            </h3>
            <p style={{ color: 'var(--color-dark-text-secondary)', fontSize: '14px', marginBottom: '16px' }}>
              Copia y pega este código HTML en la sección donde desees que aparezca el mapa en tu sitio web.
            </p>

            <div className="code-block" style={{ marginBottom: '16px' }}>
              {iframeCode}
              <button 
                onClick={handleCopy}
                style={{
                  position: 'absolute',
                  top: '12px',
                  right: '12px',
                  backgroundColor: 'var(--color-dark-surface)',
                  border: '1px solid var(--color-dark-border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '6px',
                  color: 'white',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                {copied ? <Check size={14} style={{ color: 'var(--color-success)' }} /> : <Copy size={14} />}
                <span style={{ fontSize: '12px' }}>{copied ? 'Copiado' : 'Copiar'}</span>
              </button>
            </div>
            
            <span style={{ fontSize: '12px', color: 'var(--color-dark-text-tertiary)', display: 'flex', gap: '6px' }}>
              <Globe size={14} style={{ flexShrink: 0 }} />
              <span>
                El localizador cuenta con permisos de geolocalización (`allow="geolocation"`) para que los usuarios puedan encontrar las tiendas más cercanas a su posición actual de forma automática.
              </span>
            </span>
          </div>

          {/* Card 2: Platforms Guides */}
          <div className="panel" style={{ margin: 0, display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <h3 style={{ fontSize: '16px', color: 'white', borderBottom: '1px solid var(--color-dark-border)', paddingBottom: '10px' }}>
              ¿Cómo integrarlo en tu plataforma?
            </h3>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', fontSize: '14px' }}>
              <div>
                <strong style={{ color: 'white', display: 'block', marginBottom: '4px' }}>WordPress</strong>
                <span style={{ color: 'var(--color-dark-text-secondary)' }}>
                  Añade un bloque de <strong>HTML personalizado</strong> en Gutenberg o en Elementor, y pega el código copiado.
                </span>
              </div>
              
              <div>
                <strong style={{ color: 'white', display: 'block', marginBottom: '4px' }}>Shopify</strong>
                <span style={{ color: 'var(--color-dark-text-secondary)' }}>
                  Ve a Páginas, selecciona tu página de contacto/locales, haz clic en el botón <strong>Mostrar HTML</strong> (&lt;&gt;) en el editor de contenido y pega el código.
                </span>
              </div>

              <div>
                <strong style={{ color: 'white', display: 'block', marginBottom: '4px' }}>Webflow</strong>
                <span style={{ color: 'var(--color-dark-text-secondary)' }}>
                  Arrastra un componente de tipo <strong>Embed Code</strong> a la sección de la página y inserta el iframe dentro del cuadro de texto.
                </span>
              </div>
            </div>
          </div>

        </div>

        {/* Right Side: Resizable Live Preview */}
        <div style={{ position: 'sticky', top: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={{ fontSize: '16px', color: 'white' }}>Vista Previa en Vivo</h3>
            
            {/* View selectors */}
            <div style={{ 
              display: 'flex', 
              backgroundColor: 'var(--color-dark-surface)', 
              border: '1px solid var(--color-dark-border)', 
              borderRadius: 'var(--radius-sm)',
              padding: '2px'
            }}>
              <button 
                onClick={() => setPreviewMode('desktop')}
                style={{
                  background: previewMode === 'desktop' ? 'rgba(99,102,241,0.15)' : 'none',
                  border: 'none',
                  color: previewMode === 'desktop' ? 'white' : 'var(--color-dark-text-secondary)',
                  cursor: 'pointer',
                  padding: '6px 12px',
                  fontSize: '12px',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <Monitor size={14} /> Desktop
              </button>
              <button 
                onClick={() => setPreviewMode('mobile')}
                style={{
                  background: previewMode === 'mobile' ? 'rgba(99,102,241,0.15)' : 'none',
                  border: 'none',
                  color: previewMode === 'mobile' ? 'white' : 'var(--color-dark-text-secondary)',
                  cursor: 'pointer',
                  padding: '6px 12px',
                  fontSize: '12px',
                  borderRadius: 'var(--radius-sm)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <Smartphone size={14} /> Móvil
              </button>
            </div>
          </div>

          {/* IFrame Preview container */}
          <div style={{
            width: '100%',
            maxWidth: previewMode === 'mobile' ? '375px' : '100%',
            height: '600px',
            border: '1px solid var(--color-dark-border)',
            borderRadius: 'var(--radius-lg)',
            overflow: 'hidden',
            backgroundColor: '#ffffff',
            boxShadow: 'var(--shadow-xl)',
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            margin: previewMode === 'mobile' ? '0 auto' : '0'
          }}>
            <iframe 
              src={widgetUrl}
              title="Widget Preview"
              style={{
                width: '100%',
                height: '100%',
                border: 'none'
              }}
            />
          </div>
        </div>

      </div>
    </div>
  );
};
