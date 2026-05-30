import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { useState, useRef } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabaseClient'
import Link from 'next/link'

const NSSA = { dark: '#13405E', medium: '#1C80BC' }
const IRMAA = { medium: '#DE5B63' }

const CE_TYPES = ['CFP', 'CPE', 'Insurance', 'Ethics', 'Monthly Member Call', 'Other']

export async function getServerSideProps(context) {
  const supabaseServer = createServerSupabaseClient(context)
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session) return { redirect: { destination: '/login', permanent: false } }

  const { data: member } = await supabaseServer
    .from('members')
    .select('first_name, last_name, email, nssa_certified, irmaa_certified')
    .eq('email', session.user.email)
    .single()

  return { props: { member: member || null, userEmail: session.user.email } }
}

export default function CESubmit({ member, userEmail }) {
  const router = useRouter()
  const fileRef = useRef()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [form, setForm] = useState({
    course_title: '',
    completion_date: '',
    hours_earned: '',
    ce_type: '',
    designation: member?.nssa_certified && member?.irmaa_certified ? 'both'
      : member?.nssa_certified ? 'NSSA'
      : member?.irmaa_certified ? 'IRMAA' : 'NSSA',
    notes: ''
  })
  const [file, setFile] = useState(null)

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      let proof_url = null

      // Upload proof file to Supabase Storage if provided
      if (file) {
        const ext = file.name.split('.').pop()
        const path = `ce-proof/${userEmail}/${Date.now()}.${ext}`
        const { error: uploadError } = await supabase.storage
          .from('ce-proof')
          .upload(path, file, { upsert: false })
        if (uploadError) throw new Error('File upload failed: ' + uploadError.message)
        const { data: urlData } = supabase.storage.from('ce-proof').getPublicUrl(path)
        proof_url = urlData.publicUrl
      }

      // Insert submission
      const { error: insertError } = await supabase.from('ce_submissions').insert({
        email: userEmail,
        first_name: member?.first_name || '',
        last_name: member?.last_name || '',
        course_title: form.course_title,
        completion_date: form.completion_date,
        hours_earned: parseFloat(form.hours_earned),
        ce_type: form.ce_type,
        designation: form.designation,
        proof_url,
        notes: form.notes || null,
        source: 'manual',
        status: 'approved'
      })

      if (insertError) throw new Error(insertError.message)

      // Send confirmation email via API route
      await fetch('/api/ce-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          firstName: member?.first_name,
          courseTitle: form.course_title,
          hours: form.hours_earned,
          ceType: form.ce_type,
          completionDate: form.completion_date
        })
      })

      router.replace('/dashboard?submitted=1')
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  const label = (text) => ({
    display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: '#374151'
  })
  const input = { width: '100%', padding: '10px 12px', fontSize: '14px', border: '1px solid #d1d5db', borderRadius: '6px', outline: 'none', boxSizing: 'border-box' }
  const group = { marginBottom: '1.25rem' }

  const bothCerts = member?.nssa_certified && member?.irmaa_certified

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ background: NSSA.dark, color: 'white', padding: '0 2rem' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', display: 'flex', alignItems: 'center', height: '60px', gap: '16px' }}>
          <Link href="/dashboard" style={{ color: 'rgba(255,255,255,0.7)', fontSize: '13px', textDecoration: 'none' }}>← Back to Dashboard</Link>
          <span style={{ fontWeight: 700, fontSize: '15px', letterSpacing: '0.05em' }}>Submit CE Activity</span>
        </div>
      </div>

      <div style={{ maxWidth: '600px', margin: '2rem auto', padding: '0 1rem' }}>
        <div style={{ background: 'white', borderRadius: '10px', padding: '2rem', border: '1px solid #e5e7eb' }}>
          <h1 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '0.25rem' }}>CE Activity Submission</h1>
          <p style={{ color: '#6b7280', fontSize: '13px', marginBottom: '1.5rem' }}>
            Submitting as {member?.first_name} {member?.last_name} ({userEmail})
          </p>

          <form onSubmit={handleSubmit}>
            <div style={group}>
              <label style={label('Course Title')}>Course / Activity Title *</label>
              <input name="course_title" value={form.course_title} onChange={handleChange} required placeholder="e.g. Social Security Planning Update" style={input} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
              <div>
                <label style={label('Completion Date')}>Completion Date *</label>
                <input name="completion_date" type="date" value={form.completion_date} onChange={handleChange} required style={input} />
              </div>
              <div>
                <label style={label('Hours Earned')}>Hours Earned *</label>
                <input name="hours_earned" type="number" min="0.25" max="8" step="0.25" value={form.hours_earned} onChange={handleChange} required placeholder="e.g. 1.5" style={input} />
              </div>
            </div>

            <div style={group}>
              <label style={label('CE Type')}>CE Type *</label>
              <select name="ce_type" value={form.ce_type} onChange={handleChange} required style={{ ...input, background: 'white' }}>
                <option value="">Select a type…</option>
                {CE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            {bothCerts && (
              <div style={group}>
                <label style={label('Designation')}>Apply toward *</label>
                <select name="designation" value={form.designation} onChange={handleChange} required style={{ ...input, background: 'white' }}>
                  <option value="both">Both NSSA® and IRMAACP™</option>
                  <option value="NSSA">NSSA® only</option>
                  <option value="IRMAA">IRMAACP™ only</option>
                </select>
              </div>
            )}

            <div style={group}>
              <label style={label('Proof of Completion')}>
                Proof of Completion <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional but recommended)</span>
              </label>
              <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e => setFile(e.target.files[0])}
                style={{ ...input, padding: '8px 12px', cursor: 'pointer' }} />
              <p style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px' }}>PDF, JPG, or PNG. Max 10MB.</p>
            </div>

            <div style={group}>
              <label style={label('Notes')}>Notes <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span></label>
              <textarea name="notes" value={form.notes} onChange={handleChange} rows={3}
                placeholder="Any additional details about this CE activity…"
                style={{ ...input, resize: 'vertical' }} />
            </div>

            {error && <p style={{ color: '#dc2626', fontSize: '13px', marginBottom: '1rem', padding: '10px', background: '#fef2f2', borderRadius: '6px', border: '1px solid #fecaca' }}>{error}</p>}

            <button type="submit" disabled={loading} style={{
              width: '100%', padding: '12px', background: loading ? '#93c5fd' : NSSA.dark,
              color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px',
              fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer'
            }}>
              {loading ? 'Submitting…' : 'Submit CE Activity'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
