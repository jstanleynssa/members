import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'

const NSSA = { light: '#8ECAEE', medium: '#1C80BC', dark: '#13405E' }
const IRMAA = { light: '#ED8E8E', medium: '#DE5B63', dark: '#AF2A35' }

function daysLeftInYear() {
  const now = new Date()
  const end = new Date(now.getFullYear(), 11, 31)
  return Math.ceil((end - now) / (1000 * 60 * 60 * 24))
}

function CEProgressBar({ completed, required, color }) {
  const pct = required > 0 ? Math.min(100, Math.round((completed / required) * 100)) : 0
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#6b7280', marginBottom: '4px' }}>
        <span>{completed} of {required} hours completed</span>
        <span>{pct}%</span>
      </div>
      <div style={{ background: '#f3f4f6', borderRadius: '4px', height: '8px' }}>
        <div style={{ background: color, borderRadius: '4px', height: '8px', width: `${pct}%`, transition: 'width 0.3s' }} />
      </div>
    </div>
  )
}

export async function getServerSideProps(context) {
  const supabaseServer = createServerSupabaseClient(context)
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session) return { redirect: { destination: '/login', permanent: false } }

  const isAdmin = session.user.email === 'jstanley@nssapros.com'
  if (!isAdmin) return { redirect: { destination: '/dashboard', permanent: false } }

  const viewEmail = context.query.email
  if (!viewEmail) return { redirect: { destination: '/admin/members', permanent: false } }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const currentYear = new Date().getFullYear()

  const { data: member } = await supabaseAdmin
    .from('members')
    .select('*')
    .eq('email', viewEmail)
    .single()

  if (!member) return { redirect: { destination: '/admin/members', permanent: false } }

  const { data: submissions } = await supabaseAdmin
    .from('ce_submissions')
    .select('*')
    .eq('email', viewEmail)
    .order('completion_date', { ascending: false })

  const currentApproved = (submissions || []).filter(s => s.status === 'approved' && s.year === currentYear)
  const nssaHours = currentApproved
    .filter(s => s.designation === 'NSSA' || s.designation === 'both')
    .reduce((sum, s) => sum + Number(s.hours_earned), 0)
  const irmaaHours = currentApproved
    .filter(s => s.designation === 'IRMAA' || s.designation === 'both')
    .reduce((sum, s) => sum + Number(s.hours_earned), 0)

  const certYear = (yr) => yr ? new Date(yr).getFullYear() : null
  const nssaExempt = certYear(member.nssa_cert_date) === currentYear
  const irmaaExempt = certYear(member.irmaa_cert_date) === currentYear

  const years = [...new Set((submissions || []).map(s => s.year))].sort((a, b) => b - a)
  if (!years.includes(currentYear)) years.unshift(currentYear)

  return {
    props: {
      member,
      submissions: submissions || [],
      nssaHours,
      irmaaHours,
      nssaExempt,
      irmaaExempt,
      currentYear,
      availableYears: years,
      viewEmail
    }
  }
}

