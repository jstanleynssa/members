import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { useState } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'

const NSSA  = { dark: '#13405E', medium: '#1C80BC', light: '#8ECAEE' }
const IRMAA = { dark: '#AF2A35', medium: '#DE5B63', light: '#ED8E8E' }
const GRAY  = { text: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' }

// Soft tint backgrounds derived from the palette (for pill/badge fills).
const NSSA_BG  = '#eef6fc'  // light tint of NSSA blue
const IRMAA_BG = '#fceeef'  // light tint of IRMAA red

// Success states use the NSSA medium family; destructive/error states use IRMAA.
const SUCCESS = { bg: NSSA_BG,  text: NSSA.medium,  border: NSSA.light }
const ALERT   = { bg: IRMAA_BG, text: IRMAA.medium, border: IRMAA.light }

// Strip HTML tags so legacy bios stored with <p>...</p> don't render as
// literal text in the plain-text textarea / display. Collapses block tags
// to newlines, removes the rest, and decodes a few common entities.
function stripHtml(str) {
  if (!str) return ''
  return str
    .replace(/<\/(p|div|br)\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

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
    .select('email, first_name, last_name, nssa_certified, irmaa_certified, nssa_cert_date, irmaa_cert_date, nssa_number, irmaa_number, profile_photo, job_title, company, address, city, state, zip, phone, mobile_phone, website, linkedin_url, bio, financial_disclosure, is_active')
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

function StatusPill({ status, accent, accentBg, accentLight }) {
  const map = {
    met:       { bg: accentBg, color: accent,    border: accentLight, label: '✓ Requirement Met' },
    exempt:    { bg: accentBg, color: accent,    border: accentLight, label: '✓ Exempt — new cert' },
    progress:  { bg: accentBg, color: accent,    border: accentLight, label: 'In progress' },
    unstarted: { bg: GRAY.bg,  color: GRAY.text, border: GRAY.border, label: 'Not started' },
    na:        { bg: GRAY.bg,  color: GRAY.text, border: GRAY.border, label: 'Not enrolled' },
  }
  const s = map[status] || map.na
  return (
    <span style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '99px', background: s.bg, color: s.color, border: `1px solid ${s.border}`, fontWeight: 500 }}>
      {s.label}
    </span>
  )
}


export default function Dashboard({ member, subs, selectedYear, availableYears, currentYear, nssaHours, irmaaHours, nssaStatus, irmaaStatus, daysLeft, userEmail }) {
  const router = useRouter()
  const [yearFilter, setYearFilter] = useState(selectedYear)

  const filteredSubs = subs.filter(s => s.year === yearFilter)
  const isAdmin = userEmail === 'jstanley@nssapros.com'

  // ── Profile summary (read-only) ─────────────────────────────────────────
  // Editing happens at /profile (the canonical editor). The dashboard only
  // displays a summary, so we just derive what we need to show.
  const currentPhoto = member.profile_photo || null
  const bioText = stripHtml(member.bio)
  // A member "has a profile" once they've added a bio (the directory inclusion
  // signal). Anyone without one sees the "build your profile" prompt instead.
  const hasProfile = !!(bioText && bioText.trim())

  function statusColor(s) {
    if (s === 'approved') return { bg: NSSA_BG, color: NSSA.medium, border: NSSA.light }
    if (s === 'rejected') return { bg: IRMAA_BG, color: IRMAA.medium, border: IRMAA.light }
    return { bg: GRAY.bg, color: GRAY.text, border: GRAY.border }
  }

  const td = { padding: '10px 14px', fontSize: '13px', verticalAlign: 'middle', borderTop: `1px solid ${GRAY.bg}` }

  const btn = (color, disabled) => ({
    padding: '9px 20px', fontSize: '13px', fontWeight: 600,
    background: disabled ? GRAY.bg : color,
    color: disabled ? GRAY.text : 'white',
    border: 'none', borderRadius: '6px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.7 : 1
  })

  const twoCol = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', fontFamily: 'system-ui, sans-serif' }}>

      <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '2rem' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
          <div>
            <h1 style={{ fontSize: '1.5rem', fontWeight: 600, color: '#111', marginBottom: '4px' }}>Member Management</h1>
            <p style={{ color: '#666', fontSize: '14px' }}>
              {(member.first_name && member.last_name)
                ? `${member.first_name} ${member.last_name}`
                : (member.first_name || userEmail)}
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' }}>
            <img src="/nssa-irmaa-logos.png" alt="NSSA and IRMAACP logos" style={{ height: '50px', width: 'auto' }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
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
        </div>

        {/* CE Requirements Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '11px', fontWeight: 600, color: GRAY.text, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            CE Requirements — {selectedYear}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {daysLeft > 0 && daysLeft < 365 && (
              <span style={{ fontSize: '12px', color: daysLeft < 60 ? IRMAA.medium : GRAY.text, background: daysLeft < 60 ? IRMAA_BG : GRAY.bg, padding: '3px 10px', borderRadius: '99px', border: `1px solid ${daysLeft < 60 ? IRMAA.light : GRAY.border}` }}>
                {daysLeft} days remaining in {selectedYear}
              </span>
            )}
          </div>
        </div>

        {/* CE Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>

          {/* NSSA CE Card */}
          {member.nssa_certified && (
            <div style={{ background: 'white', border: `2px solid ${nssaStatus === 'unstarted' ? GRAY.border : NSSA.medium}`, borderRadius: '10px', padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <span style={{ fontSize: '13px', color: GRAY.text }}>NSSA® CE Requirement</span>
                <StatusPill status={nssaStatus} accent={NSSA.medium} accentBg={NSSA_BG} accentLight={NSSA.light} />
              </div>
              <p style={{ fontSize: '32px', fontWeight: 700, color: nssaStatus === 'unstarted' ? GRAY.text : NSSA.dark, marginBottom: '6px' }}>
                {nssaHours} <span style={{ fontSize: '14px', fontWeight: 400, color: GRAY.text }}>/ 4 hrs</span>
              </p>
              <p style={{ fontSize: '12px', color: GRAY.text, marginBottom: '12px' }}>
                {nssaHours} of 4 hours completed &nbsp; {Math.round((nssaHours / 4) * 100)}%
              </p>
              <div style={{ background: GRAY.bg, borderRadius: '4px', height: '6px', overflow: 'hidden', marginBottom: '1rem' }}>
                <div style={{ height: '100%', width: `${Math.min(100, (nssaHours / 4) * 100)}%`, background: NSSA.medium, borderRadius: '4px' }} />
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
            <div style={{ background: 'white', border: `2px solid ${irmaaStatus === 'unstarted' ? GRAY.border : IRMAA.medium}`, borderRadius: '10px', padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <span style={{ fontSize: '13px', color: GRAY.text }}>IRMAACP™ CE Requirement</span>
                <StatusPill status={irmaaStatus} accent={IRMAA.medium} accentBg={IRMAA_BG} accentLight={IRMAA.light} />
              </div>
              <p style={{ fontSize: '32px', fontWeight: 700, color: irmaaStatus === 'unstarted' ? GRAY.text : IRMAA.dark, marginBottom: '6px' }}>
                {irmaaHours} <span style={{ fontSize: '14px', fontWeight: 400, color: GRAY.text }}>/ 4 hrs</span>
              </p>
              <p style={{ fontSize: '12px', color: GRAY.text, marginBottom: '12px' }}>
                {irmaaHours} of 4 hours completed &nbsp; {Math.round((irmaaHours / 4) * 100)}%
              </p>
              <div style={{ background: GRAY.bg, borderRadius: '4px', height: '6px', overflow: 'hidden', marginBottom: '1rem' }}>
                <div style={{ height: '100%', width: `${Math.min(100, (irmaaHours / 4) * 100)}%`, background: IRMAA.medium, borderRadius: '4px' }} />
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
                        <td style={td}>{s.completion_date ? new Date(s.completion_date + 'T12:00:00').toLocaleDateString() : '—'}</td>
                        <td style={{ ...td, fontWeight: 500, maxWidth: '220px' }}>{s.course_title || '—'}</td>
                        <td style={td}>{s.ce_type || '—'}</td>
                        <td style={{ ...td, fontWeight: 600 }}>{s.hours_earned}</td>
                        <td style={td}>
                          <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: s.designation === 'IRMAA' ? IRMAA_BG : NSSA_BG, color: s.designation === 'IRMAA' ? IRMAA.medium : NSSA.medium }}>
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

        {/* ── Member Profile (read-only summary) ───────────────────────────
            Editing lives in the canonical profile editor at /profile (the
            build-out wizard + Simple Edit, with the upgraded photo flow and
            likeness-safety check). The dashboard shows a summary only, with a
            single CTA to that editor — so there is ONE place to edit a profile
            and no risk of two forms drifting apart. */}
        <div id="profile" style={{ scrollMarginTop: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '11px', fontWeight: 600, color: GRAY.text, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Member Profile
            </h2>

            {/* Cert badges (read-only) — certification number shown prominently */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {member.nssa_certified && (
                <span style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '4px', background: NSSA_BG, color: NSSA.medium, border: `1px solid ${NSSA.light}` }}>
                  NSSA® Certified{member.nssa_number ? <> · <strong style={{ fontWeight: 700 }}>#{member.nssa_number}</strong></> : ''}
                </span>
              )}
              {member.irmaa_certified && (
                <span style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '4px', background: IRMAA_BG, color: IRMAA.medium, border: `1px solid ${IRMAA.light}` }}>
                  IRMAACP™ Certified{member.irmaa_number ? <> · <strong style={{ fontWeight: 700 }}>#{member.irmaa_number}</strong></> : ''}
                </span>
              )}
            </div>
          </div>

          <div style={{ background: 'white', borderRadius: '10px', border: `1px solid ${GRAY.border}`, padding: '1.5rem' }}>
            {hasProfile ? (
              <>
                {/* Summary: photo + key details */}
                <div style={{ display: 'grid', gridTemplateColumns: currentPhoto ? '120px 1fr' : '1fr', gap: '1.5rem', alignItems: 'start' }}>
                  {currentPhoto && (
                    <img
                      src={currentPhoto}
                      alt="Your profile photo"
                      style={{ width: '120px', height: '124px', objectFit: 'cover', objectPosition: 'top', borderRadius: '8px', border: `1px solid ${GRAY.border}` }}
                    />
                  )}
                  <div style={{ fontSize: '14px', color: '#374151', lineHeight: 1.8 }}>
                    <div style={{ fontSize: '17px', fontWeight: 700, color: '#111', marginBottom: '2px' }}>
                      {[member.first_name, member.last_name].filter(Boolean).join(' ') || '—'}
                    </div>
                    {(member.job_title || member.company) && (
                      <div style={{ color: GRAY.text }}>{[member.job_title, member.company].filter(Boolean).join(', ')}</div>
                    )}
                    {(member.city || member.state) && (
                      <div style={{ color: GRAY.text }}>{[member.city, member.state].filter(Boolean).join(', ')}{member.zip ? ` ${member.zip}` : ''}</div>
                    )}
                    {(member.phone || member.mobile_phone) && <div style={{ color: GRAY.text }}>{member.phone || member.mobile_phone}</div>}
                    {member.website && <div style={{ color: NSSA.medium }}>{member.website.replace(/^https?:\/\//, '')}</div>}

                    {/* Completeness nudges */}
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
                      {!currentPhoto && (
                        <span style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '99px', background: IRMAA_BG, color: IRMAA.medium, border: `1px solid ${IRMAA.light}` }}>
                          Add a headshot — profiles with photos get noticeably more inquiries
                        </span>
                      )}
                      {!bioText && (
                        <span style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '99px', background: IRMAA_BG, color: IRMAA.medium, border: `1px solid ${IRMAA.light}` }}>
                          Add a bio to complete your listing
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Bio preview */}
                {bioText && (
                  <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: `1px solid ${GRAY.bg}` }}>
                    <p style={{ fontSize: '11px', fontWeight: 600, color: GRAY.text, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Bio</p>
                    <p style={{ fontSize: '13px', color: '#374151', lineHeight: 1.7, margin: 0, display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {bioText}
                    </p>
                  </div>
                )}

                {/* Financial disclosure preview — shown as it appears at the
                    bottom of the public profile. Fine-print styling to match. */}
                {(member.financial_disclosure || '').trim() && (
                  <div style={{ marginTop: '1.25rem', paddingTop: '1.25rem', borderTop: `1px solid ${GRAY.bg}` }}>
                    <p style={{ fontSize: '11px', fontWeight: 600, color: GRAY.text, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Financial Disclosure</p>
                    <p style={{ fontSize: '12px', color: GRAY.text, lineHeight: 1.6, margin: 0, whiteSpace: 'pre-wrap' }}>
                      {member.financial_disclosure.trim()}
                    </p>
                  </div>
                )}

                {/* Edit CTA */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: `1px solid ${GRAY.bg}` }}>
                  <Link href="/profile" style={{ ...btn(NSSA.dark, false), textDecoration: 'none', display: 'inline-block' }}>
                    Edit Your Profile
                  </Link>
                  <span style={{ fontSize: '12px', color: GRAY.text }}>Update your photo, bio, or contact details — changes appear on the directory automatically.</span>
                </div>
              </>
            ) : (
              /* No profile yet — encourage them into the build-out wizard */
              <div style={{ textAlign: 'center', padding: '1.5rem 1rem' }}>
                <p style={{ fontSize: '15px', fontWeight: 600, color: '#111', marginBottom: '6px' }}>You don't have a directory profile yet</p>
                <p style={{ fontSize: '13px', color: GRAY.text, maxWidth: '440px', margin: '0 auto 1.25rem', lineHeight: 1.6 }}>
                  Your profile is how clients searching the NSSA® Advisor Directory find and contact you. It takes just a few minutes to build.
                </p>
                <Link href="/profile" style={{ ...btn(NSSA.dark, false), textDecoration: 'none', display: 'inline-block' }}>
                  Build Your Profile
                </Link>
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
