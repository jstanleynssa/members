// components/PartnerNetwork.js
// Referral Partner Network section — shown on /profile for CELP-certified members.
// Fetches all approved partners, filters client-side by role + distance.

import { useState, useEffect, useMemo } from 'react'

const GREEN = { dark: '#1a4a37', mid: '#2a6b54', light: '#d9ede5', text: '#2a6b54' }
const GRAY = { text: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' }

const ROLE_LABELS = {
  'estate-planning-attorneys': 'Estate Planning Attorneys',
  'elder-law-attorneys': 'Elder Law Attorneys',
  'probate-attorneys': 'Probate Attorneys',
  'cpas': 'CPAs',
  'wealth-managers': 'Wealth Managers',
  'insurance-agencies': 'Insurance Agencies',
  'hospitals': 'Hospitals',
  'hospice-organizations': 'Hospice Organizations',
  'home-healthcare': 'Home Healthcare Agencies',
  'senior-living': 'Senior Living Communities',
  'funeral-homes': 'Funeral Homes',
  'physicians': 'Physicians',
  'memory-care': 'Memory Care Facilities',
  'veterans-organizations': 'Veterans Organizations',
}

const ROLE_COLORS = {
  'estate-planning-attorneys': '#4f46e5',
  'elder-law-attorneys': '#7c3aed',
  'probate-attorneys': '#6d28d9',
  'cpas': '#0369a1',
  'wealth-managers': '#0284c7',
  'insurance-agencies': '#0891b2',
  'hospitals': '#dc2626',
  'hospice-organizations': '#059669',
  'home-healthcare': '#0d9488',
  'senior-living': '#d97706',
  'funeral-homes': '#78716c',
  'physicians': '#be123c',
  'memory-care': '#7e22ce',
  'veterans-organizations': '#1d4ed8',
}

function toRad(d) { return (d * Math.PI) / 180 }

function milesBetween(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return Infinity
  const R = 3958.8
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function RoleBadge({ roleId, roleLabel }) {
  const bg = ROLE_COLORS[roleId] || GREEN.mid
  return (
    <span style={{
      display: 'inline-block',
      background: bg + '18',
      color: bg,
      border: `1px solid ${bg}30`,
      borderRadius: 99,
      padding: '3px 10px',
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: 0.3,
      textTransform: 'uppercase',
    }}>
      {roleLabel}
    </span>
  )
}

function DirectionTag({ direction }) {
  if (!direction) return null
  const labels = { send: '→ Sends referrals', receive: '← Receives referrals', both: '⇄ Both directions' }
  return (
    <span style={{ fontSize: 11, color: GREEN.text, background: GREEN.light, padding: '2px 8px', borderRadius: 4, fontWeight: 500 }}>
      {labels[direction] || direction}
    </span>
  )
}

function PartnerCard({ partner, distanceMi }) {
  const distLabel = distanceMi === Infinity ? null
    : distanceMi < 1 ? '< 1 mi away'
    : `${Math.round(distanceMi)} mi away`

  const aboutSnippet = partner.about
    ? (partner.about.length > 120 ? partner.about.slice(0, 117) + '…' : partner.about)
    : null

  return (
    <div style={{
      background: 'white',
      border: `1px solid ${GRAY.border}`,
      borderRadius: 12,
      padding: '20px 22px',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>
      {/* Header */}
      <div>
        <div style={{ marginBottom: 8 }}>
          <RoleBadge roleId={partner.role_id} roleLabel={partner.role_label} />
        </div>
        <p style={{ margin: '0 0 2px', fontWeight: 700, fontSize: 16, color: '#111' }}>
          {partner.first_name} {partner.last_name}
        </p>
        <p style={{ margin: 0, fontSize: 14, color: '#374151' }}>
          {partner.organization}
        </p>
        <p style={{ margin: '2px 0 0', fontSize: 13, color: GRAY.text }}>
          {partner.city}, {partner.state}
          {distLabel && <> · <span style={{ color: GREEN.mid, fontWeight: 600 }}>{distLabel}</span></>}
        </p>
      </div>

      {/* Direction */}
      {partner.referral_direction && <DirectionTag direction={partner.referral_direction} />}

      {/* About */}
      {aboutSnippet && (
        <p style={{ margin: 0, fontSize: 13, color: '#4b5563', fontStyle: 'italic', lineHeight: 1.55 }}>
          "{aboutSnippet}"
        </p>
      )}

      {/* Contact links */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
        <a href={`mailto:${partner.email}`} style={{ color: GREEN.mid, textDecoration: 'none', fontWeight: 500 }}>
          ✉ {partner.email}
        </a>
        {partner.phone && (
          <a href={`tel:${partner.phone}`} style={{ color: GRAY.text, textDecoration: 'none' }}>
            📞 {partner.phone}
          </a>
        )}
        {partner.website && (
          <a href={partner.website} target="_blank" rel="noopener noreferrer" style={{ color: GRAY.text, textDecoration: 'none' }}>
            🔗 {partner.website.replace(/^https?:\/\//, '')}
          </a>
        )}
        {partner.linkedin && (
          <a href={partner.linkedin} target="_blank" rel="noopener noreferrer" style={{ color: '#0a66c2', textDecoration: 'none' }}>
            in LinkedIn
          </a>
        )}
      </div>
    </div>
  )
}

// Load zip coords lazily using the same zip-centroids.json bundled in members/lib/
// Only called on client; file is already server-side known.
let zipData = null
async function getZipCoords(zip) {
  if (!zip) return null
  if (!zipData) {
    try {
      const res = await fetch('/api/zip-coords?zip=' + encodeURIComponent(zip))
      if (!res.ok) return null
      const d = await res.json()
      return d.coords || null
    } catch { return null }
  }
  const z = String(zip).replace(/\D/g, '').slice(0, 5).padStart(5, '0')
  const hit = zipData[z]
  return hit ? { lat: hit[0], lng: hit[1] } : null
}

const DISTANCES = [
  { value: '25', label: '25 mi' },
  { value: '50', label: '50 mi' },
  { value: '100', label: '100 mi' },
  { value: 'state', label: 'My state' },
  { value: 'all', label: 'Nationwide' },
]

export default function PartnerNetwork({ memberZip, memberState }) {
  const [partners, setPartners] = useState([])
  const [memberCoords, setMemberCoords] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [roleFilter, setRoleFilter] = useState('all')
  const [distFilter, setDistFilter] = useState('50')

  useEffect(() => {
    // Fetch partners
    fetch('/api/partners-near-me')
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          setPartners(data.partners || [])
        } else {
          setError(data.error || 'Could not load partners.')
        }
      })
      .catch(() => setError('Could not load partners.'))
      .finally(() => setLoading(false))

    // Geocode member's own zip via API
    if (memberZip) {
      fetch(`/api/zip-coords?zip=${encodeURIComponent(memberZip)}`)
        .then(r => r.json())
        .then(d => { if (d.coords) setMemberCoords(d.coords) })
        .catch(() => {})
    }
  }, [memberZip])

  const allRoles = useMemo(() => {
    const seen = new Set()
    const roles = []
    for (const p of partners) {
      if (!seen.has(p.role_id)) {
        seen.add(p.role_id)
        roles.push({ id: p.role_id, label: p.role_label })
      }
    }
    return roles.sort((a, b) => a.label.localeCompare(b.label))
  }, [partners])

  const filtered = useMemo(() => {
    return partners
      .map(p => ({
        ...p,
        distanceMi: milesBetween(memberCoords, { lat: p.lat, lng: p.lng }),
      }))
      .filter(p => {
        if (roleFilter !== 'all' && p.role_id !== roleFilter) return false
        if (distFilter === 'all') return true
        if (distFilter === 'state') return p.state === memberState
        const maxMi = parseInt(distFilter, 10)
        return p.distanceMi <= maxMi
      })
      .sort((a, b) => a.distanceMi - b.distanceMi)
  }, [partners, roleFilter, distFilter, memberCoords, memberState])

  const selectStyle = {
    padding: '8px 12px',
    fontSize: 14,
    border: `1px solid ${GRAY.border}`,
    borderRadius: 6,
    background: 'white',
    color: '#374151',
    cursor: 'pointer',
  }

  return (
    <div style={{ marginTop: 48, paddingTop: 40, borderTop: `2px solid ${GREEN.light}` }}>
      {/* Section header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'inline-block', background: GREEN.light, color: GREEN.text, borderRadius: 99, padding: '3px 12px', fontSize: 12, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 8 }}>
          CELP® Member Benefit
        </div>
        <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 800, color: '#111' }}>
          Referral Partners Near You
        </h2>
        <p style={{ margin: 0, fontSize: 14, color: GRAY.text }}>
          Allied professionals who serve the same families — and want to connect with CELP® advisors.
        </p>
      </div>

      {/* Filters */}
      {!loading && !error && partners.length > 0 && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={roleFilter} onChange={e => setRoleFilter(e.target.value)} style={selectStyle} aria-label="Filter by role">
            <option value="all">All roles</option>
            {allRoles.map(r => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
          <select value={distFilter} onChange={e => setDistFilter(e.target.value)} style={selectStyle} aria-label="Filter by distance">
            {DISTANCES.map(d => (
              <option key={d.value} value={d.value}>{d.label}</option>
            ))}
          </select>
          <span style={{ fontSize: 13, color: GRAY.text }}>
            {filtered.length} partner{filtered.length !== 1 ? 's' : ''} found
          </span>
        </div>
      )}

      {/* States */}
      {loading && (
        <p style={{ color: GRAY.text, fontSize: 14 }}>Loading partners…</p>
      )}

      {!loading && error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 16px', color: '#dc2626', fontSize: 14 }}>
          {error}
        </div>
      )}

      {!loading && !error && partners.length === 0 && (
        <div style={{ background: GREEN.light, borderRadius: 10, padding: '24px', textAlign: 'center' }}>
          <p style={{ margin: 0, color: GREEN.dark, fontWeight: 600 }}>No approved partners yet.</p>
          <p style={{ margin: '8px 0 0', color: GREEN.text, fontSize: 14 }}>
            Know a great allied professional? Share the application link:&nbsp;
            <a href="https://arpinstitute.com/partners/apply" style={{ color: GREEN.mid, fontWeight: 600 }}>
              arpinstitute.com/partners/apply
            </a>
          </p>
        </div>
      )}

      {!loading && !error && filtered.length === 0 && partners.length > 0 && (
        <div style={{ background: GRAY.bg, borderRadius: 10, padding: '24px', textAlign: 'center' }}>
          <p style={{ margin: 0, color: GRAY.text }}>No partners match your filters. Try expanding the distance or selecting all roles.</p>
        </div>
      )}

      {/* Grid */}
      {filtered.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: 16,
        }}>
          {filtered.map(p => (
            <PartnerCard key={p.id} partner={p} distanceMi={p.distanceMi} />
          ))}
        </div>
      )}
    </div>
  )
}