export default function MemberView({ member, submissions, nssaHours, irmaaHours, nssaExempt, irmaaExempt, currentYear, availableYears, viewEmail }) {
  const days = daysLeftInYear()
  const nssaMet = nssaExempt || nssaHours >= 4
  const irmaaMet = irmaaExempt || irmaaHours >= 4
  const firstName = member?.first_name || viewEmail.split('@')[0]
  const fullName = [member?.first_name, member?.last_name].filter(Boolean).join(' ')

  function StatusBadge({ submission }) {
    if (submission.source === 'zoom_auto') return <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#f0fdf4', color: '#15803d' }}>✓ Auto (Zoom)</span>
    if (submission.status === 'approved') return <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#f0fdf4', color: '#15803d' }}>✓ Approved</span>
    if (submission.status === 'pending') return <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#fef9c3', color: '#854d0e', border: '1px solid #fde68a' }}>⏳ Pending</span>
    if (submission.status === 'rejected') return <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#fef2f2', color: '#dc2626' }}>✗ Rejected</span>
    return null
  }

  function DesignationBadge({ designation }) {
    return (
      <span style={{
        fontSize: '11px', padding: '2px 8px', borderRadius: '4px',
        background: designation === 'NSSA' ? '#eff6ff' : designation === 'IRMAA' ? '#fef2f2' : '#f0fdf4',
        color: designation === 'NSSA' ? NSSA.medium : designation === 'IRMAA' ? IRMAA.medium : '#15803d'
      }}>
        {designation === 'both' ? 'NSSA + IRMAA' : designation}
      </span>
    )
  }

  const sectionLabel = { fontSize: '11px', fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }

  return (
    <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>

      {/* Admin banner */}
      <div style={{ background: '#1a1a1a', color: 'white', borderRadius: '8px', padding: '10px 16px', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '12px', background: '#f59e0b', color: '#1a1a1a', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>ADMIN VIEW</span>
          <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.8)' }}>Viewing as <strong style={{ color: 'white' }}>{fullName || viewEmail}</strong></span>
        </div>
        <Link href="/admin/members" style={{ fontSize: '12px', color: 'rgba(255,255,255,0.7)', textDecoration: 'none' }}>← Back to CE Dashboard</Link>
      </div>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '2px', color: '#111' }}>Member Dashboard</h1>
          <p style={{ color: '#6b7280', fontSize: '14px' }}>Welcome back, {firstName}</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' }}>
          <img src="/nssa-irmaa-logos.png" alt="NSSA and IRMAACP logos" style={{ height: '50px', width: 'auto' }} />
          <span style={{ fontSize: '12px', color: '#6b7280' }}>{viewEmail}</span>
        </div>
      </div>

      {/* CE Requirements */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <p style={sectionLabel}>CE Requirements — {currentYear}</p>
          <span style={{ fontSize: '12px', padding: '3px 12px', borderRadius: '99px', background: days <= 60 ? '#fef2f2' : '#f0fdf4', color: days <= 60 ? '#dc2626' : '#15803d', border: `1px solid ${days <= 60 ? '#fecaca' : '#bbf7d0'}`, fontWeight: 500 }}>
            {days} days remaining in {currentYear}
          </span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          {member?.nssa_certified ? (
            <div style={{ background: 'white', borderRadius: '10px', padding: '1.5rem', border: '1px solid #e5e7eb', borderTop: `4px solid ${NSSA.medium}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <div>
                  <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '2px' }}>NSSA® CE Requirement</p>
                  <p style={{ fontSize: '28px', fontWeight: 700, color: NSSA.dark }}>{nssaExempt ? '4' : nssaHours}<span style={{ fontSize: '16px', fontWeight: 400, color: '#9ca3af' }}> / 4 hrs</span></p>
                </div>
                <span style={{ fontSize: '12px', padding: '3px 10px', borderRadius: '99px', fontWeight: 500, background: nssaMet ? '#f0fdf4' : '#fef9c3', color: nssaMet ? '#15803d' : '#854d0e', border: `1px solid ${nssaMet ? '#bbf7d0' : '#fde68a'}` }}>
                  {nssaMet ? '✓ Requirement met' : 'In progress'}
                </span>
              </div>
              {nssaExempt ? (
                <p style={{ fontSize: '12px', color: '#6b7280', background: '#f0fdf4', padding: '8px 12px', borderRadius: '6px', border: '1px solid #bbf7d0' }}>✓ CE requirement waived — designation earned this year.</p>
              ) : (
                <CEProgressBar completed={nssaHours} required={4} color={NSSA.medium} />
              )}
            </div>
          ) : (
            <div style={{ background: 'white', borderRadius: '10px', padding: '1.5rem', border: '1px solid #e5e7eb', borderTop: `4px solid ${NSSA.light}` }}>
              <p style={{ fontSize: '13px', fontWeight: 600, color: NSSA.dark, marginBottom: '4px' }}>NSSA® — Not certified</p>
              <p style={{ fontSize: '13px', color: '#6b7280' }}>This member does not hold the NSSA® designation.</p>
            </div>
          )}
          {member?.irmaa_certified ? (
            <div style={{ background: 'white', borderRadius: '10px', padding: '1.5rem', border: '1px solid #e5e7eb', borderTop: `4px solid ${IRMAA.medium}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <div>
                  <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '2px' }}>IRMAACP™ CE Requirement</p>
                  <p style={{ fontSize: '28px', fontWeight: 700, color: IRMAA.dark }}>{irmaaExempt ? '4' : irmaaHours}<span style={{ fontSize: '16px', fontWeight: 400, color: '#9ca3af' }}> / 4 hrs</span></p>
                </div>
                <span style={{ fontSize: '12px', padding: '3px 10px', borderRadius: '99px', fontWeight: 500, background: irmaaMet ? '#f0fdf4' : '#fef9c3', color: irmaaMet ? '#15803d' : '#854d0e', border: `1px solid ${irmaaMet ? '#bbf7d0' : '#fde68a'}` }}>
                  {irmaaMet ? '✓ Requirement met' : 'In progress'}
                </span>
              </div>
              {irmaaExempt ? (
                <p style={{ fontSize: '12px', color: '#6b7280', background: '#f0fdf4', padding: '8px 12px', borderRadius: '6px', border: '1px solid #bbf7d0' }}>✓ CE requirement waived — designation earned this year.</p>
              ) : (
                <CEProgressBar completed={irmaaHours} required={4} color={IRMAA.medium} />
              )}
            </div>
          ) : (
            <div style={{ background: 'white', borderRadius: '10px', padding: '1.5rem', border: '1px solid #e5e7eb', borderTop: `4px solid ${IRMAA.light}` }}>
              <p style={{ fontSize: '13px', fontWeight: 600, color: IRMAA.dark, marginBottom: '4px' }}>IRMAACP™ — Not certified</p>
              <p style={{ fontSize: '13px', color: '#6b7280' }}>This member does not hold the IRMAACP™ designation.</p>
            </div>
          )}
        </div>
      </div>

      {/* CE Submission History */}
      <div style={{ marginBottom: '2rem' }}>
        <p style={sectionLabel}>CE Submission History</p>
        <div style={{ background: 'white', borderRadius: '10px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
          <div style={{ padding: '0.875rem 1.5rem', borderBottom: '1px solid #f3f4f6', background: '#f9fafb' }}>
            <span style={{ fontSize: '13px', fontWeight: 500, color: '#374151' }}>All Submissions ({submissions.length})</span>
          </div>
          {submissions.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>No CE submissions on record.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  {['Date', 'Course Title', 'CE Type', 'Hours', 'Designation', 'Status', 'Source'].map(h => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: '12px', fontWeight: 500, color: '#6b7280', borderBottom: '1px solid #f3f4f6' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {submissions.map((s, i) => (
                  <tr key={s.id} style={{ borderTop: i > 0 ? '1px solid #f3f4f6' : 'none', opacity: s.status === 'rejected' ? 0.6 : 1 }}>
                    <td style={{ padding: '11px 16px', fontSize: '13px', whiteSpace: 'nowrap' }}>{new Date(s.completion_date).toLocaleDateString()}</td>
                    <td style={{ padding: '11px 16px', fontSize: '13px', fontWeight: 500 }}>{s.course_title}</td>
                    <td style={{ padding: '11px 16px', fontSize: '13px', color: '#6b7280' }}>{s.ce_type}</td>
                    <td style={{ padding: '11px 16px', fontSize: '13px' }}>{s.hours_earned}</td>
                    <td style={{ padding: '11px 16px', fontSize: '13px' }}><DesignationBadge designation={s.designation} /></td>
                    <td style={{ padding: '11px 16px', fontSize: '13px' }}><StatusBadge submission={s} /></td>
                    <td style={{ padding: '11px 16px', fontSize: '12px', color: '#9ca3af' }}>{s.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Member Profile */}
      <div>
        <p style={sectionLabel}>Member Profile</p>
        <div style={{ background: 'white', borderRadius: '10px', border: '1px solid #e5e7eb', padding: '1.25rem 1.5rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem', fontSize: '13px' }}>
            {[
              ['Name', fullName || '—'],
              ['Email', viewEmail],
              ['Company', member?.company || '—'],
              ['Phone', member?.phone || '—'],
              ['State', member?.state || '—'],
              ['City', member?.city || '—'],
              ['NSSA Number', member?.nssa_number || '—'],
              ['IRMAA Number', member?.irmaa_number || '—'],
              ['NSSA Cert Date', member?.nssa_cert_date ? new Date(member.nssa_cert_date).toLocaleDateString() : '—'],
              ['IRMAA Cert Date', member?.irmaa_cert_date ? new Date(member.irmaa_cert_date).toLocaleDateString() : '—'],
              ['Status', member?.is_active ? 'Active' : 'Inactive'],
            ].map(([label, val]) => (
              <div key={label}>
                <p style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</p>
                <p style={{ fontWeight: 500 }}>{val}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
