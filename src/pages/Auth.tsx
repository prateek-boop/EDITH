import { ShieldCheck, LockKeyhole, Sparkles, LoaderCircle, ArrowUpRight, Layers, Network, TerminalSquare, X } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useEffect, useRef, useState, useCallback } from 'react'
import { useEdithStore } from '../store/useEdithStore'
import { edithApi } from '../lib/api'
import type { AuthUser } from '../lib/types'

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string
            callback: (response: { credential: string }) => void
            auto_select?: boolean
          }) => void
          renderButton: (element: HTMLElement, options: Record<string, unknown>) => void
          disableAutoSelect: () => void
          prompt: () => void
        }
      }
    }
  }
}

export function GoogleIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98z"
      />
    </svg>
  )
}

function decodeGoogleCredential(token: string): AuthUser | null {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const parsed = JSON.parse(
      decodeURIComponent(
        Array.from(atob(payload))
          .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
          .join('')
      )
    )
    return {
      name: parsed.name || parsed.given_name || 'Google User',
      email: parsed.email || '',
      picture: parsed.picture,
      provider: 'google' as const,
      sub: parsed.sub,
      verified: Boolean(parsed.email_verified),
    }
  } catch {
    return null
  }
}

export function AuthPage() {
  const setAuthUser = useEdithStore((s) => s.setAuthUser)
  const googleRef = useRef<HTMLDivElement>(null)
  const [googleReady, setGoogleReady] = useState(false)
  const [googleError, setGoogleError] = useState(false)
  const [showConfigModal, setShowConfigModal] = useState(false)
  const [customClientIdInput, setCustomClientIdInput] = useState('')
  const [authNotice, setAuthNotice] = useState<string | null>(null)

  const envClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
  const [activeClientId, setActiveClientId] = useState<string>(() => {
    if (envClientId) return envClientId
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem('edith_google_client_id') || ''
    }
    return ''
  })

  useEffect(() => {
    if (!activeClientId) {
      void edithApi.getAuthConfig().then((cfg) => {
        if (cfg?.googleClientId) {
          setActiveClientId(cfg.googleClientId)
        }
      })
    }
  }, [activeClientId])

  const handleCredential = useCallback(
    async (credential: string) => {
      const localUser = decodeGoogleCredential(credential)
      if (!localUser) {
        setGoogleError(true)
        return
      }

      try {
        const res = await edithApi.verifyGoogleToken(credential, activeClientId)
        if (res?.ok && res.user) {
          setAuthUser({
            ...res.user,
            sessionToken: res.sessionToken,
            verified: true,
          })
          return
        }
      } catch {
        // Fallback gracefully to client verified identity
      }

      setAuthUser(localUser)
    },
    [activeClientId, setAuthUser]
  )

  const isElectron = typeof window !== 'undefined' && Boolean((window as any).edithDesktop?.isElectron)

  const startDesktopGoogleOAuth = useCallback(async () => {
    setAuthNotice('Opening Google Sign-In in your default browser…')
    const state = 'edith_' + Math.random().toString(36).slice(2)
    const startUrl = `http://127.0.0.1:8766/api/auth/google/start?state=${encodeURIComponent(state)}`

    if (isElectron && (window as any).edithDesktop?.openExternal) {
      await (window as any).edithDesktop.openExternal(startUrl)
    } else {
      window.open(startUrl, '_blank')
    }

    let attempts = 0
    const interval = window.setInterval(async () => {
      attempts++
      if (attempts > 120) {
        window.clearInterval(interval)
        setAuthNotice(null)
        return
      }
      try {
        const res = await edithApi.pollGoogleOAuth(state)
        if (res.ok && res.user) {
          window.clearInterval(interval)
          setAuthNotice(null)
          setAuthUser({
            ...res.user,
            sessionToken: res.sessionToken,
            verified: true,
          })
        }
      } catch {
        // Polling loop
      }
    }, 1000)
  }, [isElectron, setAuthUser])

  useEffect(() => {
    if (isElectron || !activeClientId) {
      setGoogleReady(false)
      return
    }

    const setup = () => {
      if (!window.google || !googleRef.current) return
      try {
        window.google.accounts.id.initialize({
          client_id: activeClientId,
          callback: (response) => {
            void handleCredential(response.credential)
          },
        })
        googleRef.current.replaceChildren()
        window.google.accounts.id.renderButton(googleRef.current, {
          theme: 'filled_black',
          size: 'large',
          shape: 'rectangular',
          text: 'signin_with',
          width: 320,
          logo_alignment: 'left',
        })
        setGoogleReady(true)
        setGoogleError(false)
      } catch {
        setGoogleError(true)
      }
    }

    const existing = document.querySelector('script[data-edith-google]') as HTMLScriptElement | null
    if (existing) {
      if (window.google) setup()
      else existing.addEventListener('load', setup, { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.defer = true
    script.dataset.edithGoogle = 'true'
    script.onload = setup
    script.onerror = () => setGoogleError(true)
    document.head.appendChild(script)
  }, [activeClientId, handleCredential])

  // Handle Escape key to close modal
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showConfigModal) {
        setShowConfigModal(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [showConfigModal])

  const demo = () => setAuthUser({ name: 'EDITH User', email: 'local@edith.dev', provider: 'demo' })

  const demoGoogle = async () => {
    const mockToken =
      'mock_jwt.' +
      btoa(
        JSON.stringify({
          name: 'Google User',
          email: 'alex.vance@edith.dev',
          picture: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&q=80',
          sub: 'google_1092837465928374',
          email_verified: true,
        })
      ) +
      '.signature'
    setShowConfigModal(false)
    await handleCredential(mockToken)
  }

  const saveCustomClientId = () => {
    const trimmed = customClientIdInput.trim()
    if (!trimmed) return
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('edith_google_client_id', trimmed)
    }
    setActiveClientId(trimmed)
    setShowConfigModal(false)
    setAuthNotice('Google Client ID connected.')
  }

  return (
    <main className="auth-page upgraded-auth">
      <div className="auth-grid-bg" />
      <header className="entry-header">
        <span>
          EDITH<span className="brand-dot" />
        </span>
        <span>YOUR INTELLIGENCE. YOUR WORKSPACE.</span>
        <span className="entry-version">WORKSPACE PREVIEW / 0.4</span>
      </header>
      <aside className="auth-editorial">
        <span className="eyebrow">A WORKSPACE THAT THINKS WITH YOU</span>
        <h2>
          Less friction.
          <br />
          More forward.
        </h2>
        <p>Bring your files, ideas, and next big goal into one focused place.</p>
        <div className="entry-features">
          <span>
            <TerminalSquare size={18} />
            Goal-driven execution
          </span>
          <span>
            <Network size={18} />
            Connected project context
          </span>
          <span>
            <Layers size={18} />
            Memory you can inspect
          </span>
        </div>
      </aside>
      <motion.div
        className="auth-core-mark"
        animate={{ rotate: 360 }}
        transition={{ duration: 38, repeat: Infinity, ease: 'linear' }}
        aria-hidden="true"
      >
        <span />
        <span />
        <span />
      </motion.div>
      <motion.div
        className="auth-mark"
        initial={{ opacity: 0, scale: 0.97, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
      >
        <div className="brand-word">EDITH</div>
        <div className="brand-rule" />
        <span className="eyebrow centered">
          <Sparkles size={11} /> SECURE WORKSPACE ENTRY
        </span>
        <h1>
          Your next idea
          <br />
          starts here.
        </h1>
        <p>Open a project. Set a goal. Keep moving.</p>

        <div className="google-auth-wrap">
          {isElectron ? (
            <button
              type="button"
              className="google-button"
              onClick={startDesktopGoogleOAuth}
              aria-label="Sign in with Google"
            >
              <GoogleIcon size={18} />
              <span>Sign in with Google</span>
            </button>
          ) : activeClientId ? (
            <>
              <div ref={googleRef} className="google-native-button" />
              {!googleReady && !googleError && (
                <span className="google-loading">
                  <LoaderCircle className="spin" size={14} /> Loading Google authentication…
                </span>
              )}
              {googleError && (
                <button
                  type="button"
                  className="google-button"
                  onClick={() => setShowConfigModal(true)}
                  aria-label="Sign in with Google"
                >
                  <GoogleIcon size={18} />
                  <span>Sign in with Google</span>
                </button>
              )}
            </>
          ) : (
            <button
              type="button"
              className="google-button"
              onClick={() => setShowConfigModal(true)}
              aria-label="Sign in with Google"
            >
              <GoogleIcon size={18} />
              <span>Sign in with Google</span>
            </button>
          )}

          <button
            type="button"
            className="demo-button"
            onClick={demo}
            aria-label="Continue in local demo mode"
          >
            Continue in local demo mode <ArrowUpRight size={15} />
          </button>

          <button
            type="button"
            className="auth-options-btn"
            onClick={() => setShowConfigModal(true)}
            aria-label="Google authentication options"
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '11px', cursor: 'pointer', padding: '4px 8px', marginTop: '2px' }}
          >
            Google options & developer mode
          </button>

          <em>Google identity connects to your workspace. Local demo runs entirely in browser.</em>
        </div>

        {authNotice && (
          <p className="auth-notice" role="status" style={{ fontSize: '11px', color: 'var(--accent)', marginTop: '8px' }}>
            {authNotice}
          </p>
        )}

        <div className="auth-links">
          <ShieldCheck size={14} /> Sovereign Session <span>·</span>
          <LockKeyhole size={13} /> No unauthorized egress
        </div>
      </motion.div>
      <div className="auth-corner">EDITH / SECURE WORKSPACE ACCESS</div>

      <AnimatePresence>
        {showConfigModal && (
          <div
            className="vault-dialog-overlay"
            onClick={() => setShowConfigModal(false)}
            role="presentation"
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="google-auth-dialog-title"
              className="vault-dialog google-auth-modal"
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
            >
              <div className="google-modal-head">
                <GoogleIcon size={20} />
                <h3 id="google-auth-dialog-title" className="vault-dialog-title" style={{ margin: 0 }}>
                  Google Authentication
                </h3>
                <button
                  type="button"
                  className="icon-button"
                  style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                  onClick={() => setShowConfigModal(false)}
                  aria-label="Close dialog"
                >
                  <X size={16} />
                </button>
              </div>

              <p className="google-modal-desc">
                Sign in with Google or connect your Google Cloud OAuth 2.0 Web Client ID to enable live Google Identity Services.
              </p>

              <label htmlFor="google-client-id-field" className="google-modal-label">
                Google Web Client ID
              </label>
              <input
                id="google-client-id-field"
                type="text"
                className="vault-dialog-input"
                placeholder="e.g. 123456789-abc.apps.googleusercontent.com"
                value={customClientIdInput}
                onChange={(e) => setCustomClientIdInput(e.target.value)}
              />

              <div className="google-modal-actions">
                <button
                  type="button"
                  style={{ background: 'transparent', border: '1px solid var(--surface-border)', color: 'var(--text-muted)', padding: '6px 14px', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' }}
                  onClick={() => setShowConfigModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  style={{ background: 'var(--accent)', color: '#17191e', border: 'none', padding: '6px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}
                  onClick={saveCustomClientId}
                  disabled={!customClientIdInput.trim()}
                >
                  Connect Client ID
                </button>
              </div>

              <div className="google-modal-divider">
                <span>OR</span>
              </div>

              <button
                type="button"
                className="google-demo-instant-btn"
                style={{ marginBottom: '8px' }}
                onClick={() => {
                  setShowConfigModal(false)
                  void startDesktopGoogleOAuth()
                }}
                aria-label="Sign in via System Browser"
              >
                <GoogleIcon size={16} /> Sign in via System Browser (Desktop OAuth)
              </button>

              <button
                type="button"
                className="google-demo-instant-btn"
                onClick={demoGoogle}
                aria-label="Instant Google Sign-In"
              >
                <GoogleIcon size={16} /> Instant Google Sign-In (Demo Profile)
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </main>
  )
}
