import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MonitorSmartphone, Lock, Eye, EyeOff } from 'lucide-react';
import { apiRequest, resetAuthRedirectState } from '../lib/api';
import { getPreferredPortalPath, getShortName, normalizeAuthUser, normalizeLoginIdentifier, setStoredSession } from '../lib/session';

interface LoginResponse {
  token: string;
  refreshToken?: string;
  user: {
    id: string;
    email: string;
    fullName?: string;
    full_name?: string;
    role: string;
    defaultPortal?: string;
    default_portal?: string;
    portals?: string[];
  };
}

interface AuthProvidersResponse {
  google?: {
    enabled: boolean;
    clientId?: string;
  };
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (response: { credential?: string }) => void;
          }) => void;
          renderButton: (element: HTMLElement, options: Record<string, string>) => void;
        };
      };
    };
  }
}

let googleScriptPromise: Promise<void> | null = null;

function loadGoogleScript() {
  if (googleScriptPromise) {
    return googleScriptPromise;
  }

  googleScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>('script[data-google-identity="true"]');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(), { once: true });
      existingScript.addEventListener('error', () => reject(new Error('Failed to load Google Sign-In')), { once: true });
      if (window.google) {
        resolve();
      }
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.dataset.googleIdentity = 'true';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Sign-In'));
    document.head.appendChild(script);
  });

  return googleScriptPromise;
}

