import { useState } from 'react';
import { mutate, previewMode } from '../api.js';
import { supabaseConfigured } from '../auth-config.js';

export default function AccountPanel({ setupRequired, onSession }) {
  const [mode, setMode] = useState('login');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  async function google() {
    setBusy(true); setError('');
    try { const { signInWithGoogle } = await import('../supabase.js'); await signInWithGoogle(); } catch (failure) { setError(failure.message); setBusy(false); }
  }
  async function submit(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    setError(''); setNotice('');
    if (mode !== 'login' && data.password !== data.confirm) return setError('Passwords must match.');
    delete data.confirm;
    setBusy(true);
    try {
      const result = await mutate(`/api/auth/${mode}`, 'POST', data);
      if (mode === 'register') {
        setMode('login');
        setNotice(result.confirmationRequired ? 'Check your email to confirm your account, then sign in. Administrator approval is required before booking.' : 'Account created. Sign in to browse while an administrator reviews your account.');
      } else await onSession(result);
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  return <section className="account-panel collection">
    {(supabaseConfigured || previewMode) && <><button className="secondary google-sign-in" onClick={google} disabled={busy || !supabaseConfigured}><span aria-hidden="true">G</span>Continue with Google</button><p className="panel-description">{previewMode ? 'Login is being connected to Supabase. Email and Google sign-in will be available when setup is complete.' : 'Use your Google account or sign in with your email below.'}</p></>}
    <div className="tab-row" aria-label="Account options">{[['login', 'Sign in'], ['register', 'Create account'], ...(setupRequired ? [['setup', 'Set up administrator']] : [])].map(([key, label]) => <button key={key} className={mode === key ? 'secondary selected-tab' : 'secondary'} onClick={() => { setMode(key); setError(''); setNotice(''); }}>{label}</button>)}</div>
    <h2>{mode === 'login' ? 'Sign in to book a classroom' : mode === 'register' ? 'Create your university account' : 'Set up the first administrator'}</h2>
    <p className="panel-description">{mode === 'register' ? 'Students, teachers and university staff can register. Booking access begins after administrator approval.' : mode === 'setup' ? 'Read the setup code from data/admin-setup-code.txt on the server, then enter it here. The administrator setup is available only until the first administrator is created.' : 'Use your registered email and password. You can browse classrooms and booking rules before signing in.'}</p>
    <form className="account-form" onSubmit={submit} key={mode}>
      {mode === 'setup' && <label>Administrator setup code<input name="code" autoComplete="off" required/></label>}
      {mode !== 'login' && <label>Full name<input name="name" autoComplete="name" maxLength={100} required/></label>}
      <label>Email<input name="email" type="email" autoComplete="email" required/></label>
      {mode === 'register' && <label>University role<select name="role" defaultValue="student"><option value="student">Student</option><option value="teacher">Teacher</option><option value="staff">University staff</option></select></label>}
      <label>Password{mode !== 'login' && <small>At least 12 characters</small>}<input name="password" type="password" minLength={mode === 'login' ? undefined : 12} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required/></label>
      {mode !== 'login' && <label>Confirm password<input name="confirm" type="password" minLength={12} maxLength={128} autoComplete="new-password" required/></label>}
      {error && <p className="error" role="alert">{error}</p>}{notice && <p className="account-notice" role="status">{notice}</p>}
      <button className="primary" disabled={busy || previewMode}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Create administrator'}</button>
    </form>
  </section>;
}
