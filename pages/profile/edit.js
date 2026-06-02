import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { useState, useRef } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'

const NSSA  = { dark: '#13405E', medium: '#1C80BC', light: '#8ECAEE' }
const GRAY  = { text: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' }
const GREEN = { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' }
const RED   = { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' }

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
    .select('*')
    .eq('email', session.user.email)
    .single()

  if (!member || (!member.nssa_certified && !member.irmaa_certified)) {
    return { redirect: { destination: '/dashboard', permanent: false } }
  }

  return { props: { member: JSON.parse(JSON.stringify(member)), userEmail: session.user.email } }
}

function Field({ label, name, value, onChange, type = 'text', placeholder, hint, textarea, required }) {
  const inputStyle = {
    width: '100%', padding: '9px 12px', fontSize: '14px',
    border: `1px solid ${GRAY.border}`, borderRadius: '6px',
    outline: 'none', boxSizing: 'border-box',
    fontFamily: 'system-ui, sans-serif', background: 'white',
    resize: textarea ? 'vertical' : undefined,
    minHeight: textarea ? '100px' : undefined,
  }
  return (
    <div style={{ marginBottom: '1rem' }}>
      <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '5px' }}>
        {label}{required && <span style={{ color: '#dc2626', marginLeft: 2 }}>*</span>}
      </label>
      {textarea
        ? <textarea name={name} value={value || ''} onChange={onChange} placeholder={placeholder} style={inputStyle} />
        : <input type={type} name={name} value={value || ''} onChange={onChange} placeholder={placeholder} style={inputStyle} />
      }
      {hint && <p style={{ fontSize: '11px', color: GRAY.text, marginTop: '4px' }}>{hint}</p>}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: '2rem' }}>
      <h3 style={{ fontSize: '13px', fontWeight: 600, color: NSSA.dark, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1rem', paddingBottom: '6px', borderBottom: `2px solid ${NSSA.light}` }}>
        {title}
      </h3>
      {children}
    </div>
  )
}

