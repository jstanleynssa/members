import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { useState } from 'react'
import Link from 'next/link'

const NSSA  = { dark: '#13405E', medium: '#1C80BC', light: '#8ECAEE' }
const IRMAA = { dark: '#AF2A35', medium: '#DE5B63', light: '#ED8E8E' }
const GRAY  = { text: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' }
const GREEN = { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' }

export async function getServerSideProps(context) {
  const supabaseServer = createServerSupabaseClient(context)
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session) return { redirect: { destination: '/login', permanent: false } }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data: member } = await supabaseAdmin
    .from('members')
    .select('email, first_name, last_name, nssa_certified, irmaa_certified, nssa_cert_date, irmaa_cert_date, nssa_number, irmaa_number, profile_photo, job_title, company, city, state, phone, website, bio, is_active')
    .eq('email', session.user.email)
    .single()

  // Guard: must be a certified, active member
  if (!member || (!member.nssa_certified && !member.irmaa_certified)) {
    await supabaseServer.auth.signOut()
    return { redirect: { destination: '/login?error=not_authorized', permanent: false } }
  }

  const selectedYear = parseInt(context.query.year) || new Date().getFullYear()

  // CE submissions for selected year
  const { data: subs } = await supabaseAdmin
    .from('ce_submissions')
    .select('*')
    .eq('email', session.user.email)
    .order('completion_date', { ascending: false })

  const years = [...new Set((subs || []).map(r => r.year).filter(Boolean))].sort((a, b) => b - a)
  const currentYear = new Date().getFullYear()
  if (!years.includes(currentYear)) years.unshift(currentYear)

  const yearSubs = (subs || []).filter(s => s.year === selectedYear && s.status === 'approved')
  const nssaHours  = yearSubs.filter(s => s.designation === 'NSSA'  || s.designation === 'both').reduce((sum, s) => sum + Number(s.hours_earned), 0)
  const irmaaHours = yearSubs.filter(s => s.designation === 'IRMAA' || s.designation === 'both').reduce((sum, s) => sum + Number(s.hours_earned), 0)

  const certYear = (d) => d ? new Date(d).getFullYear() : null
  const nssaExempt  = certYear(member.nssa_cert_date)  === selectedYear
  const irmaaExempt = certYear(member.irmaa_cert_date) === selectedYear

  const nssaStatus = !member.nssa_certified ? 'na'
    : nssaExempt  ? 'exempt'
    : nssaHours  >= 4 ? 'met'
    : nssaHours  > 0  ? 'progress'
    : 'unstarted'

  const irmaaStatus = !member.irmaa_certified ? 'na'
    : irmaaExempt ? 'exempt'
    : irmaaHours >= 4 ? 'met'
    : irmaaHours > 0  ? 'progress'
    : 'unstarted'

  const daysLeft = Math.ceil((new Date(`${selectedYear}-12-31`) - new Date()) / (1000 * 60 * 60 * 24))

  return {
    props: {
      member: JSON.parse(JSON.stringify(member)),
      subs: JSON.parse(JSON.stringify(subs || [])),
      selectedYear,
      availableYears: years,
      currentYear,
      nssaHours: nssaExempt ? 4 : nssaHours,
      irmaaHours: irmaaExempt ? 4 : irmaaHours,
      nssaStatus,
      irmaaStatus,
      daysLeft,
      userEmail: session.user.email,
    }
  }
}

function StatusPill({ status, hours }) {
  const map = {
    met:       { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0', label: '✓ Requirement Met' },
    exempt:    { bg: '#eff6ff', color: NSSA.medium, border: NSSA.light, label: '✓ Exempt — new cert' },
    progress:  { bg: '#fef9c3', color: '#854d0e', border: '#fde68a', label: 'In progress' },
    unstarted: { bg: '#fef2f2', color: '#dc2626', border: '#fecaca', label: 'Not started' },
    na:        { bg: GRAY.bg,   color: GRAY.text,  border: GRAY.border, label: 'Not enrolled' },
  }
  const s = map[status] || map.na
  return (
    <span style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '99px', background: s.bg, color: s.color, border: `1px solid ${s.border}`, fontWeight: 500 }}>
      {s.label}
    </span>
  )
}

