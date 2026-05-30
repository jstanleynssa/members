import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { useState, useRef } from 'react'
import { useRouter } from 'next/router'
import { supabase } from '../../lib/supabaseClient'
import Link from 'next/link'

const NSSA = { dark: '#13405E', medium: '#1C80BC', light: '#8ECAEE' }
const IRMAA = { dark: '#AF2A35', medium: '#DE5B63', light: '#ED8E8E' }
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

  // Read designation from query param (passed from dashboard card button)
  const designation = context.query.designation || null

  return { props: { member: member || null, userEmail: session.user.email, presetDesignation: designation } }
}

export default function CESubmit({ member, userEmail, presetDesignation }) {
  const router = useRouter()
  const fileRef = useRef()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [file, setFile] = useState(null)

  const bothCerts = member?.nssa_certified && member?.irmaa_certified

  // If coming from a card button, use that designation. Otherwise default based on certs.
  const defaultDesignation = presetDesignation ||
    (bothCerts ? 'both' : member?.nssa_certified ? 'NSSA' : member?.irmaa_certified ? 'IRMAA' : 'NSSA')

  const [form, setForm] = useState({
    course_title: '',
    completion_date: '',
    hours_earned: '',
    ce_type: '',
    designation: defaultDesignation,
    notes: ''
  })

  function handleChange(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      let proof_url = null
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
        status: 'pending'
      })

      if (insertError) throw new Error(insertError.message)

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

      router.replace('/dashboard')
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  const inputStyle = {
    width: '100%', padding: '10px 12px', fontSize: '14px',
    border: '1px solid #d1d5db', borderRadius: '6px', outline: 'none', boxSizing: 'border-box'
  }
  const group = { marginBottom: '1.25rem' }
  const label = { display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px', color: '#374151' }

  // Accent color based on designation being submitted
  const isNssa = form.designation === 'NSSA' || form.designation === 'both'
  const accentColor = form.designation === 'IRMAA' ? IRMAA.dark : NSSA.dark
  const designationLabel = form.designation === 'NSSA' ? 'NSSA® Social Security'
    : form.designation === 'IRMAA' ? 'IRMAACP™ Medicare & IRMAA'
    : 'NSSA® and IRMAACP™'

  return (
    <div style={{ padding: '2rem', maxWidth: '700px', margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid #e5e7eb' }}>
        <Link href="/dashboard" style={{ fontSize: '13px', color: NSSA.medium, textDecoration: 'none', fontWeight: 500 }}>← Back to Dashboard</Link>
        <img src="/nssa-irmaa-logos.png" alt="NSSA and IRMAACP logos" style={{ height: '40px', width: 'auto' }} />
      </div>

      <div style={{ background: 'white', borderRadius: '10px', padding: '2rem', border: '1px solid #e5e7eb' }}>
        <h1 style={{ fontSize: '1.2rem', fontWeight: 600, marginBottom: '2px' }}>Submit CE Activity</h1>
        <p style={{ color: '#6b7280', fontSize: '13px', marginBottom: '1.5rem' }}>
          Submitting as {member?.first_name} {member?.last_name} ({userEmail})
        </p>

        {/* Designation indicator */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px',
          background: form.designation === 'IRMAA' ? '#fef2f2' : '#eff6ff',
          borderRadius: '8px', border: `1px solid ${form.designation === 'IRMAA' ? IRMAA.light : NSSA.light}`,
          marginBottom: '1.5rem'
        }}>
          <span style={{ fontSize: '13px', color: form.designation === 'IRMAA' ? IRMAA.dark : NSSA.dark, fontWeight: 500 }}>
            Applying toward: {designationLabel}
          </span>
          {/* Allow changing designation only if both certs and no preset */}
          {bothCerts && !presetDesignation && (
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
            <label style={label}>Course / Activity Title *</label>
            <input name="course_title" value={form.course_title} onChange={handleChange} required
              placeholder="e.g. Social Security Planning Update" style={inputStyle} />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1.25rem' }}>
            <div>
              <label style={label}>Completion Date *</label>
              <input name="completion_date" type="date" value={form.completion_date} onChange={handleChange} required style={inputStyle} />
            </div>
            <div>
              <label style={label}>Hours Earned *</label>
              <input name="hours_earned" type="number" min="0.25" max="8" step="0.25"
                value={form.hours_earned} onChange={handleChange} required placeholder="e.g. 1.5" style={inputStyle} />
            </div>
          </div>

          <div style={group}>
            <label style={label}>CE Type *</label>
            <select name="ce_type" value={form.ce_type} onChange={handleChange} required style={{ ...inputStyle, background: 'white' }}>
              <option value="">Select a type…</option>
              {CE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div style={group}>
            <label style={label}>Proof of Completion <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional but recommended)</span></label>
            <input ref={fileRef} type="file" accept=".pdf,.jpg,.jpeg,.png"
              onChange={e => setFile(e.target.files[0])}
              style={{ ...inputStyle, padding: '8px 12px', cursor: 'pointer' }} />
            <p style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px' }}>PDF, JPG, or PNG. Max 10MB.</p>
          </div>

          <div style={group}>
            <label style={label}>Notes <span style={{ color: '#9ca3af', fontWeight: 400 }}>(optional)</span></label>
            <textarea name="notes" value={form.notes} onChange={handleChange} rows={3}
              placeholder="Any additional details…"
              style={{ ...inputStyle, resize: 'vertical' }} />
          </div>

          <div style={{ background: '#fef9c3', border: '1px solid #fde68a', borderRadius: '6px', padding: '10px 12px', fontSize: '12px', color: '#854d0e', marginBottom: '1.25rem' }}>
            ⏳ Submissions are reviewed within 48 hours.
          </div>

          {error && (
            <p style={{ color: '#dc2626', fontSize: '13px', marginBottom: '1rem', padding: '10px', background: '#fef2f2', borderRadius: '6px', border: '1px solid #fecaca' }}>
              {error}
            </p>
          )}

          <button type="submit" disabled={loading} style={{
            width: '100%', padding: '12px', background: loading ? '#93c5fd' : accentColor,
            color: 'white', border: 'none', borderRadius: '8px', fontSize: '14px',
            fontWeight: 500, cursor: loading ? 'not-allowed' : 'pointer'
          }}>
            {loading ? 'Submitting…' : `Submit ${designationLabel} CE`}
          </button>
        </form>
      </div>
    </div>
  )
}
