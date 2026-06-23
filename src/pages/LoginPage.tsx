import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { LogIn, Mail, Lock, AlertCircle, ArrowLeft } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
    } else {
      navigate('/dashboard');
    }
  };

  return (
    <div style={{
      backgroundColor: '#090d16',
      color: '#f9fafb',
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '20px',
      fontFamily: 'var(--font-sans)'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '440px',
        backgroundColor: '#111827',
        border: '1px solid #1f2937',
        borderRadius: 'var(--radius-lg)',
        padding: '40px',
        boxShadow: 'var(--shadow-xl)'
      }}>
        {/* Back Link */}
        <Link to="/" style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          color: '#9ca3af',
          fontSize: '14px',
          marginBottom: '24px',
          transition: 'color 0.2s'
        }} onMouseEnter={(e) => e.currentTarget.style.color = '#f9fafb'} onMouseLeave={(e) => e.currentTarget.style.color = '#9ca3af'}>
          <ArrowLeft size={16} />
          Volver al inicio
        </Link>

        {/* Title */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
            <img src="/src/assets/logo.svg" alt="BlissMap Logo" style={{ width: '32px', height: '32px' }} />
            <span style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: '22px',
              background: 'linear-gradient(135deg, #ec4899, #8b5cf6)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent'
            }}>BlissMap</span>
          </div>
          <h2 style={{ fontSize: '24px', fontWeight: 700, fontFamily: 'var(--font-display)' }}>Ingresa a tu cuenta</h2>
          <p style={{ color: '#9ca3af', fontSize: '14px', marginTop: '6px' }}>Gestiona tus localizadores y ubicaciones</p>
        </div>

        {/* Error Alert */}
        {error && (
          <div style={{
            backgroundColor: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.2)',
            color: '#f87171',
            padding: '12px',
            borderRadius: 'var(--radius-md)',
            marginBottom: '20px',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: '14px'
          }}>
            <AlertCircle size={18} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Correo Electrónico</label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Mail size={18} style={{ position: 'absolute', left: '12px', color: '#6b7280' }} />
              <input
                type="email"
                required
                placeholder="ejemplo@blisscorp.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="form-control"
                style={{ width: '100%', paddingLeft: '40px' }}
              />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Contraseña</label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Lock size={18} style={{ position: 'absolute', left: '12px', color: '#6b7280' }} />
              <input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="form-control"
                style={{ width: '100%', paddingLeft: '40px' }}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary"
            style={{ width: '100%', marginTop: '8px', padding: '12px' }}
          >
            {loading ? <div className="spinner" style={{ width: '18px', height: '18px', borderTopColor: '#fff' }}></div> : (
              <>
                <LogIn size={18} />
                Ingresar
              </>
            )}
          </button>
        </form>

        {/* Footer */}
        <div style={{
          textAlign: 'center',
          marginTop: '28px',
          fontSize: '14px',
          color: '#9ca3af',
          borderTop: '1px solid #1f2937',
          paddingTop: '20px'
        }}>
          ¿No tienes una cuenta?{' '}
          <Link to="/register" style={{ color: '#6366f1', fontWeight: 600 }}>
            Registrate ahora
          </Link>
        </div>
      </div>
    </div>
  );
};