export default function Dashboard({ member, subs, selectedYear, availableYears, currentYear, nssaHours, irmaaHours, nssaStatus, irmaaStatus, daysLeft, userEmail }) {
  const [yearFilter, setYearFilter] = useState(selectedYear)

  const filteredSubs = subs.filter(s => s.year === yearFilter)
  const isAdmin = userEmail === 'jstanley@nssapros.com'

  function statusColor(s) {
    if (s === 'approved') return { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' }
    if (s === 'rejected') return { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' }
    return { bg: '#fef9c3', color: '#854d0e', border: '#fde68a' }
  }

  const td = { padding: '10px 14px', fontSize: '13px', verticalAlign: 'middle', borderTop: `1px solid ${GRAY.bg}` }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{ background: 'white', borderBottom: `1px solid ${GRAY.border}`, padding: '1rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <img src="/nssa-irmaa-logos.png" alt="NSSA IRMAA logos" style={{ height: '40px', width: 'auto' }} />
          <div>
            <h1 style={{ fontSize: '16px', fontWeight: 700, color: '#111' }}>Member Dashboard</h1>
            <p style={{ fontSize: '12px', color: GRAY.text }}>Welcome back, {member.first_name || 'Member'}</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {isAdmin && (
            <Link href="/admin/members" style={{ fontSize: '12px', color: NSSA.medium, textDecoration: 'none', fontWeight: 500 }}>
              Admin →
            </Link>
          )}
          <span style={{ fontSize: '12px', color: GRAY.text }}>{userEmail}</span>
          <Link href="/api/auth/signout" style={{ fontSize: '12px', color: GRAY.text, textDecoration: 'none', padding: '5px 10px', border: `1px solid ${GRAY.border}`, borderRadius: '5px' }}>
            Sign out
          </Link>
        </div>
      </div>

      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem' }}>

        {/* CE Requirements Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '11px', fontWeight: 600, color: GRAY.text, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            CE Requirements — {selectedYear}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {daysLeft > 0 && daysLeft < 365 && (
              <span style={{ fontSize: '12px', color: daysLeft < 60 ? '#dc2626' : GRAY.text, background: daysLeft < 60 ? '#fef2f2' : GRAY.bg, padding: '3px 10px', borderRadius: '99px', border: `1px solid ${daysLeft < 60 ? '#fecaca' : GRAY.border}` }}>
                {daysLeft} days remaining in {selectedYear}
              </span>
            )}
          </div>
        </div>

        {/* CE Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>

          {/* NSSA CE Card */}
          {member.nssa_certified && (
            <div style={{ background: 'white', border: `2px solid ${nssaStatus === 'met' || nssaStatus === 'exempt' ? NSSA.medium : nssaStatus === 'unstarted' ? '#fecaca' : '#fde68a'}`, borderRadius: '10px', padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <span style={{ fontSize: '13px', color: GRAY.text }}>NSSA® CE Requirement</span>
                <StatusPill status={nssaStatus} hours={nssaHours} />
              </div>
              <p style={{ fontSize: '32px', fontWeight: 700, color: nssaStatus === 'met' || nssaStatus === 'exempt' ? NSSA.dark : nssaStatus === 'unstarted' ? '#dc2626' : '#854d0e', marginBottom: '6px' }}>
                {nssaHours} <span style={{ fontSize: '14px', fontWeight: 400, color: GRAY.text }}>/ 4 hrs</span>
              </p>
              <p style={{ fontSize: '12px', color: GRAY.text, marginBottom: '12px' }}>
                {nssaHours} of 4 hours completed &nbsp; {Math.round((nssaHours / 4) * 100)}%
              </p>
              <div style={{ background: GRAY.bg, borderRadius: '4px', height: '6px', overflow: 'hidden', marginBottom: '1rem' }}>
                <div style={{ height: '100%', width: `${Math.min(100, (nssaHours / 4) * 100)}%`, background: nssaStatus === 'met' || nssaStatus === 'exempt' ? NSSA.medium : '#f59e0b', borderRadius: '4px' }} />
              </div>
              {nssaStatus !== 'met' && nssaStatus !== 'exempt' && (
                <Link href="/ce/submit?designation=NSSA" style={{ display: 'block', textAlign: 'center', padding: '9px', background: NSSA.dark, color: 'white', borderRadius: '6px', fontSize: '13px', fontWeight: 500, textDecoration: 'none' }}>
                  + Submit NSSA® CE
                </Link>
              )}
            </div>
          )}

          {/* IRMAA CE Card */}
          {member.irmaa_certified && (
            <div style={{ background: 'white', border: `2px solid ${irmaaStatus === 'met' || irmaaStatus === 'exempt' ? IRMAA.medium : irmaaStatus === 'unstarted' ? '#fecaca' : '#fde68a'}`, borderRadius: '10px', padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <span style={{ fontSize: '13px', color: GRAY.text }}>IRMAACP™ CE Requirement</span>
                <StatusPill status={irmaaStatus} hours={irmaaHours} />
              </div>
              <p style={{ fontSize: '32px', fontWeight: 700, color: irmaaStatus === 'met' || irmaaStatus === 'exempt' ? IRMAA.dark : irmaaStatus === 'unstarted' ? '#dc2626' : '#854d0e', marginBottom: '6px' }}>
                {irmaaHours} <span style={{ fontSize: '14px', fontWeight: 400, color: GRAY.text }}>/ 4 hrs</span>
              </p>
              <p style={{ fontSize: '12px', color: GRAY.text, marginBottom: '12px' }}>
                {irmaaHours} of 4 hours completed &nbsp; {Math.round((irmaaHours / 4) * 100)}%
              </p>
              <div style={{ background: GRAY.bg, borderRadius: '4px', height: '6px', overflow: 'hidden', marginBottom: '1rem' }}>
                <div style={{ height: '100%', width: `${Math.min(100, (irmaaHours / 4) * 100)}%`, background: irmaaStatus === 'met' || irmaaStatus === 'exempt' ? IRMAA.medium : '#f59e0b', borderRadius: '4px' }} />
              </div>
              {irmaaStatus !== 'met' && irmaaStatus !== 'exempt' && (
                <Link href="/ce/submit?designation=IRMAA" style={{ display: 'block', textAlign: 'center', padding: '9px', background: IRMAA.dark, color: 'white', borderRadius: '6px', fontSize: '13px', fontWeight: 500, textDecoration: 'none' }}>
                  + Submit IRMAACP™ CE
                </Link>
              )}
            </div>
          )}

          {/* Enrollment CTAs for non-certified designations */}
          {!member.nssa_certified && (
            <div style={{ background: 'white', border: `1px solid ${GRAY.border}`, borderRadius: '10px', padding: '1.5rem' }}>
              <p style={{ fontWeight: 600, marginBottom: '6px' }}>Earn Your NSSA® Designation</p>
              <p style={{ fontSize: '13px', color: GRAY.text, marginBottom: '1rem' }}>Get certified and join 1,700+ NSSA® advisors.</p>
              <a href="https://nssapros.com/nssa-course" style={{ display: 'block', textAlign: 'center', padding: '9px', background: NSSA.dark, color: 'white', borderRadius: '6px', fontSize: '13px', fontWeight: 500, textDecoration: 'none' }}>
                Enroll — 50% off
              </a>
            </div>
          )}

          {!member.irmaa_certified && (
            <div style={{ background: 'white', border: `1px solid ${GRAY.border}`, borderRadius: '10px', padding: '1.5rem' }}>
              <p style={{ fontWeight: 600, marginBottom: '6px' }}>Earn Your IRMAACP™ Designation</p>
              <p style={{ fontSize: '13px', color: GRAY.text, marginBottom: '1rem' }}>Add IRMAA expertise to your practice.</p>
              <a href="https://nssapros.com/irmaa-course" style={{ display: 'block', textAlign: 'center', padding: '9px', background: IRMAA.dark, color: 'white', borderRadius: '6px', fontSize: '13px', fontWeight: 500, textDecoration: 'none' }}>
                Enroll — 50% off
              </a>
            </div>
          )}
        </div>

        {/* CE Submission History */}
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '11px', fontWeight: 600, color: GRAY.text, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              CE Submission History
            </h2>
            <select
              value={yearFilter}
              onChange={e => setYearFilter(parseInt(e.target.value))}
              style={{ fontSize: '13px', padding: '5px 10px', borderRadius: '6px', border: `1px solid ${GRAY.border}`, background: 'white' }}
            >
              {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          <div style={{ background: 'white', border: `1px solid ${GRAY.border}`, borderRadius: '10px', overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', fontSize: '12px', color: GRAY.text, borderBottom: `1px solid ${GRAY.bg}`, display: 'flex', justifyContent: 'space-between' }}>
              <span>{yearFilter} Submissions</span>
              <span style={{ color: GRAY.text }}>Pending submissions reviewed within 48 hours</span>
            </div>

            {filteredSubs.length === 0 ? (
              <div style={{ padding: '2.5rem', textAlign: 'center' }}>
                <p style={{ color: GRAY.text, fontSize: '13px', marginBottom: '1rem' }}>No CE submissions for {yearFilter}.</p>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                  {member.nssa_certified && (
                    <Link href="/ce/submit?designation=NSSA" style={{ fontSize: '13px', color: NSSA.medium, textDecoration: 'none', fontWeight: 500 }}>
                      + Submit NSSA® CE
                    </Link>
                  )}
                  {member.irmaa_certified && (
                    <Link href="/ce/submit?designation=IRMAA" style={{ fontSize: '13px', color: IRMAA.medium, textDecoration: 'none', fontWeight: 500 }}>
                      + Submit IRMAACP™ CE
                    </Link>
                  )}
                </div>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#fafafa' }}>
                    {['Date', 'Course Title', 'CE Type', 'Hours', 'Designation', 'Status'].map(h => (
                      <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: GRAY.text, borderBottom: `1px solid ${GRAY.border}` }}>{h}</th>
                    ))}
                    <th style={{ padding: '9px 14px', borderBottom: `1px solid ${GRAY.border}` }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSubs.map(s => {
                    const sc = statusColor(s.status)
                    return (
                      <tr key={s.id}>
                        <td style={td}>{s.completion_date ? new Date(s.completion_date).toLocaleDateString() : '—'}</td>
                        <td style={{ ...td, fontWeight: 500, maxWidth: '220px' }}>{s.course_title || '—'}</td>
                        <td style={td}>{s.ce_type || '—'}</td>
                        <td style={{ ...td, fontWeight: 600 }}>{s.hours_earned}</td>
                        <td style={td}>
                          <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: s.designation === 'NSSA' ? '#eff6ff' : s.designation === 'IRMAA' ? '#fef2f2' : '#f5f3ff', color: s.designation === 'NSSA' ? NSSA.medium : s.designation === 'IRMAA' ? IRMAA.dark : '#7c3aed' }}>
                            {s.designation}
                          </span>
                        </td>
                        <td style={td}>
                          <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '99px', background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`, fontWeight: 500, textTransform: 'capitalize' }}>
                            {s.status}
                          </span>
                        </td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          {s.status === 'pending' && (
                            <Link href={`/ce/edit/${s.id}`} style={{ fontSize: '12px', color: GRAY.text, textDecoration: 'none' }}>Edit</Link>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Member Profile */}
        <div>
          <h2 style={{ fontSize: '11px', fontWeight: 600, color: GRAY.text, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '1rem' }}>
            Member Profile
          </h2>
          <div style={{ background: 'white', border: `1px solid ${GRAY.border}`, borderRadius: '10px', padding: '1.5rem', display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>

            {/* Photo */}
            <div style={{ flexShrink: 0 }}>
              {member.profile_photo ? (
                <img
                  src={member.profile_photo}
                  alt={`${member.first_name} ${member.last_name}`}
                  style={{ width: '100px', height: '103px', objectFit: 'cover', objectPosition: 'top', borderRadius: '8px', border: `1px solid ${GRAY.border}` }}
                />
              ) : (
                <div style={{ width: '100px', height: '103px', borderRadius: '8px', background: NSSA.dark, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '32px', fontWeight: 700 }}>
                  {member.first_name?.[0] || '?'}
                </div>
              )}
            </div>

            {/* Details */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '6px' }}>
                <div>
                  <p style={{ fontWeight: 700, fontSize: '17px', color: '#111', marginBottom: '2px' }}>
                    {member.first_name} {member.last_name}
                  </p>
                  {(member.job_title || member.company) && (
                    <p style={{ fontSize: '13px', color: GRAY.text, marginBottom: '2px' }}>
                      {[member.job_title, member.company].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  {(member.city || member.state) && (
                    <p style={{ fontSize: '12px', color: GRAY.text }}>
                      {[member.city, member.state].filter(Boolean).join(', ')}
                    </p>
                  )}
                </div>
                <Link href="/profile/edit" style={{ fontSize: '12px', color: NSSA.medium, textDecoration: 'none', fontWeight: 500, whiteSpace: 'nowrap', marginLeft: '1rem' }}>
                  Edit Profile →
                </Link>
              </div>

              {/* Cert badges */}
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
                {member.nssa_certified && (
                  <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#eff6ff', color: NSSA.medium, border: `1px solid ${NSSA.light}` }}>
                    NSSA® Certified{member.nssa_number ? ` #${member.nssa_number}` : ''}
                  </span>
                )}
                {member.irmaa_certified && (
                  <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#fef2f2', color: IRMAA.dark, border: `1px solid ${IRMAA.light}` }}>
                    IRMAACP™ Certified{member.irmaa_number ? ` #${member.irmaa_number}` : ''}
                  </span>
                )}
              </div>

              {/* Contact row */}
              {(member.phone || member.website) && (
                <div style={{ display: 'flex', gap: '16px', marginBottom: '10px', flexWrap: 'wrap' }}>
                  {member.phone && (
                    <span style={{ fontSize: '12px', color: GRAY.text }}>📞 {member.phone}</span>
                  )}
                  {member.website && (
                    <a href={member.website} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: NSSA.medium, textDecoration: 'none' }}>
                      🌐 {member.website.replace(/^https?:\/\//, '')}
                    </a>
                  )}
                </div>
              )}

              {/* Bio */}
              {member.bio && (
                <p style={{ fontSize: '13px', color: '#374151', lineHeight: 1.5, maxWidth: '680px', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {member.bio}
                </p>
              )}

              {/* Empty state */}
              {!member.job_title && !member.bio && !member.phone && (
                <p style={{ fontSize: '12px', color: GRAY.text, fontStyle: 'italic' }}>
                  Your profile is incomplete —{' '}
                  <Link href="/profile/edit" style={{ color: NSSA.medium, textDecoration: 'none' }}>add your details</Link>
                  {' '}to appear in the advisor directory.
                </p>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