export default function ProfileEdit({ member, userEmail }) {
  const router = useRouter()
  const fileInputRef = useRef(null)

  const [form, setForm] = useState({
    first_name:           member.first_name          || '',
    last_name:            member.last_name           || '',
    job_title:            member.job_title           || '',
    company:              member.company             || '',
    address:              member.address             || '',
    city:                 member.city                || '',
    state:                member.state               || '',
    zip:                  member.zip                 || '',
    phone:                member.phone               || '',
    website:              member.website             || '',
    bio:                  member.bio                 || '',
    financial_disclosure: member.financial_disclosure || '',
  })

  const [currentPhoto, setCurrentPhoto]   = useState(member.profile_photo || null)
  const [selectedFile, setSelectedFile]   = useState(null)
  const [photoPreview, setPhotoPreview]   = useState(null)
  const [photoLoading, setPhotoLoading]   = useState(null) // 'asis' | 'ai' | null
  const [photoSuccess, setPhotoSuccess]   = useState(null)
  const [photoError, setPhotoError]       = useState(null)

  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [saveError, setSaveError] = useState(null)

  function handleChange(e) {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
    setSaved(false)
  }

  function handleFileSelect(e) {
    const file = e.target.files[0]
    if (!file) return
    setSelectedFile(file)
    setPhotoSuccess(null)
    setPhotoError(null)
    const reader = new FileReader()
    reader.onload = ev => setPhotoPreview(ev.target.result)
    reader.readAsDataURL(file)
  }

  async function handlePhotoUpload(enhance) {
    if (!selectedFile) return
    setPhotoLoading(enhance ? 'ai' : 'asis')
    setPhotoError(null)
    setPhotoSuccess(null)

    try {
      // Convert file to base64
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = e => resolve(e.target.result.split(',')[1])
        reader.onerror = reject
        reader.readAsDataURL(selectedFile)
      })

      const res = await fetch('/api/save-profile-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          imageData: base64,
          mimeType: selectedFile.type || 'image/jpeg',
          enhance
        })
      })

      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Upload failed')

      setCurrentPhoto(data.profile_photo + '?t=' + Date.now())
      setSelectedFile(null)
      setPhotoPreview(null)
      setPhotoSuccess(enhance ? 'AI-enhanced photo saved!' : 'Photo saved!')
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      setPhotoError(err.message)
    } finally {
      setPhotoLoading(null)
    }
  }

  async function handleSave(e) {
    e.preventDefault()
    setSaving(true)
    setSaved(false)
    setSaveError(null)

    try {
      const res = await fetch('/api/profile/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Save failed')
      setSaved(true)
      setTimeout(() => setSaved(false), 4000)
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

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

      {/* Header */}
      <div style={{ background: 'white', borderBottom: `1px solid ${GRAY.border}`, padding: '1rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Link href="/dashboard" style={{ fontSize: '13px', color: NSSA.medium, textDecoration: 'none' }}>← Dashboard</Link>
          <span style={{ color: GRAY.border }}>|</span>
          <h1 style={{ fontSize: '16px', fontWeight: 600, color: '#111' }}>Edit Profile</h1>
        </div>
        <span style={{ fontSize: '12px', color: GRAY.text }}>{userEmail}</span>
      </div>

      <div style={{ maxWidth: '960px', margin: '0 auto', padding: '2rem', display: 'grid', gridTemplateColumns: '1fr 300px', gap: '2rem', alignItems: 'start' }}>

        {/* ── LEFT: Form fields ────────────────────────────────────── */}
        <form onSubmit={handleSave}>
          <div style={{ background: 'white', borderRadius: '10px', border: `1px solid ${GRAY.border}`, padding: '2rem' }}>

            <Section title="Name & Role">
              <div style={twoCol}>
                <Field label="First Name"  name="first_name"  value={form.first_name}  onChange={handleChange} required />
                <Field label="Last Name"   name="last_name"   value={form.last_name}   onChange={handleChange} required />
              </div>
              <div style={twoCol}>
                <Field label="Job Title"   name="job_title"   value={form.job_title}   onChange={handleChange} placeholder="Financial Advisor" />
                <Field label="Company"     name="company"     value={form.company}     onChange={handleChange} placeholder="ABC Wealth Management" />
              </div>
            </Section>

            <Section title="Location">
              <Field label="Street Address" name="address" value={form.address} onChange={handleChange} placeholder="123 Main St" />
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 100px', gap: '0 1rem' }}>
                <Field label="City"  name="city"  value={form.city}  onChange={handleChange} />
                <Field label="State" name="state" value={form.state} onChange={handleChange} placeholder="TX" />
                <Field label="Zip"   name="zip"   value={form.zip}   onChange={handleChange} placeholder="75001" />
              </div>
            </Section>

            <Section title="Contact">
              <div style={twoCol}>
                <Field label="Office Phone" name="phone"   value={form.phone}   onChange={handleChange} placeholder="(555) 555-5555" type="tel" />
                <Field label="Website"      name="website" value={form.website} onChange={handleChange} placeholder="https://yoursite.com" type="url" />
              </div>
            </Section>

            <Section title="Professional Bio">
              <Field
                label="Bio" name="bio" value={form.bio} onChange={handleChange} textarea
                placeholder="Tell clients about your background, experience, and approach..."
                hint="This bio will be displayed on your public directory listing."
              />
            </Section>

            <Section title="Financial Disclosure">
              <Field
                label="Disclosure" name="financial_disclosure" value={form.financial_disclosure}
                onChange={handleChange} textarea
                placeholder="e.g. Securities offered through XYZ Member FINRA/SIPC..."
                hint="Optional. Displayed at the bottom of your directory profile."
              />
            </Section>

            {/* Save bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingTop: '1rem', borderTop: `1px solid ${GRAY.bg}` }}>
              <button type="submit" disabled={saving} style={btn(NSSA.dark, saving)}>
                {saving ? 'Saving…' : 'Save Profile'}
              </button>
              {saved && (
                <span style={{ fontSize: '13px', color: GREEN.text, background: GREEN.bg, border: `1px solid ${GREEN.border}`, padding: '6px 12px', borderRadius: '6px' }}>
                  ✓ Profile saved
                </span>
              )}
              {saveError && (
                <span style={{ fontSize: '13px', color: RED.text }}>{saveError}</span>
              )}
            </div>
          </div>
        </form>

        {/* ── RIGHT: Photo upload ──────────────────────────────────── */}
        <div style={{ position: 'sticky', top: '2rem' }}>
          <div style={{ background: 'white', borderRadius: '10px', border: `1px solid ${GRAY.border}`, padding: '1.5rem' }}>
            <h3 style={{ fontSize: '13px', fontWeight: 600, color: NSSA.dark, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1.25rem', paddingBottom: '6px', borderBottom: `2px solid ${NSSA.light}` }}>
              Profile Photo
            </h3>

            {/* Current photo */}
            <div style={{ marginBottom: '1.25rem', textAlign: 'center' }}>
              {currentPhoto ? (
                <img
                  src={currentPhoto}
                  alt="Profile photo"
                  style={{ width: '180px', height: '185px', objectFit: 'cover', objectPosition: 'top', borderRadius: '8px', border: `1px solid ${GRAY.border}` }}
                />
              ) : (
                <div style={{ width: '180px', height: '185px', background: GRAY.bg, borderRadius: '8px', border: `1px solid ${GRAY.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto', color: GRAY.text, fontSize: '13px' }}>
                  No photo yet
                </div>
              )}
            </div>

            {/* File picker */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={{ ...btn(NSSA.medium, false), width: '100%', marginBottom: '1rem' }}
            >
              {selectedFile ? '↺ Choose Different Photo' : '↑ Choose Photo'}
            </button>

            {/* Preview + action buttons */}
            {photoPreview && (
              <div>
                <p style={{ fontSize: '12px', color: GRAY.text, marginBottom: '8px', textAlign: 'center' }}>Preview</p>
                <img
                  src={photoPreview}
                  alt="Preview"
                  style={{ width: '100%', maxHeight: '200px', objectFit: 'cover', objectPosition: 'top', borderRadius: '6px', border: `1px solid ${GRAY.border}`, marginBottom: '1rem' }}
                />

                <p style={{ fontSize: '12px', fontWeight: 500, color: '#374151', marginBottom: '8px' }}>How would you like to upload this?</p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <button
                    type="button"
                    disabled={!!photoLoading}
                    onClick={() => handlePhotoUpload(false)}
                    style={{ ...btn('#374151', !!photoLoading), width: '100%' }}
                  >
                    {photoLoading === 'asis' ? 'Uploading…' : '↑ Upload As-Is'}
                  </button>
                  <button
                    type="button"
                    disabled={!!photoLoading}
                    onClick={() => handlePhotoUpload(true)}
                    style={{ ...btn(NSSA.dark, !!photoLoading), width: '100%' }}
                  >
                    {photoLoading === 'ai' ? 'Enhancing…' : '✦ Enhance with AI'}
                  </button>
                </div>

                <p style={{ fontSize: '11px', color: GRAY.text, marginTop: '8px', lineHeight: 1.4 }}>
                  <strong>Enhance with AI</strong> — upgrades to business attire, improves lighting and composition.
                </p>
              </div>
            )}

            {photoSuccess && (
              <div style={{ marginTop: '10px', padding: '8px 12px', background: GREEN.bg, border: `1px solid ${GREEN.border}`, borderRadius: '6px', fontSize: '13px', color: GREEN.text }}>
                ✓ {photoSuccess}
              </div>
            )}
            {photoError && (
              <div style={{ marginTop: '10px', padding: '8px 12px', background: RED.bg, border: `1px solid RED.border}`, borderRadius: '6px', fontSize: '13px', color: RED.text }}>
                {photoError}
              </div>
            )}

            <p style={{ fontSize: '11px', color: GRAY.text, marginTop: '12px', lineHeight: 1.5 }}>
              Accepted formats: JPG, PNG, WebP. Best results with a clear photo of your face.
            </p>
          </div>
        </div>

      </div>
    </div>
  )
}
