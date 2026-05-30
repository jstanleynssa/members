import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../../lib/supabaseClient'
import Link from 'next/link'

const NSSA = { dark: '#13405E', medium: '#1C80BC' }
const IRMAA = { medium: '#DE5B63' }
const CE_TYPES = ['CFP', 'CPE', 'Insurance', 'Ethics', 'Monthly Member Call', 'Other']

export async function getServerSideProps(context) {
  const { id } = context.params
  const supabaseServer = createServerSupabaseClient(context)
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session) return { redirect: { destination: '/login', permanent: false } }

  const { data: submission } = await supabaseServer
    .from('ce_submissions')
    .select('*')
    .eq('id', id)
    .eq('email', session.user.email) // ensure they own this submission
    .single()

  if (!submission) return { redirect: { destination: '/dashboard', permanent: false } }
  if (submission.source === 'zoom_auto') return { redirect: { destination: '/dashboard', permanent: false } }

  const { data: member } = await supabaseServer
    .from('members')
    .select('first_name, last_name, nssa_certified, irmaa_certified')
    .eq('email', session.user.email)
    .single()

  return { props: { submission, member: member || null, userEmail: session.user.email } }
}

export default function EditSubmission({ submission, member, userEmail }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [form, setForm] = useState({
    course_title: submission.course_title,
    completion_date: submission.completion_date,
    hours_earned: submission.hours_earned,
    ce_type: submission.ce_type,
    designation: submission.designation,
    notes: submission.notes || ''
  })

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const { error } = await supabase
      .from('ce_submissions')
      .update({
        course_title: form.course_title,
        completion_date: form.completion_date,
        hours_earned: parseFloat(form.hours_earned),
        ce_type: form.ce_type,
        designation: form.designation,
        notes: form.notes || null,
        status: 'pending' // reset to pending on edit so admin can re-review
      })
      .eq('id', submission.id)
      .eq('email', userEmail)

    if (error) { setError(error.message); setLoading(false); return }
    router.replace('/dashboard')
  }

  async function handleDelete() {
    if (!confirm('Are you sure you want to delete this submission? This cannot be undone.')) return
    setLoading(true)
    await supabase.from('ce_submissions').delete().eq('id', submission.id).eq('email', userEmail)
    router.replace('/dashboard')
  }

  const bothCerts = member?.nssa_certified && member?.irmaa_certified
  const inputStyle = { width: '100%', padding: '10px 12px', fontSize: '14px', border: '1px solid #d1d5db', borderRadius: '6px', outline: 'none', boxSizing: 'border-box' }
  const group = { marginBottom: '1.25rem' }
  const label = { display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: '#374151' }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', fontFamily: 'system-ui, sans-serif' }}>
     <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid #e5e7eb' }}>
  <Link href="/dashboard" style={{ fontSize: '13px', color: NSSA.medium, textDecoration: 'none', fontWeight: 500 }}>← Back to Dashboard</Link>
  <img src="/nssa-irmaa-logos.png" alt="NSSA and IRMAACP logos" style={{ height: '40px', width: 'auto' }} />
</div>
      <div style={{ maxWidth: '600px', margin: '2rem auto', padding: '0 1rem' }}>
        <div style={{ background: 'white', borderRadius: '10px', padding: '2rem', border: '1px solid #e5e7eb' }}>
          <h1 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.25rem' }}>Edit CE Activity</h1>
          <p style={{ color: '#6b7280', fontSize: '13px', marginBottom: '1.5rem' }}>
            Editing this submission will reset it to pending review.
          </p>

          <form onSubmit={handleSubmit}>
            <div style={group}>
              <label style={label}>Course / Activity Title *</label>
              <input name="course_title" value={form.course_title} onChange={handleChange} required style={inputStyle} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
              <div>
                <label style={label}>Completion Date *</label>
                <input name="completion_date" type="date" value={form.completion_date} onChange={handleChange} required style={inputStyle} />
              </div>
              <div>
                <label style={label}>Hours Earned *</label>
                <input name="hours_earned" type="number" min="0.25" max="8" step="0.25" value={form.hours_earned} onChange={handleChange} required style={inputStyle} />
              </div>
            </div>

            <div style={group}>
              <label style={label}>CE Type *</label>
              <select name="ce_type" value={form.ce_type} onChange={handleChange} required style={{ ...inputStyle, background: 'white' }}>
                {CE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {bothCerts && (
              <div style={group}>
                <label style={label}>Apply toward *</label>
                <select name="designation" value={form.designation} onChange={handleChange} required style={{ ...inputStyle, background: 'white' }}>
                  <option value="both">Both NSSA® and IRMAACP™</option>
                  <option value="NSSA">NSSA® only</option>
                  <option value="IRMAA">IRMAACP™ only</option>
                </select>
              </div>
            )}

            <div style={group}>
              <label style={label}>Notes</label>
              <textarea name="notes" value={form.notes} onChange={handleChange} rows={3} style={{ ...inputStyle, resize: 'vertical' }} />
            </div>

            {error && <p style={{ color: '#dc2626', fontSize: '13px', marginBottom: '1rem', padding: '10px', background: '#fef2f2', borderRadius: '6px' }}>{error}</p>}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button type="submit" disabled={loading} style={{
                flex: 1, padding: '12px', background: loading ? '#93c5fd' : NSSA.dark,
                color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px', fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer'
              }}>
                {loading ? 'Saving…' : 'Save Changes'}
              </button>
              <button type="button" onClick={handleDelete} disabled={loading} style={{
                padding: '12px 20px', background: 'white', color: '#dc2626',
                border: '1px solid #fecaca', borderRadius: '8px', fontSize: '14px', cursor: 'pointer'
              }}>
                Delete
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
