import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Auth } from '../lib/api.js';
import { usePageStyles } from '../hooks/usePageStyles.js';
import { GlassButton } from '../components/GlassButton.jsx';

// Same rules as backend/src/validators/auth.js, checked before sending so mistakes show instantly.
const USERNAME_RE = /^[A-Za-z0-9_-]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIX_FIELDS = 'Please fix the highlighted fields.';

function validateLogin({ identifier, password }) {
  const errors = {};
  if (identifier.trim().length < 3) errors.identifier = 'Enter your username or email (at least 3 characters).';
  if (!password) errors.password = 'Enter your password.';
  return errors;
}

function validateRegister({ email, username, password, confirm }) {
  const errors = {};
  if (!EMAIL_RE.test(email.trim())) errors.email = 'Enter a valid email address, e.g. name@example.com.';
  const name = username.trim();
  if (name.length < 3 || name.length > 30) errors.username = 'Username must be 3–30 characters.';
  else if (!USERNAME_RE.test(name)) errors.username = 'Username may only use letters, numbers, - and _.';
  if (password.length < 8) errors.password = 'Password must be at least 8 characters.';
  else if (password.length > 128) errors.password = 'Password is too long (max 128 characters).';
  if (confirm !== password) errors.confirm = 'Passwords do not match.';
  return errors;
}

// Turn an API error into { message, fields } for the form.
function describeAuthError(err, mode) {
  const fields = {};
  (err.details || []).forEach((detail) => {
    if (detail?.field) fields[detail.field] = detail.issue;
  });
  if (err.code === 'USERNAME_TAKEN') fields.username = 'This username is already taken.';
  if (err.code === 'EMAIL_TAKEN') fields.email = 'This email is already registered.';
  // The server never says whether the username or the password was wrong (on purpose), so mark both.
  if (err.code === 'UNAUTHORIZED') { fields.identifier = ' '; fields.password = ' '; }
  const messages = {
    NETWORK: 'Cannot reach the server. Check your connection and try again.',
    UNAUTHORIZED: 'Incorrect username/email or password.',
    USERNAME_TAKEN: 'This username is already taken — try another one.',
    EMAIL_TAKEN: 'An account with this email already exists. Try logging in instead.',
    RATE_LIMITED: 'Too many attempts. Please wait a minute and try again.',
    BAD_REQUEST: FIX_FIELDS,
  };
  const fallback = mode === 'login' ? 'Login failed. Please try again.' : 'Registration failed. Please try again.';
  const message = messages[err.code]
    || (err.status >= 500 ? 'Something went wrong on the server. Please try again.' : err.message || fallback);
  return { message, fields };
}

