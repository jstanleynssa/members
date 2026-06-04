// pages/profile.js
//
// CANONICAL profile experience (being built to eventually replace the
// dashboard's inline form and the old /profile/edit). Entry point that
// auto-detects the advisor's situation from their member record and routes:
//
//   • has a non-empty bio  → SIMPLE EDIT  (pre-filled form, save)            [built here]
//   • no bio yet           → BUILD-OUT WIZARD (staged Typeform-style flow)   [stage 2, placeholder for now]
//
// No "are you a..." self-selection — cert status (NSSA / IRMAACP / both) is
// read from the record and used to tailor copy and (later) bio generation.
//
// This page is deployed ALONGSIDE the existing dashboard form for now; nothing
// points at it until the experience is proven, then we cut over.

import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { useState, useRef } from 'react'
import Link from 'next/link'

const NSSA  = { dark: '#13405E', medium: '#1C80BC', light: '#8ECAEE' }
const IRMAA = { dark: '#AF2A35', medium: '#DE5B63', light: '#ED8E8E' }
const GRAY  = { text: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' }
const GREEN = { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' }
const RED   = { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' }

// US states for the dropdown — stored as 2-letter code (kills "Pennsylavania").
const STATES = [
  ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],
  ['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['DC','District of Columbia'],
  ['FL','Florida'],['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],
  ['IN','Indiana'],['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],
  ['ME','Maine'],['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],
  ['MS','Mississippi'],['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],
  ['NH','New Hampshire'],['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],
  ['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],
  ['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],['SD','South Dakota'],
  ['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],['VA','Virginia'],
  ['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming'],
]

// Normalize whatever is stored in `state` (could be "Texas", "texas", "tx")
// to a 2-letter code so the dropdown shows the right selection.
function normalizeStateCode(raw) {
  if (!raw) return ''
  const v = String(raw).trim()
  if (v.length === 2) {
    const up = v.toUpperCase()
    return STATES.some(([c]) => c === up) ? up : ''
  }
  const match = STATES.find(([, name]) => name.toLowerCase() === v.toLowerCase())
  return match ? match[0] : ''
}

const BIO_MIN = 200 // soft target; never blocks saving

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

  // Cert guard — must be a certified member to build/edit a directory profile.
  if (!member || (!member.nssa_certified && !member.irmaa_certified)) {
    return { redirect: { destination: '/dashboard', permanent: false } }
  }

  // Routing signal: a non-empty bio means they already have a built-out profile.
  const hasBio = !!(member.bio && member.bio.trim())

  return {
    props: {
      member: JSON.parse(JSON.stringify(member)),
      userEmail: session.user.email,
      mode: hasBio ? 'edit' : 'wizard',
    },
  }
}

// ── Shared small components ───────────────────────────────────────────────
function Field({ label, name, value, onChange, type = 'text', placeholder, hint, textarea, required, minHeight }) {
  const inputStyle = {
    width: '100%', padding: '9px 12px', fontSize: '14px',
    border: `1px solid ${GRAY.border}`, borderRadius: '6px',
    outline: 'none', boxSizing: 'border-box',
    fontFamily: 'system-ui, sans-serif', background: 'white',
    resize: textarea ? 'vertical' : undefined,
    minHeight: textarea ? (minHeight || '120px') : undefined,
  }
  return (
    <div style={{ marginBottom: '1rem' }}>
      <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '5px' }}>
        {label}{required && <span style={{ color: IRMAA.medium, marginLeft: 2 }}>*</span>}
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

function StateSelect({ value, onChange }) {
  const selectStyle = {
    width: '100%', padding: '9px 12px', fontSize: '14px',
    border: `1px solid ${GRAY.border}`, borderRadius: '6px',
    outline: 'none', boxSizing: 'border-box', background: 'white',
    fontFamily: 'system-ui, sans-serif',
  }
  return (
    <div style={{ marginBottom: '1rem' }}>
      <label style={{ display: 'block', fontSize: '13px', fontWeight: 500, color: '#374151', marginBottom: '5px' }}>State</label>
      <select name="state" value={value || ''} onChange={onChange} style={selectStyle}>
        <option value="">Select a state…</option>
        {STATES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
      </select>
    </div>
  )
}

// ── Simple Edit path (returning advisor with an existing bio) ──────────────
function SimpleEdit({ member, userEmail }) {
  const [form, setForm] = useState({
    first_name:           member.first_name           || '',
    last_name:            member.last_name            || '',
    job_title:            member.job_title            || '',
    company:              member.company              || '',
    address:              member.address              || '',
    city:                 member.city                 || '',
    state:                normalizeStateCode(member.state),
    zip:                  member.zip                  || '',
    phone:                member.phone                || '',
    mobile_phone:         member.mobile_phone         || '',
    website:              member.website              || '',
    linkedin_url:         member.linkedin_url         || '',
    bio:                  member.bio                  || '',
    financial_disclosure: member.financial_disclosure || '',
    directory_opt_out:    member.directory_opt_out    === true,
  })

  const [saving, setSaving] = useState(false)
  const [saved, setSaved]   = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [zipError, setZipError] = useState(null)

  // ── Photo upload state (preview → choose → commit) ────────────────────────
  const fileInputRef = useRef(null)
  const [currentPhoto, setCurrentPhoto] = useState(member.profile_photo || null)
  const [selectedFile, setSelectedFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)   // data URL of the chosen ORIGINAL
  const [aiPreviewUrl, setAiPreviewUrl] = useState(null)   // temp URL of the latest AI result (not yet saved)
  const [photoBusy, setPhotoBusy]       = useState(null)   // 'generating' | 'committing' | null
  const [photoSuccess, setPhotoSuccess] = useState(null)
  const [photoError, setPhotoError]     = useState(null)
  const [aiGenCount, setAiGenCount]     = useState(0)      // hard cap: 3 per session
  const AI_GEN_LIMIT = 3
  const aiLimitReached = aiGenCount >= AI_GEN_LIMIT

  function handleFileSelect(e) {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 8 * 1024 * 1024) {
      setPhotoError('Please choose an image under 8 MB.')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setSelectedFile(file)
    setAiPreviewUrl(null)      // new photo clears any prior AI preview
    setPhotoSuccess(null)
    setPhotoError(null)
    const reader = new FileReader()
    reader.onload = ev => setPhotoPreview(ev.target.result)
    reader.readAsDataURL(file)
    // aiGenCount is intentionally NOT reset — the cap is per session.
  }

  // Downscale + compress the selected image in the browser before upload.
  // Caps the long edge at MAX_EDGE and re-encodes as JPEG, so the base64 POST
  // body stays well under the API route limit regardless of original size.
  // Returns base64 (no data: prefix). Re-reads selectedFile each call so
  // "Try Again" can re-run on the same original.
  const MAX_EDGE = 1200
  function fileToResizedBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = e => {
        const img = new Image()
        img.onload = () => {
          let { width, height } = img
          if (width > MAX_EDGE || height > MAX_EDGE) {
            if (width >= height) { height = Math.round(height * (MAX_EDGE / width)); width = MAX_EDGE }
            else { width = Math.round(width * (MAX_EDGE / height)); height = MAX_EDGE }
          }
          const canvas = document.createElement('canvas')
          canvas.width = width; canvas.height = height
          const ctx = canvas.getContext('2d')
          ctx.drawImage(img, 0, 0, width, height)
          // 0.85 quality JPEG — small but visually clean for a headshot.
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85)
          resolve(dataUrl.split(',')[1])
        }
        img.onerror = reject
        img.src = e.target.result
      }
      reader.onerror = reject
      reader.readAsDataURL(file)
    })
  }

  // Generate an AI preview (does NOT save). Counts against the per-session cap.
  async function generatePreview() {
    if (!selectedFile || aiLimitReached || photoBusy) return
    setPhotoBusy('generating')
    setPhotoError(null)
    setPhotoSuccess(null)
    try {
      const base64 = await fileToResizedBase64(selectedFile)
      const res = await fetch('/api/save-profile-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: userEmail,
          imageData: base64,
          mimeType: 'image/jpeg',
          mode: 'preview',
          attempt: aiGenCount, // 0,1,2 → rotates attire/background + seed
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Generation failed')
      setAiPreviewUrl(data.previewUrl + '?t=' + Date.now())
      setAiGenCount(c => c + 1)
    } catch (err) {
      setPhotoError(err.message)
    } finally {
      setPhotoBusy(null)
    }
  }

  // Commit a chosen image as the saved profile photo.
  //   which = 'ai'       → promote the current AI preview
  //   which = 'original' → save the user's original photo as-is
  async function commitPhoto(which) {
    if (photoBusy) return
    if (which === 'ai' && !aiPreviewUrl) return
    if (which === 'original' && !selectedFile) return
    setPhotoBusy('committing')
    setPhotoError(null)
    setPhotoSuccess(null)
    try {
      const body = { email: userEmail, mode: 'commit' }
      if (which === 'ai') {
        body.previewUrl = aiPreviewUrl.split('?')[0] // strip cache-buster
      } else {
        body.imageData = await fileToResizedBase64(selectedFile)
        body.mimeType = 'image/jpeg'
        body.saveOriginal = true
      }
      const res = await fetch('/api/save-profile-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Save failed')
      setCurrentPhoto(data.profile_photo + '?t=' + Date.now())
      setPhotoSuccess(which === 'ai' ? 'Your AI headshot has been saved.' : 'Your photo has been saved.')
      // Done — clear the working selection so the panel returns to its resting state.
      setSelectedFile(null)
      setPhotoPreview(null)
      setAiPreviewUrl(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err) {
      setPhotoError(err.message)
    } finally {
      setPhotoBusy(null)
    }
  }

  function handleChange(e) {
    const { name, value, type, checked } = e.target
    setForm(f => ({ ...f, [name]: type === 'checkbox' ? checked : value }))
    setSaved(false)
    if (name === 'zip') setZipError(null)
  }

  function validZip(z) {
    if (!z) return true // optional; only validate format if provided
    return /^\d{5}$/.test(z.trim())
  }

  async function handleSave(e) {
    e.preventDefault()
    if (!validZip(form.zip)) {
      setZipError('Zip must be 5 digits (e.g. 75001).')
      return
    }
    setSaving(true); setSaved(false); setSaveError(null)
    try {
      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
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

  const twoCol = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }
  const btn = (color, disabled) => ({
    padding: '9px 20px', fontSize: '13px', fontWeight: 600,
    background: disabled ? GRAY.bg : color, color: disabled ? GRAY.text : 'white',
    border: 'none', borderRadius: '6px', cursor: disabled ? 'not-allowed' : 'pointer',
  })
  const bioLen = (form.bio || '').trim().length

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '2rem', alignItems: 'start' }}>
    <form onSubmit={handleSave}>
      <div style={{ background: 'white', borderRadius: '10px', border: `1px solid ${GRAY.border}`, padding: '2rem' }}>

        <Section title="Name & Role">
          <div style={twoCol}>
            <Field label="First Name" name="first_name" value={form.first_name} onChange={handleChange} required />
            <Field label="Last Name"  name="last_name"  value={form.last_name}  onChange={handleChange} required />
          </div>
          <div style={twoCol}>
            <Field label="Job Title" name="job_title" value={form.job_title} onChange={handleChange} placeholder="Financial Advisor" />
            <Field label="Company"   name="company"   value={form.company}   onChange={handleChange} placeholder="ABC Wealth Management" />
          </div>
        </Section>

        <Section title="Location">
          <Field label="Street Address" name="address" value={form.address} onChange={handleChange} placeholder="123 Main St" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 1rem' }}>
            <Field label="City" name="city" value={form.city} onChange={handleChange} />
            <StateSelect value={form.state} onChange={handleChange} />
            <div>
              <Field label="Zip" name="zip" value={form.zip} onChange={handleChange} placeholder="75001" />
              {zipError && <p style={{ fontSize: '11px', color: RED.text, marginTop: '-8px' }}>{zipError}</p>}
            </div>
          </div>
        </Section>

        <Section title="Contact">
          <div style={twoCol}>
            <Field label="Office Phone" name="phone"        value={form.phone}        onChange={handleChange} placeholder="(555) 555-5555" type="tel" />
            <Field label="Mobile Phone" name="mobile_phone" value={form.mobile_phone} onChange={handleChange} placeholder="(555) 555-5555" type="tel" />
          </div>
          <div style={twoCol}>
            <Field label="Website"  name="website"      value={form.website}      onChange={handleChange} placeholder="https://yoursite.com" type="url" />
            <Field label="LinkedIn" name="linkedin_url" value={form.linkedin_url} onChange={handleChange} placeholder="https://linkedin.com/in/you" type="url" hint="Paste your full LinkedIn profile URL." />
          </div>
        </Section>

        <Section title="Professional Bio">
          <Field
            label="Bio" name="bio" value={form.bio} onChange={handleChange} textarea minHeight="160px"
            placeholder="Tell clients about your background, experience, and approach..."
          />
          <p style={{ fontSize: '11px', marginTop: '-8px', color: bioLen >= BIO_MIN ? GREEN.text : GRAY.text }}>
            {bioLen} characters{bioLen < BIO_MIN ? ` — aim for at least ${BIO_MIN} for a strong directory listing` : ' ✓'}
          </p>
        </Section>

        <Section title="Financial Disclosure">
          <Field
            label="Disclosure" name="financial_disclosure" value={form.financial_disclosure} onChange={handleChange} textarea
            placeholder="e.g. Securities offered through XYZ Member FINRA/SIPC..."
            hint="Optional. Displayed at the bottom of your directory profile."
          />
        </Section>

        <Section title="Directory Visibility">
          <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', cursor: 'pointer', fontSize: '13px', color: '#374151' }}>
            <input type="checkbox" name="directory_opt_out" checked={form.directory_opt_out} onChange={handleChange} style={{ marginTop: '2px' }} />
            <span>
              <strong>Hide my profile from the public directory.</strong>
              <span style={{ display: 'block', color: GRAY.text, fontSize: '12px', marginTop: '2px' }}>
                Leave unchecked to appear in the NSSA Advisor Directory. You can change this anytime.
              </span>
            </span>
          </label>
        </Section>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingTop: '1rem', borderTop: `1px solid ${GRAY.bg}` }}>
          <button type="submit" disabled={saving} style={btn(NSSA.dark, saving)}>{saving ? 'Saving…' : 'Save Profile'}</button>
          {saved && <span style={{ fontSize: '13px', color: GREEN.text, background: GREEN.bg, border: `1px solid ${GREEN.border}`, padding: '6px 12px', borderRadius: '6px' }}>✓ Profile saved</span>}
          {saveError && <span style={{ fontSize: '13px', color: RED.text }}>{saveError}</span>}
        </div>
      </div>
    </form>

      {/* ── Photo sidebar (ported from existing editor) ───────────────────── */}
      <div style={{ position: 'sticky', top: '2rem' }}>
        <div style={{ background: 'white', borderRadius: '10px', border: `1px solid ${GRAY.border}`, padding: '1.5rem' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 600, color: NSSA.dark, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1.25rem', paddingBottom: '6px', borderBottom: `2px solid ${NSSA.light}` }}>
            Profile Photo
          </h3>

          <div style={{ marginBottom: '1.25rem', textAlign: 'center' }}>
            {currentPhoto ? (
              <img src={currentPhoto} alt="Profile photo" style={{ width: '180px', height: '185px', objectFit: 'cover', objectPosition: 'top', borderRadius: '8px', border: `1px solid ${GRAY.border}` }} />
            ) : (
              <div style={{ width: '180px', height: '185px', background: GRAY.bg, borderRadius: '8px', border: `1px solid ${GRAY.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto', color: GRAY.text, fontSize: '13px' }}>
                No photo yet
              </div>
            )}
          </div>

          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileSelect} style={{ display: 'none' }} />
          <button type="button" onClick={() => fileInputRef.current?.click()} style={{ ...btn(NSSA.medium, false), width: '100%', marginBottom: '1rem' }}>
            {selectedFile ? '↺ Choose Different Photo' : '↑ Choose Photo'}
          </button>

          {photoPreview && (
            <div>
              {/* Show the AI result (in a true 1:1 frame so the crop is honest)
                  once generated; otherwise show the selected original. */}
              {aiPreviewUrl ? (
                <>
                  <p style={{ fontSize: '12px', color: NSSA.dark, fontWeight: 600, marginBottom: '8px', textAlign: 'center' }}>
                    AI headshot preview {aiGenCount > 1 ? `(version ${aiGenCount})` : ''}
                  </p>
                  <div style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: '6px', overflow: 'hidden', border: `1px solid ${GRAY.border}`, marginBottom: '4px' }}>
                    <img src={aiPreviewUrl} alt="AI headshot preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                  <p style={{ fontSize: '11px', color: GRAY.text, textAlign: 'center', marginBottom: '1rem' }}>
                    This is exactly how it will be saved (square crop). Not saved yet.
                  </p>
                </>
              ) : (
                <>
                  <p style={{ fontSize: '12px', color: GRAY.text, marginBottom: '8px', textAlign: 'center' }}>Selected photo</p>
                  <img src={photoPreview} alt="Selected" style={{ width: '100%', maxHeight: '200px', objectFit: 'cover', objectPosition: 'top', borderRadius: '6px', border: `1px solid ${GRAY.border}`, marginBottom: '1rem' }} />
                </>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* Save the currently-previewed AI image */}
                {aiPreviewUrl && (
                  <button type="button" disabled={!!photoBusy} onClick={() => commitPhoto('ai')} style={{ ...btn(NSSA.dark, !!photoBusy), width: '100%' }}>
                    {photoBusy === 'committing' ? 'Saving…' : '✓ Use This Photo'}
                  </button>
                )}

                {/* Generate / regenerate an AI version (capped) */}
                {!aiLimitReached && (
                  <button type="button" disabled={!!photoBusy} onClick={generatePreview} style={{ ...btn(aiPreviewUrl ? NSSA.medium : NSSA.dark, !!photoBusy), width: '100%' }}>
                    {photoBusy === 'generating'
                      ? 'Generating…'
                      : aiGenCount === 0
                        ? '✦ Enhance with AI'
                        : `✦ Regenerate (${aiGenCount} of ${AI_GEN_LIMIT} used)`}
                  </button>
                )}

                {/* Use the user's own photo as-is */}
                <button type="button" disabled={!!photoBusy} onClick={() => commitPhoto('original')} style={{ ...btn('#374151', !!photoBusy), width: '100%' }}>
                  {photoBusy === 'committing' ? 'Saving…' : '↑ Use My Original Photo'}
                </button>
              </div>

              {!aiLimitReached ? (
                <p style={{ fontSize: '11px', color: GRAY.text, marginTop: '8px', lineHeight: 1.4 }}>
                  <strong>Enhance with AI</strong> creates a polished professional headshot — new background and attire, with only light, natural touch-ups to your face. Nothing is saved until you choose <strong>Use This Photo</strong>.
                </p>
              ) : (
                <div style={{ marginTop: '10px', padding: '10px 12px', background: GRAY.bg, border: `1px solid ${GRAY.border}`, borderRadius: '6px', fontSize: '12px', color: GRAY.text, lineHeight: 1.5 }}>
                  You’ve used all {AI_GEN_LIMIT} AI attempts for this session. Choose <strong>Use This Photo</strong> to keep the current AI version, or <strong>Use My Original Photo</strong>.
                </div>
              )}
            </div>
          )}

          {photoSuccess && (
            <div style={{ marginTop: '10px', padding: '8px 12px', background: GREEN.bg, border: `1px solid ${GREEN.border}`, borderRadius: '6px', fontSize: '13px', color: GREEN.text }}>
              ✓ {photoSuccess}
            </div>
          )}
          {photoError && (
            <div style={{ marginTop: '10px', padding: '8px 12px', background: RED.bg, border: `1px solid ${RED.border}`, borderRadius: '6px', fontSize: '13px', color: RED.text }}>
              {photoError}
            </div>
          )}

          <p style={{ fontSize: '11px', color: GRAY.text, marginTop: '12px', lineHeight: 1.5 }}>
            Accepted formats: JPG, PNG, WebP. Best results with a clear photo of your face.
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Placeholder for the Build-Out Wizard (stage 2 of the build) ────────────
function WizardPlaceholder({ member }) {
  return (
    <div style={{ background: 'white', borderRadius: '10px', border: `1px solid ${GRAY.border}`, padding: '2.5rem', textAlign: 'center' }}>
      <h2 style={{ fontSize: '18px', color: NSSA.dark, marginBottom: '0.5rem' }}>
        Let's build your directory profile
      </h2>
      <p style={{ color: GRAY.text, fontSize: '14px', maxWidth: '440px', margin: '0 auto 1.5rem' }}>
        The guided, step-by-step build-out experience will live here. For now this
        is a placeholder — the simple editor is fully working for returning advisors.
      </p>
      <Link href="/dashboard" style={{ fontSize: '13px', color: NSSA.medium, textDecoration: 'none' }}>← Back to dashboard</Link>
    </div>
  )
}

export default function ProfilePage({ member, userEmail, mode }) {
  const certLabel =
    member.nssa_certified && member.irmaa_certified ? 'NSSA® + IRMAACP™'
      : member.nssa_certified ? 'NSSA®'
      : 'IRMAACP™'

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: 'white', borderBottom: `1px solid ${GRAY.border}`, padding: '1rem 2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <Link href="/dashboard" style={{ fontSize: '13px', color: NSSA.medium, textDecoration: 'none' }}>← Dashboard</Link>
          <span style={{ color: GRAY.border }}>|</span>
          <h1 style={{ fontSize: '16px', fontWeight: 600, color: '#111' }}>
            {mode === 'edit' ? 'Edit Profile' : 'Create Your Profile'}
          </h1>
          <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: NSSA.light, color: NSSA.dark }}>{certLabel}</span>
        </div>
        <span style={{ fontSize: '12px', color: GRAY.text }}>{userEmail}</span>
      </div>

      <div style={{ maxWidth: mode === 'edit' ? '1040px' : '780px', margin: '0 auto', padding: '2rem' }}>
        {mode === 'edit'
          ? <SimpleEdit member={member} userEmail={userEmail} />
          : <WizardPlaceholder member={member} />}
      </div>
    </div>
  )
}
