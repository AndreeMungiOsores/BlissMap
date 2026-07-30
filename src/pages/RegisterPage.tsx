import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../supabaseClient';
import { UserPlus, Mail, Lock, User, AlertCircle, ArrowLeft } from 'lucide-react';
import logoImg from '../assets/logo.png';

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

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
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
      backgroundColor: '#FAF8F5',
      color: '#0F172A',
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
        backgroundColor: '#FFFFFF',
        border: '1px solid #E5DFD5',
        borderRadius: 'var(--radius-lg)',
        padding: '40px',
        boxShadow: 'var(--shadow-xl)'
      }}>
        {/* Back Link */}
        <Link to="/" style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          color: '#64748B',
          fontSize: '14px',
          marginBottom: '24px',
          transition: 'color 0.2s',
          fontWeight: 500
        }} onMouseEnter={(e) => e.currentTarget.style.color = '#0F172A'} onMouseLeave={(e) => e.currentTarget.style.color = '#64748B'}>
          <ArrowLeft size={16} />
          Volver al inicio
        </Link>

        {/* Title & Logo */}
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
            <img src={logoImg} alt="BlissCorp Logo" style={{ height: '42px', objectFit: 'contain' }} />
          </div>
          <h2 style={{ fontSize: '24px', fontWeight: 700, fontFamily: 'var(--font-display)', color: '#00506E' }}>Crear Cuenta</h2>
          <p style={{ color: '#64748B', fontSize: '14px', marginTop: '6px' }}>Registra tus datos para acceder al sistema BlissCorp</p>
        </div>

        {/* Error / Info Alert */}
        {error && (
          <div style={{
            backgroundColor: error.includes("éxito") ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
            border: error.includes("éxito") ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(239, 68, 68, 0.2)',
            color: error.includes("éxito") ? '#059669' : '#ef4444',
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
            <label className="form-label" style={{ color: '#334155' }}>Nombre Completo / Empresa</label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <User size={18} style={{ position: 'absolute', left: '12px', color: '#94a3b8' }} />
              <input
                type="text"
                required
                placeholder="BlissCorp S.A.C."
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="form-control"
                style={{ width: '100%', paddingLeft: '40px', borderColor: '#E5DFD5', backgroundColor: '#FAF8F5', color: '#0F172A' }}
              />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ color: '#334155' }}>Correo Electrónico</label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Mail size={18} style={{ position: 'absolute', left: '12px', color: '#94a3b8' }} />
              <input
                type="email"
                required
                placeholder="ejemplo@blisscorp.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="form-control"
                style={{ width: '100%', paddingLeft: '40px', borderColor: '#E5DFD5', backgroundColor: '#FAF8F5', color: '#0F172A' }}
              />
            </div>
          </div>

          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label" style={{ color: '#334155' }}>Contraseña</label>
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Lock size={18} style={{ position: 'absolute', left: '12px', color: '#94a3b8' }} />
              <input
                type="password"
                required
                placeholder="Mínimo 6 caracteres"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="form-control"
                style={{ width: '100%', paddingLeft: '40px', borderColor: '#E5DFD5', backgroundColor: '#FAF8F5', color: '#0F172A' }}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary"
            style={{ width: '100%', marginTop: '8px', padding: '12px', backgroundColor: '#1EC8AA', borderColor: '#1EC8AA', color: '#ffffff', fontWeight: 700 }}
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
          color: '#64748B',
          borderTop: '1px solid #E5DFD5',
          paddingTop: '20px'
        }}>
          ¿Ya tienes una cuenta?{' '}
          <Link to="/login" style={{ color: '#1EC8AA', fontWeight: 600 }}>
            Inicia Sesión
          </Link>
        </div>
      </div>
    </div>
  );
};
