import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'

const NSSA  = { dark: '#13405E', medium: '#1C80BC', light: '#8ECAEE' }
const IRMAA = { dark: '#AF2A35', medium: '#DE5B63', light: '#ED8E8E' }
const GRAY  = { text: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' }
const GREEN = { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' }

export async function getServerSideProps(context) {
  const supabaseServer = createServerSupabaseClient(context)
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session) return { redirect: { destination: '/login', permanent: false } }

  const isAdmin = session.user.email === 'jstanley@nssapros.com'
  if (!isAdmin) return { redirect: { destination: '/dashboard', permanent: false } }

  const viewEmail  = context.query.email || ''
  const selectedYear = parseInt(context.query.year) || new Date().getFullYear()
  if (!viewEmail) return { redirect: { destination: '/admin/members', permanent: false } }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data: member } = await supabaseAdmin
    .from('members')
    .select('*')
    .eq('email', viewEmail)
    .single()

  const { data: subs } = await supabaseAdmin
    .from('ce_submissions')
    .select('*')
    .eq('email', viewEmail)
    .order('completion_date', { ascending: false })

  // Build year list
  const years = [...new Set((subs || []).map(s => s.year).filter(Boolean))].sort((a, b) => b - a)
  const currentYear = new Date().getFullYear()
  if (!years.includes(currentYear)) years.unshift(currentYear)

  // Calculate CE for selected year
  const yearSubs = (subs || []).filter(s => s.year === selectedYear && s.status === 'approved')
  const nssaHours  = yearSubs.filter(s => s.designation === 'NSSA'  || s.designation === 'both').reduce((sum, s) => sum + Number(s.hours_earned), 0)
  const irmaaHours = yearSubs.filter(s => s.designation === 'IRMAA' || s.designation === 'both').reduce((sum, s) => sum + Number(s.hours_earned), 0)

  const certYear = (d) => d ? new Date(d).getFullYear() : null
  const nssaExempt  = certYear(member?.nssa_cert_date)  === selectedYear
  const irmaaExempt = certYear(member?.irmaa_cert_date) === selectedYear

  const nssaStatus = !member?.nssa_certified ? 'na'
    : nssaExempt  ? 'exempt'
    : nssaHours  >= 4 ? 'met'
    : nssaHours  > 0  ? 'progress'
    : 'unstarted'

  const irmaaStatus = !member?.irmaa_certified ? 'na'
    : irmaaExempt ? 'exempt'
    : irmaaHours >= 4 ? 'met'
    : irmaaHours > 0  ? 'progress'
    : 'unstarted'

  return {
    props: {
      member: member ? JSON.parse(JSON.stringify(member)) : null,
      subs: JSON.parse(JSON.stringify(subs || [])),
      viewEmail,
      selectedYear,
      availableYears: years,
      nssaHours: nssaExempt ? 4 : nssaHours,
      irmaaHours: irmaaExempt ? 4 : irmaaHours,
      nssaStatus,
      irmaaStatus,
    }
  }
}

function StatusBadge({ status, hours }) {
  const map = {
    met:       { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0', label: '✓ Met' },
    exempt:    { bg: '#eff6ff', color: NSSA.medium, border: NSSA.light, label: '✓ Exempt (new cert)' },
    progress:  { bg: '#fef9c3', color: '#854d0e', border: '#fde68a', label: `${hours} / 4 hrs` },
    unstarted: { bg: '#fef2f2', color: '#dc2626', border: '#fecaca', label: '0 / 4 hrs' },
    na:        { bg: GRAY.bg,   color: GRAY.text,  border: GRAY.border, label: 'Not enrolled' },
  }
  const s = map[status] || map.na
  return (
    <span style={{ fontSize: '12px', padding: '3px 10px', borderRadius: '99px', background: s.bg, color: s.color, border: `1px solid ${s.border}`, fontWeight: 500 }}>
      {s.label}
    </span>
  )
}

function DesigBadge({ label, color, border, bg, number }) {
  return (
    <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: bg, color, border: `1px solid ${border}` }}>
      {label}{number ? ` #${number}` : ''}
    </span>
  )
}

