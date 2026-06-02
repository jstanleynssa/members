import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { useState } from 'react'
import { supabase } from '../lib/supabaseClient'
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

  const currentYear = new Date().getFullYear()

  await supabaseServer
    .from('ce_submissions')
    .update({ status: 'approved' })
    .eq('email', session.user.email)
    .eq('status', 'pending')
    .eq('source', 'manual')
    .lt('submitted_at', new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())

const { data: member } = await supabaseAdmin
  .from('members')
  .select('email, first_name, last_name, nssa_certified, irmaa_certified, nssa_cert_date, irmaa_cert_date, nssa_number, irmaa_number, profile_photo, job_title, company, city, state, phone, website, bio')
  .eq('email', session.user.email)
  .single()

  if (!member || (!member.nssa_certified && !member.irmaa_certified)) {
  await supabaseServer.auth.signOut()
  return { redirect: { destination: '/login?error=not_authorized', permanent: false } }
}

  const { data: allSubmissions } = await supabaseServer
    .from('ce_submissions')
    .select('*')
    .eq('email', session.user.email)
    .order('completion_date', { ascending: false })

  const submissions = allSubmissions || []

  const currentApproved = submissions.filter(s => s.status === 'approved' && s.year === currentYear)
  const nssaHours = currentApproved
    .filter(s => s.designation === 'NSSA' || s.designation === 'both')
    .reduce((sum, s) => sum + Number(s.hours_earned), 0)
  const irmaaHours = currentApproved
    .filter(s => s.designation === 'IRMAA' || s.designation === 'both')
    .reduce((sum, s) => sum + Number(s.hours_earned), 0)

  const certYear = (yr) => yr ? new Date(yr).getFullYear() : null
  const nssaExempt = certYear(member?.nssa_cert_date) === currentYear
  const irmaaExempt = certYear(member?.irmaa_cert_date) === currentYear

  const years = [...new Set(submissions.map(s => s.year))].sort((a, b) => b - a)
  if (!years.includes(currentYear)) years.unshift(currentYear)

  return {
    props: {
      member: member || null,
      submissions,
      nssaHours,
      irmaaHours,
      nssaExempt,
      irmaaExempt,
      currentYear,
      availableYears: years,
      userEmail: session.user.email
    }
  }
}

