import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { useState } from 'react'
import Link from 'next/link'

const NSSA = { dark: '#13405E', medium: '#1C80BC' }

export async function getServerSideProps(context) {
  const supabaseServer = createServerSupabaseClient(context)
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session) return { redirect: { destination: '/login', permanent: false } }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data: profile } = await supabaseAdmin
    .from('user_profiles')
    .select('is_admin')
    .eq('id', session.user.id)
    .single()

  const isAdmin = profile?.is_admin === true || session.user.email === 'jstanley@nssapros.com'
  if (!isAdmin) return { redirect: { destination: '/dashboard', permanent: false } }

  const { data: members } = await supabaseAdmin
    .from('members')
    .select('email, first_name, last_name, nssa_certified, irmaa_certified')
    .or('nssa_certified.eq.true,irmaa_certified.eq.true')
    .order('last_name')

  return { props: { members: members || [] } }
}

export default function ZoomTest({ members }) {
  const today = new Date().toISOString().split('T')[0]
  const [form, setForm] = useState({
    email: members[0]?.email || '',
    durationSeconds: '3600',
    meetingDate: today
  })
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setResult(null)
    setError(null)

    const res = await fetch('/api/zoom-webhook-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: form.email,
        durationSeconds: Number(form.durationSeconds),
        meetingDate: form.meetingDate
      })
    })

    const data = await res.json()
    setLoading(false)
    if (!res.ok) setError(data.error)
    else setResult(data)
  }

  async function handleDelete() {
    if (!result?.submissionId) return
    if (!confirm('Delete this test CE submission?')) return
    await fetch('/api/zoom-webhook-test', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ submissionId: result.submissionId })
    })
    setResult(null)
    alert('Test submission deleted.')
  }

  const inputStyle = {
    width: '100%', padding: '10px 12px', fontSize: '14px',
    border: '1px solid #d1d5db', borderRadius: '6px', outline: 'none', boxSizing: 'border-box'
  }
  const labelStyle = { display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: '#374151' }
  const selectedMember = members.find(m => m.email === form.email)
  const qualifies = Number(form.durationSeconds) >= 2400
  const mins = Math.round(Number(form.durationSeconds) / 60)

  return (
    <div style={{ padding: '2rem', maxWidth: '700px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid #e5e7eb' }}>
        <Link href="/dashboard" style={{ fontSize: '13px', color: NSSA.medium, textDecoration: 'none', fontWeight: 500 }}>← Back to Dashboard</Link>
        <img src="/nssa-irmaa-logos.png" alt="NSSA logos" style={{ height: '40px', width: 'auto' }} />
      </div>

      <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '4px' }}>Zoom Webhook Test</h1>
      <p style={{ color: '#6b7280', fontSize: '13px', marginBottom: '2rem' }}>
        Simulate a member attending the monthly Zoom meeting. Tests the full CE automation logic including designation waterfall and deduplication.
      </p>

      <div style={{ background: 'white', borderRadius: '10px', padding: '2rem', border: '1px solid #e5e7eb', marginBottom: '1.5rem' }}>
        <form onSubmit={handleSubmit}>

          <div style={{ marginBottom: '1.25rem' }}>
            <label style={labelStyle}>Member *</label>
            <select name="email" value={form.email} onChange={handleChange} required style={{ ...inputStyle, background: 'white' }}>
              {members.map(m => (
                <option key={m.email} value={m.email}>
                  {m.first_name} {m.last_name} ({m.email}) — {m.nssa_certified && m.irmaa_certified ? 'NSSA + IRMAA' : m.nssa_certified ? 'NSSA' : 'IRMAA'}
                </option>
              ))}
            </select>
            {selectedMember && (
              <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '4px' }}>
                Certifications: {[selectedMember.nssa_certified && 'NSSA®', selectedMember.irmaa_certified && 'IRMAACP™'].filter(Boolean).join(' + ')}
              </p>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
            <div>
              <label style={labelStyle}>Meeting Date *</label>
              <input name="meetingDate" type="date" value={form.meetingDate} onChange={handleChange} required style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Attendance Duration *</label>
              <select name="durationSeconds" value={form.durationSeconds} onChange={handleChange} style={{ ...inputStyle, background: 'white' }}>
                <option value="900">15 minutes (fails — under 40 min)</option>
                <option value="2400">40 minutes (just qualifies)</option>
                <option value="3600">60 minutes (full hour)</option>
                <option value="5400">90 minutes</option>
              </select>
              <p style={{ fontSize: '12px', marginTop: '4px', color: qualifies ? '#15803d' : '#dc2626', fontWeight: 500 }}>
                {mins} min — {qualifies ? '✓ Qualifies for CE credit' : '✗ Does not qualify (need 40+ min)'}
              </p>
            </div>
          </div>

          <div style={{ background: '#f9fafb', borderRadius: '6px', padding: '10px 14px', fontSize: '12px', color: '#6b7280', marginBottom: '1.25rem' }}>
            💡 Tip: Submit twice with the same date to test deduplication — the second submission will accumulate duration on the same record.
          </div>

          <button type="submit" disabled={loading || members.length === 0} style={{
            width: '100%', padding: '12px',
            background: loading ? '#93c5fd' : NSSA.dark,
            color: 'white', border: 'none', borderRadius: '8px',
            fontSize: '14px', fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer'
          }}>
            {loading ? 'Simulating…' : 'Simulate Zoom Attendance'}
          </button>
        </form>
      </div>

      {error && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '1rem', marginBottom: '1rem' }}>
          <p style={{ color: '#dc2626', fontSize: '13px', fontWeight: 600, marginBottom: '2px' }}>Error</p>
          <p style={{ color: '#dc2626', fontSize: '13px' }}>{error}</p>
        </div>
      )}

      {result && (
        <div style={{ background: result.qualifies ? '#f0fdf4' : '#fef9c3', border: `1px solid ${result.qualifies ? '#bbf7d0' : '#fde68a'}`, borderRadius: '8px', padding: '1.25rem' }}>
          <p style={{ fontSize: '14px', fontWeight: 600, marginBottom: '1rem', color: result.qualifies ? '#15803d' : '#854d0e' }}>
            {result.action === 'created' ? '✓ CE record created' : '✓ CE record updated'} — {result.qualifies ? 'Approved' : 'Pending (under 40 min)'}
          </p>
          <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
            {[
              ['Member', result.email],
              ['Course title', result.courseTitle],
              ['Designation', result.designation],
              ['Duration', `${Math.round(result.totalDuration / 60)} min total`],
              ['Status', result.status],
              ['Action', result.action],
              ['Submission ID', result.submissionId],
            ].map(([k, v]) => (
              <tr key={k} style={{ borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                <td style={{ padding: '6px 0', color: '#6b7280', width: '140px' }}>{k}</td>
                <td style={{ padding: '6px 0', fontWeight: 500 }}>{v}</td>
              </tr>
            ))}
          </table>
          <div style={{ display: 'flex', gap: '10px', marginTop: '1rem' }}>
            <Link href="/dashboard" style={{
              flex: 1, display: 'block', textAlign: 'center', padding: '9px',
              background: NSSA.dark, color: 'white', borderRadius: '6px',
              textDecoration: 'none', fontSize: '13px', fontWeight: 500
            }}>
              View on Dashboard →
            </Link>
            <button onClick={handleDelete} style={{
              padding: '9px 16px', background: 'white', color: '#dc2626',
              border: '1px solid #fecaca', borderRadius: '6px', fontSize: '13px', cursor: 'pointer'
            }}>
              Delete Test Record
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