export default function MemberView({ member, subs, viewEmail, selectedYear, availableYears, nssaHours, irmaaHours, nssaStatus, irmaaStatus }) {
  const router = useRouter()
  const [yearFilter, setYearFilter] = useState('all')

  if (!member) return (
    <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
      <p style={{ color: GRAY.text }}>Member not found for {viewEmail}</p>
      <Link href="/admin/members" style={{ color: NSSA.medium }}>← Back to members</Link>
    </div>
  )

  const fullName = [member.first_name, member.last_name].filter(Boolean).join(' ') || viewEmail

  const filteredSubs = yearFilter === 'all'
    ? subs
    : subs.filter(s => String(s.year) === yearFilter)

  const td    = { padding: '10px 14px', fontSize: '13px', verticalAlign: 'middle', borderTop: `1px solid ${GRAY.bg}` }
  const label = { fontSize: '11px', fontWeight: 500, color: GRAY.text, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }

  function statusColor(s) {
    if (s === 'approved') return { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' }
    if (s === 'rejected') return { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' }
    return { bg: '#fef9c3', color: '#854d0e', border: '#fde68a' }
  }

  return (
    <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>

      {/* Nav */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.5rem' }}>
        <Link href="/admin/members" style={{ fontSize: '13px', color: NSSA.medium, textDecoration: 'none' }}>← All Members</Link>
        <span style={{ color: GRAY.border }}>|</span>
        <span style={{ fontSize: '13px', color: GRAY.text }}>{fullName}</span>
      </div>

      {/* ── Profile Card ──────────────────────────────────────────────────── */}
      <div style={{ background: 'white', border: `1px solid ${GRAY.border}`, borderRadius: '10px', padding: '1.5rem', marginBottom: '1.5rem', display: 'flex', gap: '1.5rem', alignItems: 'flex-start' }}>

        {/* Photo */}
        <div style={{ flexShrink: 0 }}>
          {member.profile_photo ? (
            <img
              src={member.profile_photo}
              alt={fullName}
              style={{ width: '120px', height: '124px', objectFit: 'cover', objectPosition: 'top', borderRadius: '8px', border: `1px solid ${GRAY.border}` }}
            />
          ) : (
            <div style={{ width: '120px', height: '124px', borderRadius: '8px', background: NSSA.dark, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '36px', fontWeight: 700 }}>
              {member.first_name?.[0] || '?'}
            </div>
          )}
        </div>

        {/* Details */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '6px' }}>
            <div>
              <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#111', marginBottom: '2px' }}>{fullName}</h1>
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
            <span style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '4px', background: member.is_active !== false ? '#f0fdf4' : GRAY.bg, color: member.is_active !== false ? '#15803d' : GRAY.text, border: `1px solid ${member.is_active !== false ? '#bbf7d0' : GRAY.border}` }}>
              {member.is_active !== false ? 'Active' : 'Inactive'}
            </span>
          </div>

          {/* Cert badges */}
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
            {member.nssa_certified && (
              <DesigBadge label="NSSA® Certified" color={NSSA.medium} bg="#eff6ff" border={NSSA.light} number={member.nssa_number} />
            )}
            {member.irmaa_certified && (
              <DesigBadge label="IRMAACP™ Certified" color={IRMAA.dark} bg="#fef2f2" border={IRMAA.light} number={member.irmaa_number} />
            )}
          </div>

          {/* Contact row */}
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '10px' }}>
            <span style={{ fontSize: '12px', color: GRAY.text }}>{viewEmail}</span>
            {member.phone && <span style={{ fontSize: '12px', color: GRAY.text }}>📞 {member.phone}</span>}
            {member.website && (
              <a href={member.website} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: '12px', color: NSSA.medium, textDecoration: 'none' }}>
                🌐 {member.website.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>

          {/* Bio */}
          {member.bio && (
            <p style={{ fontSize: '13px', color: '#374151', lineHeight: 1.6, maxWidth: '700px', marginBottom: member.financial_disclosure ? '8px' : 0 }}>
              {member.bio}
            </p>
          )}

          {/* Financial disclosure */}
          {member.financial_disclosure && (
            <p style={{ fontSize: '11px', color: GRAY.text, fontStyle: 'italic', maxWidth: '700px' }}>
              {member.financial_disclosure}
            </p>
          )}
        </div>
      </div>

      {/* ── CE Requirements ───────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '11px', fontWeight: 600, color: GRAY.text, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          CE Requirements — {selectedYear}
        </h2>
        <select
          value={selectedYear}
          onChange={e => router.push(`/admin/member-view?email=${encodeURIComponent(viewEmail)}&year=${e.target.value}`)}
          style={{ fontSize: '13px', padding: '5px 10px', borderRadius: '6px', border: `1px solid ${GRAY.border}`, background: 'white' }}
        >
          {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.5rem' }}>
        {/* NSSA CE card */}
        {member.nssa_certified && (
          <div style={{ background: 'white', border: `2px solid ${nssaStatus === 'met' || nssaStatus === 'exempt' ? NSSA.medium : nssaStatus === 'unstarted' ? '#fecaca' : '#fde68a'}`, borderRadius: '10px', padding: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
              <span style={{ fontSize: '13px', color: GRAY.text }}>NSSA® CE Requirement</span>
              <StatusBadge status={nssaStatus} hours={nssaHours} />
            </div>
            <p style={{ fontSize: '28px', fontWeight: 700, color: nssaStatus === 'met' || nssaStatus === 'exempt' ? NSSA.dark : nssaStatus === 'unstarted' ? '#dc2626' : '#854d0e', marginBottom: '8px' }}>
              {nssaHours} <span style={{ fontSize: '14px', fontWeight: 400, color: GRAY.text }}>/ 4 hrs</span>
            </p>
            <div style={{ background: GRAY.bg, borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(100, (nssaHours / 4) * 100)}%`, background: nssaStatus === 'met' || nssaStatus === 'exempt' ? NSSA.medium : '#f59e0b', borderRadius: '4px', transition: 'width 0.3s' }} />
            </div>
          </div>
        )}

        {/* IRMAA CE card */}
        {member.irmaa_certified && (
          <div style={{ background: 'white', border: `2px solid ${irmaaStatus === 'met' || irmaaStatus === 'exempt' ? IRMAA.medium : irmaaStatus === 'unstarted' ? '#fecaca' : '#fde68a'}`, borderRadius: '10px', padding: '1.25rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
              <span style={{ fontSize: '13px', color: GRAY.text }}>IRMAACP™ CE Requirement</span>
              <StatusBadge status={irmaaStatus} hours={irmaaHours} />
            </div>
            <p style={{ fontSize: '28px', fontWeight: 700, color: irmaaStatus === 'met' || irmaaStatus === 'exempt' ? IRMAA.dark : irmaaStatus === 'unstarted' ? '#dc2626' : '#854d0e', marginBottom: '8px' }}>
              {irmaaHours} <span style={{ fontSize: '14px', fontWeight: 400, color: GRAY.text }}>/ 4 hrs</span>
            </p>
            <div style={{ background: GRAY.bg, borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${Math.min(100, (irmaaHours / 4) * 100)}%`, background: irmaaStatus === 'met' || irmaaStatus === 'exempt' ? IRMAA.medium : '#f59e0b', borderRadius: '4px', transition: 'width 0.3s' }} />
            </div>
          </div>
        )}
      </div>

      {/* ── CE Submission History ─────────────────────────────────────────── */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '11px', fontWeight: 600, color: GRAY.text, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            CE Submission History
          </h2>
          <select
            value={yearFilter}
            onChange={e => setYearFilter(e.target.value)}
            style={{ fontSize: '13px', padding: '5px 10px', borderRadius: '6px', border: `1px solid ${GRAY.border}`, background: 'white' }}
          >
            <option value="all">All years</option>
            {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <div style={{ background: 'white', border: `1px solid ${GRAY.border}`, borderRadius: '10px', overflow: 'hidden' }}>
          {filteredSubs.length === 0 ? (
            <p style={{ padding: '2.5rem', textAlign: 'center', color: GRAY.text, fontSize: '13px' }}>
              No submissions found.
            </p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#1a1a1a' }}>
                  {['Date', 'Course Title', 'CE Type', 'Hours', 'Designation', 'Source', 'Status'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 500, color: 'white', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredSubs.map((s, i) => {
                  const sc = statusColor(s.status)
                  return (
                    <tr key={s.id} style={{ background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                      <td style={td}>{s.completion_date ? new Date(s.completion_date).toLocaleDateString() : '—'}</td>
                      <td style={{ ...td, maxWidth: '240px' }}>
                        <span style={{ fontWeight: 500 }}>{s.course_title || '—'}</span>
                        {s.ai_flag && <span style={{ marginLeft: '6px', fontSize: '10px', color: '#f59e0b' }}>⚠ AI</span>}
                        {s.notes && <p style={{ fontSize: '11px', color: GRAY.text, marginTop: '2px' }}>{s.notes}</p>}
                      </td>
                      <td style={td}>{s.ce_type || '—'}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{s.hours_earned}</td>
                      <td style={td}>
                        <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: s.designation === 'NSSA' ? '#eff6ff' : s.designation === 'IRMAA' ? '#fef2f2' : '#f5f3ff', color: s.designation === 'NSSA' ? NSSA.medium : s.designation === 'IRMAA' ? IRMAA.dark : '#7c3aed' }}>
                          {s.designation || '—'}
                        </span>
                      </td>
                      <td style={{ ...td, fontSize: '11px', color: GRAY.text, textTransform: 'capitalize' }}>{s.source || '—'}</td>
                      <td style={td}>
                        <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '99px', background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`, fontWeight: 500, textTransform: 'capitalize' }}>
                          {s.status}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Profile data grid */}
        <div style={{ background: 'white', border: `1px solid ${GRAY.border}`, borderRadius: '10px', padding: '1.25rem', marginTop: '1.5rem' }}>
          <h3 style={{ fontSize: '11px', fontWeight: 600, color: GRAY.text, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '1rem' }}>
            Record Details
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            {[
              ['Email',           viewEmail],
              ['NSSA Cert Date',  member.nssa_cert_date  ? new Date(member.nssa_cert_date).toLocaleDateString()  : '—'],
              ['IRMAA Cert Date', member.irmaa_cert_date ? new Date(member.irmaa_cert_date).toLocaleDateString() : '—'],
              ['NSSA Number',     member.nssa_number     || '—'],
              ['IRMAA Number',    member.irmaa_number    || '—'],
              ['Address',         [member.address, member.city, member.state, member.zip].filter(Boolean).join(', ') || '—'],
            ].map(([lbl, val]) => (
              <div key={lbl}>
                <p style={label}>{lbl}</p>
                <p style={{ fontSize: '13px', color: '#111' }}>{val}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
