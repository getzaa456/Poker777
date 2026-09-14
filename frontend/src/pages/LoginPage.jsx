import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Auth } from '../lib/api.js';
import { usePageStyles } from '../hooks/usePageStyles.js';
import { GlassButton } from '../components/GlassButton.jsx';

export default function LoginPage() {
  usePageStyles('/assets/css/index.css', '/assets/css/glassmorphism-button.css');
  const navigate = useNavigate();
  const [tab, setTab] = useState('login');
  const [login, setLogin] = useState({ identifier: '', password: '' });
  const [register, setRegister] = useState({ email: '', username: '', password: '', confirm: '' });
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = 'Poker777 — Login';
    if (Auth.hasSession()) navigate('/lobby', { replace: true });
  }, [navigate]);

  async function submitLogin(event) {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await Auth.login(login.identifier.trim(), login.password);
      navigate('/lobby');
    } catch (err) {
      setError(err.message || 'Login failed');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitRegister(event) {
    event.preventDefault();
    setError('');
    if (register.password !== register.confirm) {
      setError('Passwords do not match');
      return;
    }
    setSubmitting(true);
    try {
      await Auth.register({
        email: register.email.trim(),
        username: register.username.trim(),
        password: register.password,
      });
      navigate('/lobby');
    } catch (err) {
      setError(err.message || 'Registration failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="balloon b1" /><div className="balloon b2" /><div className="balloon b3" /><div className="balloon b4" />
      <div className="sparkle s1">✦</div><div className="sparkle s2">✧</div><div className="sparkle s3">✦</div>

      <div className="stage">
        <div className="hero-panel">
          <div className="brand">Poker777<span>Jump into the dream, play your hand!</span></div>
          <div className="avatar-ring"><div className="face"><div className="eye left" /><div className="eye right" /><div className="smile" /></div></div>
        </div>

        <div className="auth-panel">
          <div className="welcome">
            <div className="eyebrow">Welcome to</div>
            <h1>Poker777</h1>
            <p>Cloud-powered Poker built for seamless play with friends.</p>
          </div>

          <div className="tabs">
            <button className={tab === 'login' ? 'active' : ''} onClick={() => { setTab('login'); setError(''); }}>Login</button>
            <button className={tab === 'register' ? 'active' : ''} onClick={() => { setTab('register'); setError(''); }}>Register</button>
          </div>

          {tab === 'login' ? (
            <form id="login-form" onSubmit={submitLogin}>
              <div className="field"><input value={login.identifier} onChange={(e) => setLogin({ ...login, identifier: e.target.value })} type="text" placeholder="Username or Email" required /></div>
              <div className="field">
                <input value={login.password} onChange={(e) => setLogin({ ...login, password: e.target.value })} type={showLoginPassword ? 'text' : 'password'} placeholder="Password" required />
                <span className="toggle" onClick={() => setShowLoginPassword((value) => !value)}>👁</span>
              </div>
              {error && <div className="form-error">{error}</div>}
              <div className="row-between">
                <label className="remember"><input type="checkbox" defaultChecked /> Remember me</label>
                <a className="forgot" href="#" onClick={(e) => e.preventDefault()}>Forgot password?</a>
              </div>
              <GlassButton type="submit" disabled={submitting} className="glass-cta-full glass-cta-pink" label={submitting ? 'Logging in…' : 'Login'} />
            </form>
          ) : (
            <form id="register-form" onSubmit={submitRegister}>
              <div className="field"><input value={register.email} onChange={(e) => setRegister({ ...register, email: e.target.value })} type="email" placeholder="Email" required /></div>
              <div className="field"><input value={register.username} onChange={(e) => setRegister({ ...register, username: e.target.value })} type="text" placeholder="Username" required /></div>
              <div className="field">
                <input value={register.password} onChange={(e) => setRegister({ ...register, password: e.target.value })} type={showRegisterPassword ? 'text' : 'password'} placeholder="Password" required />
                <span className="toggle" onClick={() => setShowRegisterPassword((value) => !value)}>👁</span>
              </div>
              <div className="field">
                <input value={register.confirm} onChange={(e) => setRegister({ ...register, confirm: e.target.value })} type={showConfirmPassword ? 'text' : 'password'} placeholder="Confirm Password" required />
                <span className="toggle" onClick={() => setShowConfirmPassword((value) => !value)}>👁</span>
              </div>
              {error && <div className="form-error">{error}</div>}
              <GlassButton type="submit" disabled={submitting} className="glass-cta-full glass-cta-purple" label={submitting ? 'Creating account…' : 'Register'} />
            </form>
          )}
          <div className="divider" />
        </div>
      </div>
    </>
  );
}