// Input wrapper: red outline + message under the field when invalid, optional hint otherwise.
function Field({ error, hint, children }) {
  const message = error && error.trim();
  return (
    <div className={`field-group ${error ? 'has-error' : ''}`}>
      <div className="field">{children}</div>
      {message ? <div className="field-message">{message}</div> : hint ? <div className="field-hint">{hint}</div> : null}
    </div>
  );
}

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
  const [fieldErrors, setFieldErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = 'Poker777 — Login';
    if (Auth.hasSession()) navigate('/lobby', { replace: true });
  }, [navigate]);

  function showErrors(message, fields = {}) {
    setError(message);
    setFieldErrors(fields);
  }

  function clearField(name) {
    setFieldErrors((current) => {
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      if (!Object.keys(next).length) setError('');
      return next;
    });
  }

  function switchTab(next) {
    setTab(next);
    showErrors('');
  }

  async function submitLogin(event) {
    event.preventDefault();
    const invalid = validateLogin(login);
    if (Object.keys(invalid).length) return showErrors(FIX_FIELDS, invalid);
    showErrors('');
    setSubmitting(true);
    try {
      await Auth.login(login.identifier.trim(), login.password);
      navigate('/lobby');
    } catch (err) {
      const { message, fields } = describeAuthError(err, 'login');
      showErrors(message, fields);
    } finally {
      setSubmitting(false);
    }
  }

  async function submitRegister(event) {
    event.preventDefault();
    const invalid = validateRegister(register);
    if (Object.keys(invalid).length) return showErrors(FIX_FIELDS, invalid);
    showErrors('');
    setSubmitting(true);
    try {
      await Auth.register({
        email: register.email.trim(),
        username: register.username.trim(),
        password: register.password,
      });
      navigate('/lobby');
    } catch (err) {
      const { message, fields } = describeAuthError(err, 'register');
      showErrors(message, fields);
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
            <button className={tab === 'login' ? 'active' : ''} onClick={() => switchTab('login')}>Login</button>
            <button className={tab === 'register' ? 'active' : ''} onClick={() => switchTab('register')}>Register</button>
          </div>

          {tab === 'login' ? (
            <form id="login-form" onSubmit={submitLogin} noValidate>
              {error && <div className="form-error" role="alert">{error}</div>}
              <Field error={fieldErrors.identifier}>
                <input value={login.identifier} onChange={(e) => { setLogin({ ...login, identifier: e.target.value }); clearField('identifier'); }} type="text" placeholder="Username or Email" autoComplete="username" aria-invalid={Boolean(fieldErrors.identifier)} />
              </Field>
              <Field error={fieldErrors.password}>
                <input value={login.password} onChange={(e) => { setLogin({ ...login, password: e.target.value }); clearField('password'); }} type={showLoginPassword ? 'text' : 'password'} placeholder="Password" autoComplete="current-password" aria-invalid={Boolean(fieldErrors.password)} />
                <span className="toggle" onClick={() => setShowLoginPassword((value) => !value)}>👁</span>
              </Field>
              <div className="row-between">
                <label className="remember"><input type="checkbox" defaultChecked /> Remember me</label>
                <a className="forgot" href="#" onClick={(e) => e.preventDefault()}>Forgot password?</a>
              </div>
              <GlassButton type="submit" disabled={submitting} className="glass-cta-full glass-cta-pink" label={submitting ? 'Logging in…' : 'Login'} />
            </form>
          ) : (
            <form id="register-form" onSubmit={submitRegister} noValidate>
              {error && <div className="form-error" role="alert">{error}</div>}
              <Field error={fieldErrors.email}>
                <input value={register.email} onChange={(e) => { setRegister({ ...register, email: e.target.value }); clearField('email'); }} type="email" placeholder="Email" autoComplete="email" aria-invalid={Boolean(fieldErrors.email)} />
              </Field>
              <Field error={fieldErrors.username} hint="3–30 characters: letters, numbers, - or _">
                <input value={register.username} onChange={(e) => { setRegister({ ...register, username: e.target.value }); clearField('username'); }} type="text" placeholder="Username" autoComplete="username" aria-invalid={Boolean(fieldErrors.username)} />
              </Field>
              <Field error={fieldErrors.password} hint="At least 8 characters">
                <input value={register.password} onChange={(e) => { setRegister({ ...register, password: e.target.value }); clearField('password'); }} type={showRegisterPassword ? 'text' : 'password'} placeholder="Password" autoComplete="new-password" aria-invalid={Boolean(fieldErrors.password)} />
                <span className="toggle" onClick={() => setShowRegisterPassword((value) => !value)}>👁</span>
              </Field>
              <Field error={fieldErrors.confirm}>
                <input value={register.confirm} onChange={(e) => { setRegister({ ...register, confirm: e.target.value }); clearField('confirm'); }} type={showConfirmPassword ? 'text' : 'password'} placeholder="Confirm Password" autoComplete="new-password" aria-invalid={Boolean(fieldErrors.confirm)} />
                <span className="toggle" onClick={() => setShowConfirmPassword((value) => !value)}>👁</span>
              </Field>
              <GlassButton type="submit" disabled={submitting} className="glass-cta-full glass-cta-purple" label={submitting ? 'Creating account…' : 'Register'} />
            </form>
          )}
          <div className="divider" />
        </div>
      </div>
    </>
  );
}
