import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { useState } from 'react'

const GREEN = { dark: '#1a4a37', mid: '#2a6b54', light: '#d9ede5', text: '#2a6b54' }
const GRAY = { text: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' }

export async function getServerSideProps(context) {
  const supabaseServer = createServerSupabaseClient(context)
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session) return { redirect: { destination: '/login', permanent: false } }

  const isAdmin = session.user.email === 'jstanley@nssapros.com'
  if (!isAdmin) return { redirect: { destination: '/dashboard', permanent: false } }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data: partners, error } = await supabaseAdmin
    .from('celp_partners')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('celp_partners fetch error:', error.message)
  }

  return {
    props: {
      partners: JSON.parse(JSON.stringify(partners || [])),
    },
  }
}

function StatusBadge({ status }) {
  const styles = {
    pending:  { bg: '#fef9c3', color: '#854d0e', border: '#fde68a', label: 'Pending' },
    approved: { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0', label: 'Approved' },
    rejected: { bg: '#fef2f2', color: '#dc2626', border: '#fecaca', label: 'Rejected' },
  }
  const s = styles[status] || styles.pending
  return (
    <span style={{ fontSize: '11px', padding: '2px 10px', borderRadius: '99px', background: s.bg, color: s.color, border: `1px solid ${s.border}`, fontWeight: 600, whiteSpace: 'nowrap' }}>
      {s.label}
    </span>
  )
}

function DirectionBadge({ direction }) {
  const labels = { send: 'Sends referrals', receive: 'Receives referrals', both: 'Both directions' }
  return (
    <span style={{ fontSize: '12px', color: GREEN.text, background: GREEN.light, padding: '2px 8px', borderRadius: 4, fontWeight: 500 }}>
      {labels[direction] || direction}
    </span>
  )
}

function PartnerRow({ partner, onAction }) {
  const [acting, setActing] = useState(null)

  async function doAction(action) {
    setActing(action)
    try {
      const res = await fetch(`/api/admin/partner-${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: partner.id }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Action failed')
      onAction(partner.id, action)
    } catch (err) {
      alert(err.message)
    } finally {
      setActing(null)
    }
  }

  const appliedDate = partner.created_at
    ? new Date(partner.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '—'

  return (
    <div style={{ border: `1px solid ${GRAY.border}`, borderRadius: 10, padding: '20px 24px', marginBottom: 16, background: 'white' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 700, fontSize: 16, color: '#111' }}>
              {partner.first_name} {partner.last_name}
            </span>
            <StatusBadge status={partner.status} />
          </div>
          <p style={{ margin: '0 0 4px', fontSize: 14, color: '#374151' }}>
            <strong>{partner.organization}</strong> · {partner.role_label}
          </p>
          <p style={{ margin: '0 0 8px', fontSize: 13, color: GRAY.text }}>
            {partner.city}, {partner.state} {partner.zip} · Applied {appliedDate}
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
            <DirectionBadge direction={partner.referral_direction} />
            {partner.clients_per_year && (
              <span style={{ fontSize: 12, color: GRAY.text, background: GRAY.bg, padding: '2px 8px', borderRadius: 4 }}>
                {partner.clients_per_year} clients/yr
              </span>
            )}
          </div>
          {partner.about && (
            <p style={{ margin: '0 0 10px', fontSize: 13, color: '#4b5563', fontStyle: 'italic', lineHeight: 1.55, borderLeft: `3px solid ${GREEN.light}`, paddingLeft: 12 }}>
              "{partner.about.slice(0, 200)}{partner.about.length > 200 ? '…' : ''}"
            </p>
          )}
          <div style={{ fontSize: 12, color: GRAY.text, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <a href={`mailto:${partner.email}`} style={{ color: GREEN.mid }}>{partner.email}</a>
            {partner.phone && <span>{partner.phone}</span>}
            {partner.website && (
              <a href={partner.website} target="_blank" rel="noopener noreferrer" style={{ color: GREEN.mid }}>
                {partner.website.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>
        </div>

        {partner.status === 'pending' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 120 }}>
            <button
              onClick={() => doAction('approve')}
              disabled={!!acting}
              style={{ padding: '8px 18px', background: GREEN.mid, color: 'white', border: 'none', borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: acting ? 'not-allowed' : 'pointer' }}
            >
              {acting === 'approve' ? 'Approving…' : '✓ Approve'}
            </button>
            <button
              onClick={() => doAction('reject')}
              disabled={!!acting}
              style={{ padding: '8px 18px', background: 'white', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 6, fontWeight: 700, fontSize: 13, cursor: acting ? 'not-allowed' : 'pointer' }}
            >
              {acting === 'reject' ? 'Rejecting…' : '✗ Reject'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function AdminPartners({ partners: initialPartners }) {
  const [partners, setPartners] = useState(initialPartners)
  const [tab, setTab] = useState('pending')

  function handleAction(id, action) {
    setPartners(prev =>
      prev.map(p => p.id === id ? { ...p, status: action === 'approve' ? 'approved' : 'rejected' } : p)
    )
  }

  const pending  = partners.filter(p => p.status === 'pending')
  const approved = partners.filter(p => p.status === 'approved')
  const rejected = partners.filter(p => p.status === 'rejected')

  const tabs = [
    { id: 'pending',  label: `Pending (${pending.length})` },
    { id: 'approved', label: `Approved (${approved.length})` },
    { id: 'rejected', label: `Rejected (${rejected.length})` },
  ]

  const current = tab === 'pending' ? pending : tab === 'approved' ? approved : rejected

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ background: GREEN.dark, padding: '20px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p style={{ margin: 0, color: '#b4d9cc', fontSize: 13 }}>
            <a href="/admin" style={{ color: '#b4d9cc', textDecoration: 'none' }}>← Admin</a>
          </p>
          <h1 style={{ margin: '4px 0 0', color: 'white', fontSize: 22, fontWeight: 700 }}>
            CELP® Partner Applications
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '6px 14px', fontSize: 13, fontWeight: 600, borderRadius: 6, cursor: 'pointer', border: 'none',
                background: tab === t.id ? 'white' : 'rgba(255,255,255,0.15)',
                color: tab === t.id ? GREEN.dark : 'white',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: '32px' }}>
        {current.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: GRAY.text }}>
            <p style={{ fontSize: 16 }}>No {tab} applications.</p>
          </div>
        ) : (
          current.map(partner => (
            <PartnerRow key={partner.id} partner={partner} onAction={handleAction} />
          ))
        )}
      </div>
    </div>
  )
}