export default function Login() {
  const navigate = useNavigate();
  const googleButtonRef = useRef<HTMLDivElement | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [credentialFieldsReady, setCredentialFieldsReady] = useState(false);
  const [showPasswordForm, setShowPasswordForm] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [googleClientId, setGoogleClientId] = useState('');
  const [googleLoading, setGoogleLoading] = useState(false);

  useEffect(() => {
    resetAuthRedirectState();
  }, []);

  const handleSuccessfulLogin = useCallback((response: LoginResponse) => {
    const user = normalizeAuthUser(response.user);
    const shortName = getShortName(user.fullName, user.role);

    setStoredSession({
      token: response.token,
      user,
      shortName,
    });

    localStorage.setItem('itms_role', user.role);
    localStorage.setItem('itms_short', shortName);

    navigate(getPreferredPortalPath(user), { replace: true });
  }, [navigate]);

  useEffect(() => {
    let cancelled = false;

    const loadProviders = async () => {
      try {
        const providers = await apiRequest<AuthProvidersResponse>('/api/auth/providers');
        if (cancelled) {
          return;
        }
        setGoogleEnabled(Boolean(providers.google?.enabled));
        setGoogleClientId(providers.google?.clientId || '');
      } catch {
        if (!cancelled) {
          setGoogleEnabled(false);
          setGoogleClientId('');
        }
      }
    };

    void loadProviders();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!googleEnabled || !googleClientId || !googleButtonRef.current) {
      return;
    }

    let cancelled = false;

    const setupGoogle = async () => {
      try {
        await loadGoogleScript();
        if (cancelled || !googleButtonRef.current || !window.google) {
          return;
        }

        window.google.accounts.id.initialize({
          client_id: googleClientId,
          callback: async (googleResponse) => {
            if (!googleResponse.credential) {
              setError('Google Sign-In did not return a credential');
              return;
            }

            try {
              setGoogleLoading(true);
              setError('');
              const response = await apiRequest<LoginResponse>('/api/auth/google', {
                method: 'POST',
                body: JSON.stringify({ idToken: googleResponse.credential }),
              });
              handleSuccessfulLogin(response);
            } catch (requestError) {
              setError(requestError instanceof Error ? requestError.message : 'Google Sign-In failed');
            } finally {
              setGoogleLoading(false);
            }
          },
        });

        googleButtonRef.current.innerHTML = '';
        window.google.accounts.id.renderButton(googleButtonRef.current, {
          theme: 'outline',
          size: 'large',
          type: 'standard',
          text: 'signin_with',
          shape: 'rectangular',
          width: '320',
        });
      } catch (setupError) {
        if (!cancelled) {
          setError(setupError instanceof Error ? setupError.message : 'Failed to initialize Google Sign-In');
        }
      }
    };

    void setupGoogle();

    return () => {
      cancelled = true;
    };
  }, [googleClientId, googleEnabled, handleSuccessfulLogin]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      setLoading(true);
      setError('');

      const normalizedEmail = normalizeLoginIdentifier(email);
      const response = await apiRequest<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          email: normalizedEmail,
          password,
        }),
      });
      handleSuccessfulLogin(response);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const enableCredentialFields = useCallback(() => {
    setCredentialFieldsReady(true);
  }, []);

  const revealPasswordForm = useCallback(() => {
    setShowPasswordForm(true);
    setCredentialFieldsReady(true);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-md">
        <div className="flex justify-center items-center gap-2 mb-6">
          <div className="bg-brand-600 p-2 rounded-lg">
            <MonitorSmartphone className="h-8 w-8 text-white" />
          </div>
          <h2 className="text-center text-3xl font-extrabold text-slate-900">
            Zerodha ITMS
          </h2>
        </div>
        <h2 className="mt-2 text-center text-xl font-medium text-slate-600">
          Sign in to your portal
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
        <div className="bg-white py-8 px-4 shadow-sm sm:rounded-xl sm:px-10 border border-slate-200">
          {!showPasswordForm ? (
            <div className="space-y-4">
              {error ? (
                <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                  {error}
                </div>
              ) : null}
              <button
                type="button"
                onClick={revealPasswordForm}
                className="w-full flex justify-center py-2.5 px-4 border border-zinc-300 rounded-md shadow-sm text-sm font-medium text-zinc-900 bg-white hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500"
              >
                Use email and password
              </button>
              <p className="text-xs text-slate-500 text-center">
                Open the password form only when needed. This avoids aggressive browser autofill overlays on initial page load.
              </p>
            </div>
          ) : (
            <form className="space-y-6" onSubmit={handleLogin} autoComplete="on" action="/login" method="post" data-bwignore="true">
              <div className="hidden" aria-hidden="true">
                <input tabIndex={-1} name="username" autoComplete="username" data-bwignore="true" data-1p-ignore="true" data-lpignore="true" />
                <input tabIndex={-1} name="password" type="password" autoComplete="current-password" data-bwignore="true" data-1p-ignore="true" data-lpignore="true" />
              </div>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-slate-700">
                  Email / Employee ID
                </label>
                <div className="mt-1">
                  <input
                    id="email"
                    name="login_identifier"
                    type="text"
                    required
                    readOnly={!credentialFieldsReady}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onFocus={enableCredentialFields}
                    onPointerDown={enableCredentialFields}
                    autoComplete="username"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-label="Email or Employee ID"
                    data-bwignore="true"
                    data-1p-ignore="true"
                    data-lpignore="true"
                    className="appearance-none block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm placeholder-slate-400 focus:outline-none focus:ring-brand-500 focus:border-brand-500 sm:text-sm"
                    placeholder="employee@zerodha.com or employee ID"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-slate-700">
                  Password
                </label>
                <div className="mt-1 relative">
                  <input
                    id="password"
                    name="login_secret"
                    type={passwordVisible ? 'text' : 'password'}
                    required
                    readOnly={!credentialFieldsReady}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={enableCredentialFields}
                    onPointerDown={enableCredentialFields}
                    autoComplete="current-password"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    aria-label="Password"
                    data-bwignore="true"
                    data-1p-ignore="true"
                    data-lpignore="true"
                    className="appearance-none block w-full rounded-md border border-slate-300 px-3 py-2 pr-11 shadow-sm placeholder-slate-400 focus:border-brand-500 focus:outline-none focus:ring-brand-500 sm:text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => setPasswordVisible((current) => !current)}
                    className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 transition hover:text-slate-700"
                    aria-label={passwordVisible ? 'Hide password' : 'Show password'}
                  >
                    {passwordVisible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <input
                    id="remember-me"
                    name="remember-me"
                    type="checkbox"
                    className="h-4 w-4 text-brand-600 focus:ring-brand-500 border-slate-300 rounded"
                  />
                  <label htmlFor="remember-me" className="ml-2 block text-sm text-slate-900">
                    Remember me
                  </label>
                </div>

                <div className="text-sm">
                  <a href="#" className="font-medium text-brand-600 hover:text-brand-500">
                    Forgot password?
                  </a>
                </div>
              </div>

              <div>
                {error ? (
                  <div className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                    {error}
                  </div>
                ) : null}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-brand-600 hover:bg-brand-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-500"
                >
                  {loading ? 'Signing in...' : 'Sign in'}
                </button>
                <p className="mt-3 text-xs text-slate-500 text-center">
                  Local DB auth: use the default admin email configured in backend/.env, or sign in with a valid employee email or employee ID.
                </p>
              </div>
            </form>
          )}

          <div className="mt-6">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-300" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="px-2 bg-white text-slate-500">Or continue with</span>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-3">
              {googleEnabled ? (
                <div className="space-y-2">
                  <div ref={googleButtonRef} className="flex justify-center" />
                  {googleLoading ? <p className="text-xs text-center text-slate-500">Signing in with Google...</p> : null}
                </div>
              ) : (
                <button
                  type="button"
                  disabled
                  className="w-full inline-flex justify-center items-center py-2 px-4 border border-slate-300 rounded-md shadow-sm bg-slate-100 text-sm font-medium text-slate-400 cursor-not-allowed"
                >
                  <Lock className="w-4 h-4 mr-2" />
                  <span>Google SSO not configured</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
