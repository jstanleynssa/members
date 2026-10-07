import { useRouter } from 'next/router'
import { useState, useEffect } from 'react'
import { createBrowserSupabaseClient } from '@supabase/auth-helpers-nextjs'

// Matches the Kajabi library header precisely.
// Key values extracted from Kajabi CSS:
//   background-color: #111827
//   font-size: 16px  (header base)
//   font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Helvetica, Arial
//   container: max-width 1340px, padding 0 40px (desktop) / 0 20px (mobile)
//   justify-content: flex-start  (links left-aligned)
//   link color: #d1d5db (--ink-pale)  →  #ffffff on hover
// ── Tool URLs ────────────────────────────────────────────────────────────────
const AXIOM_LOGIN_URL     = 'https://axiom.arpinstitute.com'
const AXIOM_ENROLL_URL    = 'https://axiom.arpinstitute.com/join'
const CALCULUS_LOGIN_URL  = 'https://calculus.arpinstitute.com'
const CALCULUS_ENROLL_URL = 'https://academy.arpinstitute.com/offers/FCb2gsUD/checkout?coupon_code=ARPI50CALCULUS'

// ── Static nav links (“My Tools” is rendered as a dropdown separately) ─────────
const NAV_LINKS = [
  { label: 'Member Community',              href: 'https://academy.arpinstitute.com/products/communities/v2/arpinstitute/home' },
  { label: 'Manage Your Directory Listing', href: '/profile' },
  { label: 'Review Your CE Status',         href: '/dashboard' },
  { label: 'My Library',                    href: 'https://academy.arpinstitute.com/library' },
  { label: 'Knowledge Base',                href: 'https://arpinstitute.com/codex' },
  { label: 'Contact Us',                    href: 'https://arpinstitute.com/contact' },
]

let _supabase
function getSupabase() {
  if (!_supabase) _supabase = createBrowserSupabaseClient()
  return _supabase
}