export default function Dashboard({ member, submissions, nssaHours, irmaaHours, nssaExempt, irmaaExempt, currentYear, availableYears, userEmail }) {
  const days = daysLeftInYear()
  const firstName = member?.first_name || userEmail.split('@')[0]
  const [loggingOut, setLoggingOut] = useState(false)
  const [selectedYear, setSelectedYear] = useState(currentYear)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 5

  async function handleLogout() {
    setLoggingOut(true)
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const nssaMet = nssaExempt || nssaHours >= 4
  const irmaaMet = irmaaExempt || irmaaHours >= 4

  const yearSubmissions = submissions.filter(s => s.year === selectedYear)
  const totalPages = Math.ceil(yearSubmissions.length / PAGE_SIZE)
  const paginated = yearSubmissions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function handleYearChange(year) {
    setSelectedYear(Number(year))
    setPage(1)
  }

  function StatusBadge({ submission }) {
    if (submission.source === 'zoom_auto') return (
      <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#f0fdf4', color: '#15803d' }}>✓ Auto (Zoom)</span>
    )
    if (submission.status === 'approved') return (
      <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#f0fdf4', color: '#15803d' }}>✓ Approved</span>
    )
    if (submission.status === 'pending') return (
      <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#fef9c3', color: '#854d0e', border: '1px solid #fde68a' }}>⏳ Pending</span>
    )
    if (submission.status === 'rejected') return (
      <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#fef2f2', color: '#dc2626' }}>✗ Rejected</span>
    )
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

  const sectionLabel = {
    fontSize: '11px', fontWeight: 600, color: '#6b7280',
    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px'
  }

  const submitBtn = (designation, color) => ({
    display: 'block', textAlign: 'center', padding: '9px 16px',
    background: color, color: 'white', borderRadius: '8px',
    textDecoration: 'none', fontSize: '13px', fontWeight: 600, marginTop: '1rem'
  })

  const enrollBtn = (color) => ({
    display: 'block', textAlign: 'center', padding: '9px 16px',
    background: color, color: 'white', borderRadius: '8px',
    textDecoration: 'none', fontSize: '13px', fontWeight: 600
  })

  return (
    <div style={{ padding: '2rem', maxWidth: '1000px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '2px', color: '#111' }}>Member Dashboard</h1>
          <p style={{ color: '#6b7280', fontSize: '14px' }}>Welcome back, {firstName}</p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '10px' }}>
          <img src="/nssa-irmaa-logos.png" alt="NSSA and IRMAACP logos" style={{ height: '50px', width: 'auto' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '12px', color: '#6b7280' }}>{userEmail}</span>
            <button onClick={handleLogout} disabled={loggingOut} style={{
              fontSize: '12px', padding: '4px 12px', borderRadius: '6px',
              border: '1px solid #d1d5db', background: 'white', color: '#374151',
              cursor: loggingOut ? 'not-allowed' : 'pointer', opacity: loggingOut ? 0.6 : 1
            }}>
              {loggingOut ? 'Signing out...' : 'Sign out'}
            </button>
          </div>
        </div>
      </div>

      {/* CE Requirements */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <p style={sectionLabel}>CE Requirements — {currentYear}</p>
          <span style={{
            fontSize: '12px', padding: '3px 12px', borderRadius: '99px',
            background: days <= 60 ? '#fef2f2' : '#f0fdf4',
            color: days <= 60 ? '#dc2626' : '#15803d',
            border: `1px solid ${days <= 60 ? '#fecaca' : '#bbf7d0'}`,
            fontWeight: 500
          }}>
            {days} days remaining in {currentYear}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

          {/* NSSA card */}
          {member?.nssa_certified ? (
            <div style={{ background: 'white', borderRadius: '10px', padding: '1.5rem', border: '1px solid #e5e7eb', borderTop: `4px solid ${NSSA.medium}`, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <div>
                  <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '2px' }}>NSSA® CE Requirement</p>
                  <p style={{ fontSize: '28px', fontWeight: 700, color: NSSA.dark }}>
                    {nssaExempt ? '4' : nssaHours}
                    <span style={{ fontSize: '16px', fontWeight: 400, color: '#9ca3af' }}> / 4 hrs</span>
                  </p>
                </div>
                <span style={{
                  fontSize: '12px', padding: '3px 10px', borderRadius: '99px', fontWeight: 500,
                  background: nssaMet ? '#f0fdf4' : '#fef9c3',
                  color: nssaMet ? '#15803d' : '#854d0e',
                  border: `1px solid ${nssaMet ? '#bbf7d0' : '#fde68a'}`
                }}>
                  {nssaMet ? '✓ Requirement met' : 'In progress'}
                </span>
              </div>
              <div style={{ flexGrow: 1 }}>
                {nssaExempt ? (
                  <p style={{ fontSize: '12px', color: '#6b7280', background: '#f0fdf4', padding: '8px 12px', borderRadius: '6px', border: '1px solid #bbf7d0' }}>
                    ✓ CE requirement waived for {currentYear} — you earned your NSSA® designation this year.
                  </p>
                ) : (
                  <CEProgressBar completed={nssaHours} required={4} color={NSSA.medium} />
                )}
              </div>
              <Link href="/ce/submit?designation=NSSA" style={submitBtn('NSSA', NSSA.dark)}>
                + Submit NSSA® CE
              </Link>
            </div>
          ) : (
            <div style={{ background: 'white', borderRadius: '10px', padding: '1.5rem', border: '1px solid #e5e7eb', borderTop: `4px solid ${NSSA.light}`, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <p style={{ fontSize: '13px', fontWeight: 600, color: NSSA.dark, marginBottom: '6px' }}>NSSA® Social Security</p>
                <p style={{ fontSize: '13px', color: '#6b7280', lineHeight: '1.5', marginBottom: '1.25rem' }}>
                  Earn your NSSA® certification and become a trusted expert in Social Security planning. As an IRMAACP™ holder, you qualify for a 50% member discount.
                </p>
              </div>
              <a href="https://www.nssapros.com/offers/vwMC6viE/checkout" target="_blank" rel="noopener noreferrer" style={enrollBtn(NSSA.dark)}>
                Enroll in NSSA® — 50% Off →
              </a>
            </div>
          )}

          {/* IRMAA card */}
          {member?.irmaa_certified ? (
            <div style={{ background: 'white', borderRadius: '10px', padding: '1.5rem', border: '1px solid #e5e7eb', borderTop: `4px solid ${IRMAA.medium}`, display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <div>
                  <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '2px' }}>IRMAACP™ CE Requirement</p>
                  <p style={{ fontSize: '28px', fontWeight: 700, color: IRMAA.dark }}>
                    {irmaaExempt ? '4' : irmaaHours}
                    <span style={{ fontSize: '16px', fontWeight: 400, color: '#9ca3af' }}> / 4 hrs</span>
                  </p>
                </div>
                <span style={{
                  fontSize: '12px', padding: '3px 10px', borderRadius: '99px', fontWeight: 500,
                  background: irmaaMet ? '#f0fdf4' : '#fef9c3',
                  color: irmaaMet ? '#15803d' : '#854d0e',
                  border: `1px solid ${irmaaMet ? '#bbf7d0' : '#fde68a'}`
                }}>
                  {irmaaMet ? '✓ Requirement met' : 'In progress'}
                </span>
              </div>
              <div style={{ flexGrow: 1 }}>
                {irmaaExempt ? (
                  <p style={{ fontSize: '12px', color: '#6b7280', background: '#f0fdf4', padding: '8px 12px', borderRadius: '6px', border: '1px solid #bbf7d0' }}>
                    ✓ CE requirement waived for {currentYear} — you earned your IRMAACP™ designation this year.
                  </p>
                ) : (
                  <CEProgressBar completed={irmaaHours} required={4} color={IRMAA.medium} />
                )}
              </div>
              <Link href="/ce/submit?designation=IRMAA" style={submitBtn('IRMAA', IRMAA.dark)}>
                + Submit IRMAACP™ CE
              </Link>
            </div>
          ) : (
            <div style={{ background: 'white', borderRadius: '10px', padding: '1.5rem', border: '1px solid #e5e7eb', borderTop: `4px solid ${IRMAA.light}`, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <p style={{ fontSize: '13px', fontWeight: 600, color: IRMAA.dark, marginBottom: '6px' }}>IRMAACP™ Medicare & IRMAA</p>
                <p style={{ fontSize: '13px', color: '#6b7280', lineHeight: '1.5', marginBottom: '1.25rem' }}>
                  Add the IRMAACP™ designation and expand your expertise into Medicare and IRMAA planning. As an NSSA® holder, you qualify for a 50% member discount.
                </p>
              </div>
              <a href="https://www.nssapros.com/offers/mKoPXoDn/checkout" target="_blank" rel="noopener noreferrer" style={enrollBtn(IRMAA.dark)}>
                Enroll in IRMAACP™ — 50% Off →
              </a>
            </div>
          )}
        </div>
      </div>

      {/* CE Submission History */}
      <div style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <p style={sectionLabel}>CE Submission History</p>
          {availableYears.length > 1 && (
            <select
              value={selectedYear}
              onChange={e => handleYearChange(e.target.value)}
              style={{ fontSize: '13px', padding: '5px 10px', borderRadius: '6px', border: '1px solid #d1d5db', background: 'white' }}
            >
              {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          )}
        </div>

        <div style={{ background: 'white', borderRadius: '10px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
          <div style={{ padding: '0.875rem 1.5rem', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f9fafb' }}>
            <span style={{ fontSize: '13px', fontWeight: 500, color: '#374151' }}>{selectedYear} Submissions</span>
            <span style={{ fontSize: '12px', color: '#9ca3af' }}>
              {selectedYear === currentYear ? 'Pending submissions reviewed within 48 hours' : `Historical record — ${selectedYear}`}
            </span>
          </div>

          {yearSubmissions.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>
              No CE submissions for {selectedYear}.
            </div>
          ) : (
            <>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Date', 'Course Title', 'CE Type', 'Hours', 'Designation', 'Status', ''].map(h => (
                      <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: '12px', fontWeight: 500, color: '#6b7280', borderBottom: '1px solid #f3f4f6', background: '#f9fafb' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {paginated.map((s, i) => (
                    <tr key={s.id} style={{ borderTop: i > 0 ? '1px solid #f3f4f6' : 'none', opacity: s.status === 'rejected' ? 0.6 : 1 }}>
                      <td style={{ padding: '12px 16px', fontSize: '13px', whiteSpace: 'nowrap' }}>
                        {new Date(s.completion_date).toLocaleDateString()}
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: '13px', fontWeight: 500 }}>{s.course_title}</td>
                      <td style={{ padding: '12px 16px', fontSize: '13px', color: '#6b7280' }}>{s.ce_type}</td>
                      <td style={{ padding: '12px 16px', fontSize: '13px' }}>{s.hours_earned}</td>
                      <td style={{ padding: '12px 16px', fontSize: '13px' }}>
                        <DesignationBadge designation={s.designation} />
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: '13px' }}>
                        <StatusBadge submission={s} />
                      </td>
                      <td style={{ padding: '12px 16px', fontSize: '13px' }}>
                        {/* Edit only available for pending submissions */}
                        {s.status === 'pending' && s.source !== 'zoom_auto' && (
                          <Link href={`/ce/edit/${s.id}`} style={{ fontSize: '12px', color: NSSA.medium, textDecoration: 'none' }}>
                            Edit
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              {totalPages > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderTop: '1px solid #f3f4f6', background: '#fafafa' }}>
                  <span style={{ fontSize: '12px', color: '#6b7280' }}>
                    {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, yearSubmissions.length)} of {yearSubmissions.length} submissions
                  </span>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                      style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '6px', border: '1px solid #d1d5db', background: 'white', cursor: page === 1 ? 'not-allowed' : 'pointer', opacity: page === 1 ? 0.5 : 1 }}>
                      Previous
                    </button>
                    <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                      style={{ fontSize: '12px', padding: '4px 10px', borderRadius: '6px', border: '1px solid #d1d5db', background: 'white', cursor: page === totalPages ? 'not-allowed' : 'pointer', opacity: page === totalPages ? 0.5 : 1 }}>
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

     {/* MEMBER PROFILE */}
<div style={{ marginTop: '2rem' }}>
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
          <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#fef2f2', color: '#AF2A35', border: '1px solid #ED8E8E' }}>
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
          Your profile is incomplete — <Link href="/profile/edit" style={{ color: NSSA.medium, textDecoration: 'none' }}>add your details</Link> to appear in the advisor directory.
        </p>
      )}
    </div>
  </div>
</div>

    </div>
  )
}
