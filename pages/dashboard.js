import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { useRouter } from 'next/router'
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

  // Get member profile
  const { data: member } = await supabaseServer
    .from('members')
    .select('*')
    .eq('email', session.user.email)
    .single()

  // Get CE submissions for current year
  const { data: submissions } = await supabaseServer
    .from('ce_submissions')
    .select('*')
    .eq('email', session.user.email)
    .eq('year', currentYear)
    .eq('status', 'approved')
    .order('completion_date', { ascending: false })

  const nssaHours = (submissions || []).filter(s => s.designation === 'NSSA' || s.designation === 'both')
    .reduce((sum, s) => sum + Number(s.hours_earned), 0)
  const irmaaHours = (submissions || []).filter(s => s.designation === 'IRMAA' || s.designation === 'both')
    .reduce((sum, s) => sum + Number(s.hours_earned), 0)

  // Check designation year exemption
  const certYear = (yr) => yr ? new Date(yr).getFullYear() : null
  const nssaCertYear = certYear(member?.nssa_cert_date)
  const irmaaCertYear = certYear(member?.irmaa_cert_date)
  const nssaExempt = nssaCertYear === currentYear
  const irmaaExempt = irmaaCertYear === currentYear

  return {
    props: {
      member: member || null,
      submissions: submissions || [],
      nssaHours,
      irmaaHours,
      nssaExempt,
      irmaaExempt,
      currentYear,
      userEmail: session.user.email
    }
  }
}

export default function Dashboard({ member, submissions, nssaHours, irmaaHours, nssaExempt, irmaaExempt, currentYear, userEmail }) {
  const router = useRouter()
  const days = daysLeftInYear()
  const firstName = member?.first_name || userEmail.split('@')[0]

  async function handleLogout() {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  const nssaRequired = member?.nssa_certified ? 4 : 0
  const irmaaRequired = member?.irmaa_certified ? 4 : 0
  const nssaMet = nssaExempt || nssaHours >= nssaRequired
  const irmaaMet = irmaaExempt || irmaaHours >= irmaaRequired

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ background: NSSA.dark, color: 'white', padding: '0 2rem' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '60px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontWeight: 700, fontSize: '15px', letterSpacing: '0.05em' }}>NSSA Member Portal</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <span style={{ fontSize: '13px', color: 'rgba(255,255,255,0.75)' }}>{userEmail}</span>
            <button onClick={handleLogout} style={{ fontSize: '12px', padding: '4px 12px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.3)', background: 'transparent', color: 'white', cursor: 'pointer' }}>
              Sign out
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem' }}>
        {/* Welcome */}
        <div style={{ marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, marginBottom: '4px' }}>Welcome back, {firstName}</h1>
          <p style={{ color: '#6b7280', fontSize: '14px' }}>{currentYear} CE Requirement — {days} days remaining in the year</p>
        </div>

        {/* CE Status Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: member?.nssa_certified && member?.irmaa_certified ? '1fr 1fr' : '1fr', gap: '16px', marginBottom: '2rem' }}>
          {member?.nssa_certified && (
            <div style={{ background: 'white', borderRadius: '10px', padding: '1.5rem', border: '1px solid #e5e7eb', borderTop: `4px solid ${NSSA.medium}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <div>
                  <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '2px' }}>NSSA® CE Requirement</p>
                  <p style={{ fontSize: '22px', fontWeight: 700, color: NSSA.dark }}>{nssaExempt ? '4 / 4' : `${nssaHours} / 4`}</p>
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
              {nssaExempt ? (
                <p style={{ fontSize: '12px', color: '#6b7280', background: '#f0fdf4', padding: '8px 12px', borderRadius: '6px', border: '1px solid #bbf7d0' }}>
                  ✓ CE requirement waived for {currentYear} — you earned your NSSA® designation this year.
                </p>
              ) : (
                <CEProgressBar completed={nssaHours} required={4} color={NSSA.medium} />
              )}
            </div>
          )}

          {member?.irmaa_certified && (
            <div style={{ background: 'white', borderRadius: '10px', padding: '1.5rem', border: '1px solid #e5e7eb', borderTop: `4px solid ${IRMAA.medium}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <div>
                  <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '2px' }}>IRMAACP™ CE Requirement</p>
                  <p style={{ fontSize: '22px', fontWeight: 700, color: IRMAA.dark }}>{irmaaExempt ? '4 / 4' : `${irmaaHours} / 4`}</p>
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
              {irmaaExempt ? (
                <p style={{ fontSize: '12px', color: '#6b7280', background: '#f0fdf4', padding: '8px 12px', borderRadius: '6px', border: '1px solid #bbf7d0' }}>
                  ✓ CE requirement waived for {currentYear} — you earned your IRMAACP™ designation this year.
                </p>
              ) : (
                <CEProgressBar completed={irmaaHours} required={4} color={IRMAA.medium} />
              )}
            </div>
          )}
        </div>

        {/* Submit CE button */}
        <div style={{ marginBottom: '2rem' }}>
   <Link href="/ce/submit" style={{
  display: 'inline-block', padding: '10px 24px', background: NSSA.dark,
  color: 'white', borderRadius: '8px', textDecoration: 'none', fontWeight: 500, fontSize: '14px'
}}>
  + Submit CE Activity
</Link>
        </div>

        {/* Submission history */}
        <div style={{ background: 'white', borderRadius: '10px', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
          <div style={{ padding: '1rem 1.5rem', borderBottom: '1px solid #f3f4f6' }}>
            <h2 style={{ fontSize: '14px', fontWeight: 600, color: '#374151' }}>{currentYear} CE Submissions</h2>
          </div>
          {submissions.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: '#9ca3af', fontSize: '13px' }}>
              No CE submissions yet for {currentYear}.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f9fafb' }}>
                  {['Date', 'Course Title', 'CE Type', 'Hours', 'Designation', 'Status'].map(h => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: '12px', fontWeight: 500, color: '#6b7280' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {submissions.map((s, i) => (
                  <tr key={s.id} style={{ borderTop: i > 0 ? '1px solid #f3f4f6' : 'none' }}>
                    <td style={{ padding: '12px 16px', fontSize: '13px' }}>{new Date(s.completion_date).toLocaleDateString()}</td>
                    <td style={{ padding: '12px 16px', fontSize: '13px', fontWeight: 500 }}>{s.course_title}</td>
                    <td style={{ padding: '12px 16px', fontSize: '13px', color: '#6b7280' }}>{s.ce_type}</td>
                    <td style={{ padding: '12px 16px', fontSize: '13px' }}>{s.hours_earned}</td>
                    <td style={{ padding: '12px 16px', fontSize: '13px' }}>
                      <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: s.designation === 'NSSA' ? '#eff6ff' : s.designation === 'IRMAA' ? '#fef2f2' : '#f0fdf4', color: s.designation === 'NSSA' ? NSSA.medium : s.designation === 'IRMAA' ? IRMAA.medium : '#15803d' }}>
                        {s.designation === 'both' ? 'NSSA + IRMAA' : s.designation}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '13px' }}>
                      <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: s.source === 'zoom_auto' ? '#f0fdf4' : '#f9fafb', color: s.source === 'zoom_auto' ? '#15803d' : '#374151' }}>
                        {s.source === 'zoom_auto' ? '✓ Auto (Zoom)' : '✓ Approved'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
