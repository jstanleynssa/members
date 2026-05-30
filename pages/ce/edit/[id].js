import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { useState } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../../lib/supabaseClient'
import Link from 'next/link'

const NSSA = { dark: '#13405E', medium: '#1C80BC', light: '#8ECAEE' }
const IRMAA = { dark: '#AF2A35', medium: '#DE5B63', light: '#ED8E8E' }
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
    .eq('email', session.user.email)
    .single()

  // Redirect if not found, auto-logged, or already approved
  if (!submission) return { redirect: { destination: '/dashboard', permanent: false } }
  if (submission.source === 'zoom_auto') return { redirect: { destination: '/dashboard', permanent: false } }
  if (submission.status === 'approved') return { redirect: { destination: '/dashboard', permanent: false } }

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
        status: 'pending'
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
  const inputStyle = {
    width: '100%', padding: '10px 12px', fontSize: '14px',
    border: '1px solid #d1d5db', borderRadius: '6px', outline: 'none', boxSizing: 'border-box'
  }
  const group = { marginBottom: '1.25rem' }
  const labelStyle = { display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: '#374151' }

  const designationLabel = form.designation === 'NSSA' ? 'NSSA® Social Security'
    : form.designation === 'IRMAA' ? 'IRMAACP™ Medicare & IRMAA'
    : 'NSSA® and IRMAACP™'

  return (
    <div style={{ padding: '2rem', maxWidth: '700px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>

      {/* Header — matches submit.js style */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid #e5e7eb' }}>
        <Link href="/dashboard" style={{ fontSize: '13px', color: NSSA.medium, textDecoration: 'none', fontWeight: 500 }}>← Back to Dashboard</Link>
        <img src="/nssa-irmaa-logos.png" alt="NSSA and IRMAACP logos" style={{ height: '40px', width: 'auto' }} />
      </div>

      <div style={{ background: 'white', borderRadius: '10px', padding: '2rem', border: '1px solid #e5e7eb' }}>
        <h1 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '2px' }}>Edit CE Activity</h1>
        <p style={{ color: '#6b7280', fontSize: '13px', marginBottom: '1.5rem' }}>
          Saving changes will reset this submission to pending review.
        </p>

        {/* Designation indicator — matches submit.js */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px',
          background: form.designation === 'IRMAA' ? '#fef2f2' : '#eff6ff',
          borderRadius: '8px', border: `1px solid ${form.designation === 'IRMAA' ? IRMAA.light : NSSA.light}`,
          marginBottom: '1.5rem'
        }}>
          <span style={{ fontSize: '13px', color: form.designation === 'IRMAA' ? IRMAA.dark : NSSA.dark, fontWeight: 500 }}>
            Applying toward: {designationLabel}
          </span>
          {/* Dropdown only for dual-cert holders */}
          {bothCerts && (
            <select name="designation" value={form.designation} onChange={handleChange}
              style={{ marginLeft: 'auto', fontSize: '12px', padding: '3px 8px', borderRadius: '4px', border: '1px solid #d1d5db', background: 'white' }}>
              <option value="NSSA">NSSA® only</option>
              <option value="IRMAA">IRMAACP™ only</option>
              <option value="both">Both</option>
            </select>
          )}
        </div>

        <form onSubmit={handleSubmit}>
          <div style={group}>
            <label style={labelStyle}>Course / Activity Title *</label>
            <input name="course_title" value={form.course_title} onChange={handleChange} required style={inputStyle} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
            <div>
              <label style={labelStyle}>Completion Date *</label>
              <input name="completion_date" type="date" value={form.completion_date} onChange={handleChange} required style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Hours Earned *</label>
              <input name="hours_earned" type="number" min="0.25" max="8" step="0.25"
                value={form.hours_earned} onChange={handleChange} required style={inputStyle} />
            </div>
          </div>

          <div style={group}>
            <label style={labelStyle}>CE Type *</label>
            <select name="ce_type" value={form.ce_type} onChange={handleChange} required style={{ ...inputStyle, background: 'white' }}>
              {CE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div style={group}>
            <label style={labelStyle}>Notes</label>
            <textarea name="notes" value={form.notes} onChange={handleChange} rows={3}
              style={{ ...inputStyle, resize: 'vertical' }} />
          </div>

          {error && (
            <p style={{ color: '#dc2626', fontSize: '13px', marginBottom: '1rem', padding: '10px', background: '#fef2f2', borderRadius: '6px' }}>
              {error}
            </p>
          )}

          <div style={{ display: 'flex', gap: '10px' }}>
            <button type="submit" disabled={loading} style={{
              flex: 1, padding: '12px',
              background: loading ? '#93c5fd' : form.designation === 'IRMAA' ? IRMAA.dark : NSSA.dark,
              color: 'white', border: 'none', borderRadius: '8px',
              fontSize: '14px', fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer'
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
  )
}
