import { useState } from 'react';
import { useAuth } from '../lib/auth';
import { supabaseEnabled } from '../lib/supabase';

export default function LoginPage() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);
    const result = mode === 'signin' ? await signIn(email, password) : await signUp(email, password);
    setSubmitting(false);
    if (result) {
      setError(result);
    } else if (mode === 'signup') {
      setInfo('Check your email to confirm your account, then sign in.');
    }
  }

  return (
    <div className="page login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-glyph">☾</span>
          <h1>MedTracker</h1>
          <p>Sign in to sync your medications across devices.</p>
        </div>

        {!supabaseEnabled && (
          <p className="login-warning">
            Cloud sync isn't configured yet — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
          </p>
        )}

        <form className="login-form" onSubmit={handleSubmit}>
          <label>
            Email
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            />
          </label>

          {error && <p className="login-error">{error}</p>}
          {info && <p className="login-info">{info}</p>}

          <button type="submit" className="primary-button" disabled={submitting || !supabaseEnabled}>
            {mode === 'signin' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <button
          type="button"
          className="text-link login-switch"
          onClick={() => {
            setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
            setError(null);
            setInfo(null);
          }}
        >
          {mode === 'signin' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
        </button>
      </div>
    </div>
  );
}