export default function MemberNav() {
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [userEmail, setUserEmail] = useState(null)
  const [profilePhoto, setProfilePhoto] = useState(null)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [toolsOpen, setToolsOpen] = useState(false)
  const [axiomActive, setAxiomActive] = useState(false)
  const [calculusActive, setCalculusActive] = useState(false)

  useEffect(() => {
    getSupabase().auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user?.email) return
      const email = session.user.email
      setUserEmail(email)

      // Fetch profile photo and tool access in parallel
      const [{ data: member }, toolRes] = await Promise.all([
        getSupabase().from('members').select('profile_photo').ilike('email', email).maybeSingle(),
        fetch('/api/tool-access').then(r => r.ok ? r.json() : { axiom: false, calculus: false }).catch(() => ({ axiom: false, calculus: false })),
      ])

      if (member?.profile_photo) setProfilePhoto(member.profile_photo)
      if (toolRes.axiom)    setAxiomActive(true)
      if (toolRes.calculus) setCalculusActive(true)
    })
  }, [])

  function active(href) {
    if (!href.startsWith('/')) return false
    return router.pathname === href || router.pathname.startsWith(href + '/')
  }

  async function handleSignOut() {
    await getSupabase().auth.signOut()
    router.replace('/login')
  }

  return (
    <>
      <style>{`
        /* ── MemberNav — exact Kajabi header match ──────────────────── */
        .mnav {
          background-color: #111827;
          color: #ffffff;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          -webkit-font-smoothing: antialiased;
          -moz-osx-font-smoothing: grayscale;
          position: sticky;
          top: 0;
          left: 0;
          right: 0;
          margin: 0;
          z-index: 200;
          width: 100%;
          box-sizing: border-box;
        }
        /* Outer wrapper — full width, 108px tall */
        .mnav-wrap {
          display: flex;
          align-items: center;
          height: 92px;
          margin: 0;
          padding: 0;
        }
        /* Inner container — matches Kajabi .container */
        .mnav-container {
          position: relative;
          flex-grow: 1;
          max-width: 1340px;
          margin: 0 auto;
          padding: 0 20px;
          display: flex;
          align-items: center;
          justify-content: flex-start;
          height: 100%;
          box-sizing: border-box;
        }
        @media (min-width: 768px) {
          .mnav-container { padding: 0 40px; }
        }
        /* Link strip — left-aligned, fills available space */
        .mnav-links {
          display: flex;
          align-items: center;
          flex: 1;
          justify-content: flex-end;
          overflow: visible;
        }
        /* Individual link — exact Kajabi values */
        .mnav-link {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 0.82rem;
          font-weight: 500;
          letter-spacing: 0.02em;
          color: #d1d5db;
          padding: 6px 20px;
          border-radius: 3px;
          white-space: nowrap;
          text-decoration: none;
          transition: color 0.15s;
          display: inline-block;
        }
        .mnav-link:hover { color: #ffffff; }
        .mnav-link.mnav-active {
          color: #ffffff;
          background: rgba(255, 255, 255, 0.07);
        }
        /* My Tools dropdown */
        .mnav-tools-wrap {
          position: relative;
          display: inline-flex;
          align-items: center;
        }
        .mnav-tools-btn {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          font-size: 0.82rem;
          font-weight: 500;
          letter-spacing: 0.02em;
          color: #d1d5db;
          padding: 6px 20px;
          border-radius: 3px;
          white-space: nowrap;
          background: none;
          border: none;
          cursor: pointer;
          transition: color 0.15s;
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }
        .mnav-tools-btn:hover { color: #ffffff; }
        .mnav-tools-dropdown {
          position: absolute;
          top: calc(100% + 6px);
          left: 0;
          background: #1f2937;
          border: 1px solid #374151;
          border-radius: 8px;
          min-width: 220px;
          box-shadow: 0 8px 24px rgba(0,0,0,0.35);
          overflow: hidden;
          z-index: 201;
        }
        .mnav-tools-dropdown a {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 11px 16px;
          font-size: 0.8rem;
          font-weight: 500;
          color: #d1d5db;
          text-decoration: none;
          transition: background 0.12s, color 0.12s;
          border-bottom: 1px solid #374151;
        }
        .mnav-tools-dropdown a:last-child { border-bottom: none; }
        .mnav-tools-dropdown a:hover { background: #374151; color: #ffffff; }
        .mnav-tools-label { font-weight: 700; color: #ffffff; }
        .mnav-tools-action { font-size: 0.72rem; color: #9ca3af; }
        .mnav-tools-dropdown a:hover .mnav-tools-action { color: #d1d5db; }
        .mnav-tools-badge {
          font-size: 0.65rem;
          font-weight: 700;
          background: #15803d;
          color: #ffffff;
          border-radius: 99px;
          padding: 1px 7px;
          letter-spacing: 0.04em;
        }
        /* Avatar circle */
        .mnav-avatar-wrap {
          position: relative;
          flex-shrink: 0;
          margin-left: 12px;
          margin-right: 40px;
        }
        .mnav-avatar {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          background: #4b5563;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          border: 2px solid transparent;
          transition: border-color 0.15s;
          user-select: none;
          overflow: hidden;
          flex-shrink: 0;
        }
        .mnav-avatar:hover,
        .mnav-avatar.open { border-color: rgba(255,255,255,0.5); }
        .mnav-dropdown {
          position: absolute;
          top: calc(100% + 10px);
          right: 0;
          background: #ffffff;
          border-radius: 8px;
          min-width: 220px;
          box-shadow: 0 8px 32px rgba(0,0,0,0.18);
          overflow: hidden;
          z-index: 201;
        }
        .mnav-dropdown a,
        .mnav-dropdown button {
          display: block;
          width: 100%;
          text-align: right;
          padding: 14px 24px;
          font-size: 1rem;
          font-weight: 500;
          color: #111827;
          background: none;
          border: none;
          cursor: pointer;
          text-decoration: none;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          transition: background 0.12s;
          box-sizing: border-box;
          letter-spacing: 0.01em;
        }
        .mnav-dropdown a:hover,
        .mnav-dropdown button:hover { background: #f3f4f6; }
        /* Hamburger */
        .mnav-hamburger {
          display: none;
          background: none;
          border: none;
          cursor: pointer;
          padding: 6px;
          color: #d1d5db;
          line-height: 0;
          flex-shrink: 0;
          margin-left: auto;
        }
        /* Mobile drawer */
        .mnav-mobile {
          background: #1f2937;
          border-top: 1px solid #374151;
          padding: 6px 0 10px;
        }
        .mnav-mobile a,
        .mnav-mobile button {
          display: block;
          width: 100%;
          text-align: left;
          color: #d1d5db;
          padding: 12px 20px;
          font-size: 0.82rem;
          font-weight: 500;
          letter-spacing: 0.02em;
          text-decoration: none;
          font-family: inherit;
          background: none;
          border: none;
          cursor: pointer;
          box-sizing: border-box;
          transition: color 0.12s, background 0.12s;
        }
        .mnav-mobile a:hover,
        .mnav-mobile button:hover,
        .mnav-mobile a.mnav-active { color: #ffffff; background: rgba(255,255,255,0.05); }
        @media (max-width: 900px) {
          .mnav-links       { display: none; }
          .mnav-avatar-wrap { display: none; }
          .mnav-hamburger   { display: flex; }
        }
        @media (min-width: 901px) {
          .mnav-mobile    { display: none !important; }
          .mnav-hamburger { display: none !important; }
        }
      `}</style>

      <nav className="mnav" aria-label="Member navigation">
        <div className="mnav-wrap">
          <div className="mnav-container">

            {/* Desktop links — left-aligned, matching Kajabi justify-content-left */}
            <div className="mnav-links">
              {/* My Tools dropdown */}
              <div className="mnav-tools-wrap">
                <button
                  className="mnav-tools-btn"
                  onClick={() => setToolsOpen(o => !o)}
                  aria-expanded={toolsOpen}
                >
                  My Tools
                  <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor" style={{ opacity: 0.7, marginTop: 1 }}>
                    <path d="M1 3l4 4 4-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
                  </svg>
                </button>
                {toolsOpen && (
                  <>
                    <div style={{ position: 'fixed', inset: 0, zIndex: 200 }} onClick={() => setToolsOpen(false)} />
                    <div className="mnav-tools-dropdown">
                      <a href={axiomActive ? AXIOM_LOGIN_URL : AXIOM_ENROLL_URL} target={axiomActive ? '_self' : '_blank'} rel="noreferrer" onClick={() => setToolsOpen(false)}>
                        <div>
                          <div className="mnav-tools-label">AXIOM</div>
                          <div className="mnav-tools-action">{axiomActive ? 'Log in →' : 'Enroll in the beta test'}</div>
                        </div>
                        {axiomActive && <span className="mnav-tools-badge">Active</span>}
                      </a>
                      <a href={calculusActive ? CALCULUS_LOGIN_URL : CALCULUS_ENROLL_URL} target={calculusActive ? '_self' : '_blank'} rel="noreferrer" onClick={() => setToolsOpen(false)}>
                        <div>
                          <div className="mnav-tools-label">CALCULUS</div>
                          <div className="mnav-tools-action">{calculusActive ? 'Log in →' : 'Sign up for 50% off'}</div>
                        </div>
                        {calculusActive && <span className="mnav-tools-badge">Active</span>}
                      </a>
                    </div>
                  </>
                )}
              </div>

              {NAV_LINKS.map(({ label, href }) => (
                <a
                  key={href}
                  href={href}
                  className={`mnav-link${active(href) ? ' mnav-active' : ''}`}
                >
                  {label}
                </a>
              ))}
            </div>

            {/* Avatar / sign-out — right side, matching Kajabi user widget position */}
            {userEmail && (
              <div className="mnav-avatar-wrap">
                <div
                  className={`mnav-avatar${avatarOpen ? ' open' : ''}`}
                  onClick={() => setAvatarOpen(o => !o)}
                  role="button"
                  tabIndex={0}
                  aria-label="Account menu"
                  onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && setAvatarOpen(o => !o)}
                >
                  {profilePhoto ? (
                    <img
                      src={profilePhoto}
                      alt="Profile"
                      style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top', borderRadius: '50%' }}
                    />
                  ) : (
                    /* Person silhouette fallback — matches Kajabi avatar */
                    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="14" cy="10" r="5" fill="white" fillOpacity="0.85" />
                      <path d="M4 26c0-5.523 4.477-10 10-10s10 4.477 10 10" fill="white" fillOpacity="0.85" />
                    </svg>
                  )}
                </div>
                {avatarOpen && (
                  <>
                    <div
                      style={{ position: 'fixed', inset: 0, zIndex: 199 }}
                      onClick={() => setAvatarOpen(false)}
                    />
                    <div className="mnav-dropdown">
                      <a href="https://academy.arpinstitute.com/library" onClick={() => setAvatarOpen(false)}>My Library</a>
                      <a href="https://academy.arpinstitute.com/settings/account" onClick={() => setAvatarOpen(false)}>Settings</a>
                      <a href="https://academy.arpinstitute.com/settings/cards" onClick={() => setAvatarOpen(false)}>Billing Info</a>
                      <a href="https://academy.arpinstitute.com/settings/purchase_history" onClick={() => setAvatarOpen(false)}>Purchase History</a>
                      <button onClick={() => { setAvatarOpen(false); handleSignOut() }}>Log Out</button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Mobile hamburger */}
            <button
              className="mnav-hamburger"
              onClick={() => setMobileOpen(o => !o)}
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
            >
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                {mobileOpen ? (
                  <><line x1="5" y1="5" x2="17" y2="17"/><line x1="17" y1="5" x2="5" y2="17"/></>
                ) : (
                  <><line x1="3" y1="6" x2="19" y2="6"/><line x1="3" y1="11" x2="19" y2="11"/><line x1="3" y1="16" x2="19" y2="16"/></>
                )}
              </svg>
            </button>
          </div>
        </div>

        {/* Mobile drawer */}
        {mobileOpen && (
          <div className="mnav-mobile">
            {/* My Tools — expanded inline in mobile */}
            <div style={{ padding: '8px 20px 4px', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.08em', color: '#6b7280', textTransform: 'uppercase' }}>My Tools</div>
            <a href={axiomActive ? AXIOM_LOGIN_URL : AXIOM_ENROLL_URL} rel="noreferrer" onClick={() => setMobileOpen(false)}>
              AXIOM — {axiomActive ? 'Log in' : 'Enroll in the beta test'}
            </a>
            <a href={calculusActive ? CALCULUS_LOGIN_URL : CALCULUS_ENROLL_URL} rel="noreferrer" onClick={() => setMobileOpen(false)}>
              CALCULUS — {calculusActive ? 'Log in' : 'Sign up for 50% off'}
            </a>
            <div style={{ height: 1, background: '#374151', margin: '6px 0' }} />
            {NAV_LINKS.map(({ label, href }) => (
              <a
                key={href}
                href={href}
                className={active(href) ? 'mnav-active' : ''}
                onClick={() => setMobileOpen(false)}
              >
                {label}
              </a>
            ))}
            {userEmail && (
              <button onClick={() => { setMobileOpen(false); handleSignOut() }}>Sign out</button>
            )}
          </div>
        )}
      </nav>
    </>
  )
}
