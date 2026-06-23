import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { UserPlus, Mail, Lock, User, AlertCircle, ArrowLeft } from 'lucide-react';

export const RegisterPage: React.FC = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    // 1. Sign up the user in Supabase
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          display_name: name,
        }
      }
    });

    if (signUpError) {
      setError(signUpError.message);
      setLoading(false);
      return;
    }

    // 2. To ensure immediate login (especially if email confirmation is disabled on Supabase backend),
    // we attempt to sign in right after signing up.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      // If sign in fails, but sign up succeeded, it might be because email confirmation is still turned on in Supabase settings
      setError(
        "Cuenta creada con éxito. Si la confirmación de correo está activada en Supabase, por favor revisa tu correo. De lo contrario, intenta ingresar."
      );
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
          <h2 style={{ fontSize: '24px', fontWeight: 700, fontFamily: 'var(--font-display)' }}>Crea tu cuenta gratis</h2>
          <p style={{ color: '#9ca3af', fontSize: '14px', marginTop: '6px' }}>Crea y personaliza localizadores en minutos</p>
        </div>

        {/* Error / Info Alert */}
        {error && (
          <div style={{
            backgroundColor: error.includes("éxito") ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            border: error.includes("éxito") ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(239, 68, 68, 0.2)',
            color: error.includes("éxito") ? '#34d399' : '#f87171',
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
        <form onSubmit={handleRegister} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Nombre Completo / Empresa</label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <User size={18} style={{ position: 'absolute', left: '12px', color: '#6b7280' }} />
              <input
                type="text"
                required
                placeholder="Blisscorp SAC"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="form-control"
                style={{ width: '100%', paddingLeft: '40px' }}
              />
            </div>
          </div>

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
                placeholder="Mínimo 6 caracteres"
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
                <UserPlus size={18} />
                Crear Cuenta
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
          ¿Ya tienes una cuenta?{' '}
          <Link to="/login" style={{ color: '#6366f1', fontWeight: 600 }}>
            Inicia Sesión
          </Link>
        </div>
      </div>
    </div>
  );
};
