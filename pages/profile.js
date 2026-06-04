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

// Convert a stored bio (which may be HTML <p>…</p> from the old Zapier flow,
// or already plain text) into clean plain text with blank lines between
// paragraphs. Mirrors the directory's bioToParagraphs logic so what the
// advisor edits matches exactly what the directory renders. Idempotent: a
// plain-text bio passes through essentially unchanged.
function htmlBioToText(bio) {
  if (!bio) return ''
  const looksHtml = /<[a-z][\s\S]*>/i.test(bio)
  if (!looksHtml) return bio.trim()
  const paras = bio
    .replace(/<\/(p|div)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .split(/\n{2,}/)
    .map(s => s.trim())
    .filter(Boolean)
  return paras.join('\n\n')
}

// Downscale + compress an image in the browser before upload. Caps the long
// edge at MAX_EDGE and re-encodes as JPEG so the base64 POST body stays well
// under the API route limit regardless of original size. Returns base64 (no
// data: prefix). Module-scoped so both SimpleEdit and BuildWizard share one
// definition. Re-reads the file each call so "regenerate" can re-run on it.
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

  // Routing signal: profile_completed marks an advisor who has finished the
  // build-out wizard (or an existing advisor backfilled as complete). Completed
  // → Simple Edit; otherwise → the staged build-out wizard. We fall back to
  // bio-presence if the column is somehow absent, so routing is never undefined.
  const completed = member.profile_completed === true
    || (member.profile_completed == null && !!(member.bio && member.bio.trim()))

  return {
    props: {
      member: JSON.parse(JSON.stringify(member)),
      userEmail: session.user.email,
      mode: completed ? 'edit' : 'wizard',
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
    bio:                  htmlBioToText(member.bio),
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
              {/* ── Option 1: the photo they uploaded, shown in the real square crop ── */}
              <p style={{ fontSize: '12px', color: '#374151', fontWeight: 600, marginBottom: '8px', textAlign: 'center' }}>
                Your uploaded photo
              </p>
              <div style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: '6px', overflow: 'hidden', border: `1px solid ${GRAY.border}`, marginBottom: '6px' }}>
                <img src={photoPreview} alt="Your uploaded photo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
              <button type="button" disabled={!!photoBusy} onClick={() => commitPhoto('original')} style={{ ...btn('#374151', !!photoBusy), width: '100%', marginBottom: '6px' }}>
                {photoBusy === 'committing' ? 'Saving…' : '↑ Use My Uploaded Photo'}
              </button>
              <p style={{ fontSize: '11px', color: GRAY.text, textAlign: 'center', marginBottom: '1.25rem' }}>
                Shown in the square crop used on your profile.
              </p>

              {/* ── Option 2: the AI version (preview before saving) ────────────── */}
              {aiPreviewUrl ? (
                <>
                  <p style={{ fontSize: '12px', color: NSSA.dark, fontWeight: 600, marginBottom: '8px', textAlign: 'center' }}>
                    AI headshot preview {aiGenCount > 1 ? `(version ${aiGenCount})` : ''}
                  </p>
                  <div style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: '6px', overflow: 'hidden', border: `2px solid ${NSSA.light}`, marginBottom: '6px' }}>
                    <img src={aiPreviewUrl} alt="AI headshot preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                  <button type="button" disabled={!!photoBusy} onClick={() => commitPhoto('ai')} style={{ ...btn(NSSA.dark, !!photoBusy), width: '100%', marginBottom: '6px' }}>
                    {photoBusy === 'committing' ? 'Saving…' : '✓ Use This AI Photo'}
                  </button>
                  {!aiLimitReached && (
                    <button type="button" disabled={!!photoBusy} onClick={generatePreview} style={{ ...btn(NSSA.medium, !!photoBusy), width: '100%' }}>
                      {photoBusy === 'generating' ? 'Generating…' : `✦ Regenerate (${aiGenCount} of ${AI_GEN_LIMIT} used)`}
                    </button>
                  )}
                  <p style={{ fontSize: '11px', color: GRAY.text, textAlign: 'center', marginTop: '6px' }}>
                    Not saved yet — choose an option above.
                  </p>
                </>
              ) : (
                !aiLimitReached && (
                  <button type="button" disabled={!!photoBusy} onClick={generatePreview} style={{ ...btn(NSSA.dark, !!photoBusy), width: '100%' }}>
                    {photoBusy === 'generating' ? 'Generating…' : '✦ Enhance with AI'}
                  </button>
                )
              )}

              {!aiLimitReached ? (
                <p style={{ fontSize: '11px', color: GRAY.text, marginTop: '8px', lineHeight: 1.4 }}>
                  <strong>Enhance with AI</strong> creates a polished professional headshot — new background and attire, with only light, natural touch-ups to your face. Nothing is saved until you pick an option.
                </p>
              ) : (
                <div style={{ marginTop: '10px', padding: '10px 12px', background: GRAY.bg, border: `1px solid ${GRAY.border}`, borderRadius: '6px', fontSize: '12px', color: GRAY.text, lineHeight: 1.5 }}>
                  You’ve used all {AI_GEN_LIMIT} AI attempts for this session. Choose <strong>Use This AI Photo</strong> to keep the current AI version, or <strong>Use My Uploaded Photo</strong> above.
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

// ════════════════════════════════════════════════════════════════════════
// BUILD-OUT WIZARD — staged experience for new advisors (no completed profile)
// Increment 1: shell + nav + progress + save-on-Next, with stages
//   1 Welcome/identity · 2 Location · 3 Contact · 4 Bio (placeholder) · 5 Photo · 6 Review
// The AI bio generation (stage 4) and SEO generation (stage 6) are wired as
// placeholders here and built in the next increments.
// ════════════════════════════════════════════════════════════════════════
const WIZARD_STEPS = ['Welcome', 'Location', 'Contact', 'Your Story', 'Photo', 'Review']

function ProgressBar({ step }) {
  return (
    <div style={{ marginBottom: '1.75rem' }}>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
        {WIZARD_STEPS.map((label, i) => (
          <div key={label} style={{ flex: 1, height: '5px', borderRadius: '999px', background: i <= step ? NSSA.medium : GRAY.border, transition: 'background 0.3s' }} />
        ))}
      </div>
      <p style={{ fontSize: '12px', color: GRAY.text, margin: 0 }}>
        Step {step + 1} of {WIZARD_STEPS.length}: <strong style={{ color: NSSA.dark }}>{WIZARD_STEPS[step]}</strong>
      </p>
    </div>
  )
}

function BuildWizard({ member, userEmail, certLabel }) {
  const [step, setStep] = useState(0)
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
    bio:                  htmlBioToText(member.bio),
    financial_disclosure: member.financial_disclosure || '',
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Photo state (reuses the same endpoint + flow as Simple Edit)
  const fileInputRef = useRef(null)
  const [currentPhoto, setCurrentPhoto] = useState(member.profile_photo || null)
  const [selectedFile, setSelectedFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [aiPreviewUrl, setAiPreviewUrl] = useState(null)
  const [photoBusy, setPhotoBusy] = useState(null)
  const [photoMsg, setPhotoMsg] = useState(null)
  const [aiGenCount, setAiGenCount] = useState(0)
  const AI_GEN_LIMIT = 3
  const aiLimitReached = aiGenCount >= AI_GEN_LIMIT

  function update(e) {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
  }

  // Persist the current fields to the member row (save-as-you-go).
  async function persist(extra = {}) {
    const res = await fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, ...extra }),
    })
    const data = await res.json()
    if (!res.ok || !data.ok) throw new Error(data.error || 'Save failed')
  }

  // Per-step validation. Returns an error string or null.
  function validateStep(s) {
    if (s === 0) {
      if (!form.first_name.trim() || !form.last_name.trim()) return 'Please enter your first and last name.'
    }
    if (s === 1) {
      if (form.zip && !/^\d{5}$/.test(form.zip.trim())) return 'Zip must be 5 digits (e.g. 75001).'
    }
    return null
  }

  async function next() {
    const v = validateStep(step)
    if (v) { setError(v); return }
    setError(null); setSaving(true)
    try {
      await persist()
      setStep(s => Math.min(s + 1, WIZARD_STEPS.length - 1))
      if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function back() {
    setError(null)
    setStep(s => Math.max(s - 1, 0))
  }

  async function finish() {
    setError(null); setSaving(true)
    try {
      await persist({ profile_completed: true })
      // Reload so getServerSideProps re-routes them to the (now) Simple Edit view.
      if (typeof window !== 'undefined') window.location.href = '/profile'
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  // ── Photo handlers (mirror Simple Edit) ─────────────────────────────────
  function handleFileSelect(e) {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 8 * 1024 * 1024) { setPhotoMsg({ type: 'err', text: 'Please choose an image under 8 MB.' }); return }
    setSelectedFile(file); setAiPreviewUrl(null); setPhotoMsg(null)
    const reader = new FileReader()
    reader.onload = ev => setPhotoPreview(ev.target.result)
    reader.readAsDataURL(file)
  }
  async function genPreview() {
    if (!selectedFile || aiLimitReached || photoBusy) return
    setPhotoBusy('generating'); setPhotoMsg(null)
    try {
      const base64 = await fileToResizedBase64(selectedFile)
      const res = await fetch('/api/save-profile-photo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail, imageData: base64, mimeType: 'image/jpeg', mode: 'preview', attempt: aiGenCount }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Generation failed')
      setAiPreviewUrl(data.previewUrl + '?t=' + Date.now()); setAiGenCount(c => c + 1)
    } catch (err) { setPhotoMsg({ type: 'err', text: err.message }) } finally { setPhotoBusy(null) }
  }
  async function commit(which) {
    if (photoBusy) return
    if (which === 'ai' && !aiPreviewUrl) return
    if (which === 'original' && !selectedFile) return
    setPhotoBusy('committing'); setPhotoMsg(null)
    try {
      const body = { email: userEmail, mode: 'commit' }
      if (which === 'ai') body.previewUrl = aiPreviewUrl.split('?')[0]
      else { body.imageData = await fileToResizedBase64(selectedFile); body.mimeType = 'image/jpeg'; body.saveOriginal = true }
      const res = await fetch('/api/save-profile-photo', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Save failed')
      setCurrentPhoto(data.profile_photo + '?t=' + Date.now())
      setSelectedFile(null); setPhotoPreview(null); setAiPreviewUrl(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      setPhotoMsg({ type: 'ok', text: which === 'ai' ? 'AI headshot saved.' : 'Photo saved.' })
    } catch (err) { setPhotoMsg({ type: 'err', text: err.message }) } finally { setPhotoBusy(null) }
  }

  const card = { background: 'white', borderRadius: '10px', border: `1px solid ${GRAY.border}`, padding: '2rem' }
  const twoCol = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }
  const btnP = (disabled) => ({ padding: '11px 26px', fontSize: '14px', fontWeight: 600, background: disabled ? GRAY.bg : NSSA.dark, color: disabled ? GRAY.text : 'white', border: 'none', borderRadius: '6px', cursor: disabled ? 'not-allowed' : 'pointer' })
  const btnS = { padding: '11px 22px', fontSize: '14px', fontWeight: 600, background: 'white', color: GRAY.dark, border: `1px solid ${GRAY.border}`, borderRadius: '6px', cursor: 'pointer' }
  const sBtn = (c, d) => ({ padding: '10px 18px', fontSize: '13px', fontWeight: 600, background: d ? GRAY.bg : c, color: d ? GRAY.text : 'white', border: 'none', borderRadius: '6px', cursor: d ? 'not-allowed' : 'pointer', width: '100%' })

  return (
    <div style={card}>
      <ProgressBar step={step} />

      {/* ── Step 1: Welcome / identity ──────────────────────────────────── */}
      {step === 0 && (
        <div>
          <h2 style={{ fontSize: '20px', color: NSSA.dark, marginBottom: '6px' }}>Congratulations on earning your {certLabel} certification!</h2>
          <p style={{ fontSize: '14px', color: GRAY.text, marginBottom: '1.5rem', lineHeight: 1.6 }}>
            Let's build your listing for the NSSA Advisor Directory, where prospective clients find certified professionals. First, confirm your name and role.
          </p>
          <div style={twoCol}>
            <Field label="First Name" name="first_name" value={form.first_name} onChange={update} required />
            <Field label="Last Name"  name="last_name"  value={form.last_name}  onChange={update} required />
          </div>
          <div style={twoCol}>
            <Field label="Job Title" name="job_title" value={form.job_title} onChange={update} placeholder="Financial Advisor" />
            <Field label="Company"   name="company"   value={form.company}   onChange={update} placeholder="ABC Wealth Management" />
          </div>
        </div>
      )}

      {/* ── Step 2: Location ────────────────────────────────────────────── */}
      {step === 1 && (
        <div>
          <h2 style={{ fontSize: '18px', color: NSSA.dark, marginBottom: '1.25rem' }}>Where are you located?</h2>
          <Field label="Street Address" name="address" value={form.address} onChange={update} placeholder="123 Main St" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 1rem' }}>
            <Field label="City" name="city" value={form.city} onChange={update} />
            <StateSelect value={form.state} onChange={update} />
            <Field label="Zip" name="zip" value={form.zip} onChange={update} placeholder="75001" />
          </div>
        </div>
      )}

      {/* ── Step 3: Contact ─────────────────────────────────────────────── */}
      {step === 2 && (
        <div>
          <h2 style={{ fontSize: '18px', color: NSSA.dark, marginBottom: '1.25rem' }}>How can clients reach you?</h2>
          <div style={twoCol}>
            <Field label="Office Phone" name="phone"        value={form.phone}        onChange={update} placeholder="(555) 555-5555" type="tel" />
            <Field label="Mobile Phone" name="mobile_phone" value={form.mobile_phone} onChange={update} placeholder="(555) 555-5555" type="tel" />
          </div>
          <div style={twoCol}>
            <Field label="Website"  name="website"      value={form.website}      onChange={update} placeholder="https://yoursite.com" type="url" />
            <Field label="LinkedIn" name="linkedin_url" value={form.linkedin_url} onChange={update} placeholder="https://linkedin.com/in/you" type="url" hint="Paste your full LinkedIn profile URL." />
          </div>
        </div>
      )}

      {/* ── Step 4: Your Story (bio placeholder + financial disclosure) ──── */}
      {step === 3 && (
        <div>
          <h2 style={{ fontSize: '18px', color: NSSA.dark, marginBottom: '6px' }}>Your professional story</h2>
          <p style={{ fontSize: '13px', color: GRAY.text, marginBottom: '1rem', lineHeight: 1.6 }}>
            (AI-assisted bio generation is coming to this step. For now, write or paste your bio below.)
          </p>
          <Field label="Bio" name="bio" value={form.bio} onChange={update} textarea minHeight="160px"
            placeholder="Tell clients about your background, experience, and approach..." />
          <p style={{ fontSize: '11px', marginTop: '-8px', color: (form.bio || '').trim().length >= BIO_MIN ? GREEN.text : GRAY.text }}>
            {(form.bio || '').trim().length} characters{(form.bio || '').trim().length < BIO_MIN ? ` — aim for at least ${BIO_MIN}` : ' ✓'}
          </p>
          <div style={{ marginTop: '1.25rem' }}>
            <Field label="Financial Disclosure" name="financial_disclosure" value={form.financial_disclosure} onChange={update} textarea
              placeholder="e.g. Securities offered through XYZ Member FINRA/SIPC..." hint="Optional. Displayed at the bottom of your directory profile." />
          </div>
        </div>
      )}

      {/* ── Step 5: Photo ───────────────────────────────────────────────── */}
      {step === 4 && (
        <div>
          <h2 style={{ fontSize: '18px', color: NSSA.dark, marginBottom: '1.25rem' }}>Add your photo</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: '1.5rem', alignItems: 'start' }}>
            <div>
              {currentPhoto
                ? <img src={currentPhoto} alt="Profile" style={{ width: '160px', height: '160px', objectFit: 'cover', borderRadius: '8px', border: `1px solid ${GRAY.border}` }} />
                : <div style={{ width: '160px', height: '160px', background: GRAY.bg, borderRadius: '8px', border: `1px solid ${GRAY.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: GRAY.text, fontSize: '12px', textAlign: 'center' }}>No photo yet</div>}
            </div>
            <div>
              <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileSelect} style={{ display: 'none' }} />
              <button type="button" onClick={() => fileInputRef.current?.click()} style={{ ...sBtn(NSSA.medium, false), marginBottom: '10px' }}>
                {selectedFile ? '↺ Choose Different Photo' : '↑ Choose Photo'}
              </button>

              {photoPreview && (
                <div>
                  <div style={{ width: '140px', aspectRatio: '1/1', borderRadius: '6px', overflow: 'hidden', border: `1px solid ${GRAY.border}`, margin: '8px 0' }}>
                    <img src={aiPreviewUrl || photoPreview} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '260px' }}>
                    {aiPreviewUrl && <button type="button" disabled={!!photoBusy} onClick={() => commit('ai')} style={sBtn(NSSA.dark, !!photoBusy)}>{photoBusy === 'committing' ? 'Saving…' : '✓ Use This AI Photo'}</button>}
                    {!aiLimitReached && <button type="button" disabled={!!photoBusy} onClick={genPreview} style={sBtn(NSSA.medium, !!photoBusy)}>{photoBusy === 'generating' ? 'Generating…' : aiGenCount === 0 ? '✦ Enhance with AI' : `✦ Regenerate (${aiGenCount} of ${AI_GEN_LIMIT})`}</button>}
                    <button type="button" disabled={!!photoBusy} onClick={() => commit('original')} style={sBtn('#374151', !!photoBusy)}>{photoBusy === 'committing' ? 'Saving…' : '↑ Use My Uploaded Photo'}</button>
                  </div>
                </div>
              )}
              {photoMsg && <p style={{ fontSize: '12px', marginTop: '8px', color: photoMsg.type === 'ok' ? GREEN.text : RED.text }}>{photoMsg.type === 'ok' ? '✓ ' : ''}{photoMsg.text}</p>}
              <p style={{ fontSize: '11px', color: GRAY.text, marginTop: '10px', lineHeight: 1.5 }}>A photo is recommended but optional — you can add one later. JPG, PNG, or WebP.</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 6: Review ──────────────────────────────────────────────── */}
      {step === 5 && (
        <div>
          <h2 style={{ fontSize: '18px', color: NSSA.dark, marginBottom: '1rem' }}>Review your profile</h2>
          <p style={{ fontSize: '13px', color: GRAY.text, marginBottom: '1.25rem', lineHeight: 1.6 }}>
            Here's what we have. When you finish, your profile is created — your directory listing goes live after a short review (you'll get an email when it's published).
          </p>
          <div style={{ fontSize: '14px', color: '#374151', lineHeight: 1.9 }}>
            <div><strong>Name:</strong> {form.first_name} {form.last_name}</div>
            {form.job_title && <div><strong>Title:</strong> {form.job_title}</div>}
            {form.company && <div><strong>Company:</strong> {form.company}</div>}
            <div><strong>Location:</strong> {[form.city, form.state].filter(Boolean).join(', ')}{form.zip ? ` ${form.zip}` : ''}</div>
            {form.phone && <div><strong>Phone:</strong> {form.phone}</div>}
            {form.website && <div><strong>Website:</strong> {form.website}</div>}
            <div><strong>Photo:</strong> {currentPhoto ? 'Added ✓' : 'Not added'}</div>
            <div><strong>Bio:</strong> {(form.bio || '').trim() ? `${(form.bio || '').trim().length} characters` : 'Not written yet'}</div>
          </div>
        </div>
      )}

      {error && <p style={{ fontSize: '13px', color: RED.text, marginTop: '1rem' }}>{error}</p>}

      {/* Navigation */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2rem', paddingTop: '1.25rem', borderTop: `1px solid ${GRAY.bg}` }}>
        <button type="button" onClick={back} disabled={step === 0 || saving} style={{ ...btnS, visibility: step === 0 ? 'hidden' : 'visible' }}>← Back</button>
        {step < WIZARD_STEPS.length - 1
          ? <button type="button" onClick={next} disabled={saving} style={btnP(saving)}>{saving ? 'Saving…' : 'Save & Continue →'}</button>
          : <button type="button" onClick={finish} disabled={saving} style={btnP(saving)}>{saving ? 'Finishing…' : 'Finish & Create Profile'}</button>}
      </div>
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
          : <BuildWizard member={member} userEmail={userEmail} certLabel={certLabel} />}
      </div>
    </div>
  )
}
