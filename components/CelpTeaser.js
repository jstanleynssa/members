// components/CelpTeaser.js
// Teaser block shown on /profile for members who are not CELP-certified.
// Encourages them to earn CELP® to unlock the Partner Network.

const GREEN = { dark: '#1a4a37', mid: '#2a6b54', light: '#d9ede5', text: '#2a6b54' }

export default function CelpTeaser() {
  return (
    <div style={{
      marginTop: 48,
      paddingTop: 40,
      borderTop: '2px solid #e5e7eb',
    }}>
      <div style={{
        background: GREEN.light,
        border: `1px solid ${GREEN.mid}30`,
        borderRadius: 12,
        padding: '32px 36px',
        display: 'flex',
        alignItems: 'flex-start',
        gap: 24,
        flexWrap: 'wrap',
      }}>
        {/* Lock icon */}
        <div style={{
          width: 52, height: 52, borderRadius: '50%',
          background: 'white', display: 'flex', alignItems: 'center',
          justifyContent: 'center', flexShrink: 0,
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        }}>
          <svg width="22" height="22" fill="none" viewBox="0 0 24 24" stroke={GREEN.mid} strokeWidth={2}>
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path strokeLinecap="round" d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
        </div>

        <div style={{ flex: 1, minWidth: 240 }}>
          <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, textTransform: 'uppercase', color: GREEN.text }}>
            CELP® Member Benefit
          </p>
          <h3 style={{ margin: '0 0 10px', fontSize: 20, fontWeight: 800, color: GREEN.dark }}>
            Unlock the Referral Partner Network
          </h3>
          <p style={{ margin: '0 0 20px', fontSize: 14, color: GREEN.dark, lineHeight: 1.6 }}>
            Earn your CELP® designation to see referral partners in your area — estate attorneys,
            hospice organizations, CPAs, and other allied professionals who serve the same families
            and want to connect with CELP® advisors.
          </p>
          <a
            href="https://arpinstitute.com/credentials/celp"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-block',
              background: GREEN.mid,
              color: 'white',
              padding: '10px 20px',
              borderRadius: 6,
              textDecoration: 'none',
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            Learn about CELP® →
          </a>
        </div>
      </div>
    </div>
  )
}
