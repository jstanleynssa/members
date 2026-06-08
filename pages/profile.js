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

  // Look the member up by the email they authenticated with. We match
  // case-insensitively so a capitalization difference between auth and the
  // stored record doesn't read as "no membership".
  const loginEmail = (session.user.email || '').trim()
  const { data: member } = await supabaseAdmin
    .from('members')
    .select('*')
    .ilike('email', loginEmail)
    .maybeSingle()

  // No-membership guard — the authenticated email matches NO member record.
  // This is almost always a legacy member signing in with a different email
  // than the one on file for their certification. Do NOT create anything and
  // do NOT silently bounce them (that dead-end is what confused people and
  // drove duplicate accounts). Show a clear message telling them to use their
  // certification email or contact support.
  if (!member) {
    return { props: { noMembership: true, loginEmail } }
  }

  // Cert guard — a member record exists but isn't certified for either program.
  // (Different case from "no record": they have an account, just no cert yet.)
  if (!member.nssa_certified && !member.irmaa_certified) {
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

// ── Shared photo panel ─────────────────────────────────────────────────────
// Self-contained upload → preview → choose → commit flow, used by BOTH the
// Simple Edit sidebar and the wizard's photo step (single source of truth, so
// the two can't drift). `variant` tweaks the framing for the two contexts.
//   onPhotoSaved(url): optional callback fired after a successful commit.
function PhotoPanel({ userEmail, initialPhoto = null, onPhotoSaved, variant = 'sidebar' }) {
  const fileInputRef = useRef(null)
  const [currentPhoto, setCurrentPhoto] = useState(initialPhoto)
  const [selectedFile, setSelectedFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [aiPreviews, setAiPreviews]     = useState([]) // accumulating AI versions (up to AI_GEN_LIMIT)
  const [photoBusy, setPhotoBusy]       = useState(null) // 'generating' | 'committing' | null
  const [photoSuccess, setPhotoSuccess] = useState(null)
  const [photoError, setPhotoError]     = useState(null)
  const AI_GEN_LIMIT = 3
  const aiGenCount = aiPreviews.length
  const aiLimitReached = aiGenCount >= AI_GEN_LIMIT

  const btn = (color, disabled) => ({
    padding: '9px 20px', fontSize: '13px', fontWeight: 600,
    background: disabled ? GRAY.bg : color, color: disabled ? GRAY.text : 'white',
    border: 'none', borderRadius: '6px', cursor: disabled ? 'not-allowed' : 'pointer',
  })

  function handleFileSelect(e) {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 8 * 1024 * 1024) {
      setPhotoError('Please choose an image under 8 MB.')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setSelectedFile(file)
    setAiPreviews([])     // a new upload clears prior AI versions
    setPhotoSuccess(null)
    setPhotoError(null)
    const reader = new FileReader()
    reader.onload = ev => setPhotoPreview(ev.target.result)
    reader.readAsDataURL(file)
  }

  async function generatePreview() {
    if (!selectedFile || aiLimitReached || photoBusy) return
    setPhotoBusy('generating'); setPhotoError(null); setPhotoSuccess(null)
    try {
      const base64 = await fileToResizedBase64(selectedFile)
      const res = await fetch('/api/save-profile-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail, imageData: base64, mimeType: 'image/jpeg', mode: 'preview', attempt: aiGenCount }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Generation failed')
      setAiPreviews(prev => [...prev, data.previewUrl + '?t=' + Date.now()]) // accumulate
    } catch (err) {
      setPhotoError(err.message)
    } finally {
      setPhotoBusy(null)
    }
  }

  // url: for an AI commit, the specific preview URL chosen from the gallery.
  async function commitPhoto(which, url) {
    if (photoBusy) return
    if (which === 'ai' && !url) return
    if (which === 'original' && !selectedFile) return
    // Hard likeness checkpoint: AI photos can occasionally drift from the real
    // person. Require explicit confirmation that it still looks like them before
    // it can be saved.
    if (which === 'ai') {
      const ok = typeof window !== 'undefined' && window.confirm(
        'Before saving: does this AI photo still clearly look like you?\n\n' +
        'AI can sometimes change a face. If it doesn\u2019t look like you, click Cancel and use your uploaded photo or pick a different version.'
      )
      if (!ok) return
    }
    setPhotoBusy('committing'); setPhotoError(null); setPhotoSuccess(null)
    try {
      const body = { email: userEmail, mode: 'commit' }
      if (which === 'ai') {
        body.previewUrl = url.split('?')[0]
      } else {
        body.imageData = await fileToResizedBase64(selectedFile)
        body.mimeType = 'image/jpeg'
        body.saveOriginal = true
        body.enhance = false   // use the photo as-is; do NOT run AI enhancement
      }
      const res = await fetch('/api/save-profile-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Save failed')
      const saved = data.profile_photo + '?t=' + Date.now()
      setCurrentPhoto(saved)
      setPhotoSuccess(which === 'ai' ? 'Your AI headshot has been saved.' : 'Your photo has been saved.')
      setSelectedFile(null); setPhotoPreview(null); setAiPreviews([])
      if (fileInputRef.current) fileInputRef.current.value = ''
      if (onPhotoSaved) onPhotoSaved(data.profile_photo)
    } catch (err) {
      setPhotoError(err.message)
    } finally {
      setPhotoBusy(null)
    }
  }

  // The resting photo display differs slightly by context.
  const restingPhoto = variant === 'sidebar'
    ? { w: '180px', h: '185px' }
    : { w: '160px', h: '160px' }

  return (
    <div>
      <div style={{ marginBottom: '1.25rem', textAlign: 'center' }}>
        {currentPhoto
          ? <img src={currentPhoto} alt="Profile photo" style={{ width: restingPhoto.w, height: restingPhoto.h, objectFit: 'cover', objectPosition: 'top', borderRadius: '8px', border: `1px solid ${GRAY.border}` }} />
          : <div style={{ width: restingPhoto.w, height: restingPhoto.h, background: GRAY.bg, borderRadius: '8px', border: `1px solid ${GRAY.border}`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto', color: GRAY.text, fontSize: '13px' }}>No photo yet</div>}
      </div>

      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileSelect} style={{ display: 'none' }} />
      <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
        <button type="button" onClick={() => fileInputRef.current?.click()} style={{ ...btn(NSSA.medium, false), width: '100%', maxWidth: '320px' }}>
          {selectedFile ? '↺ Choose Different Photo' : '↑ Choose Photo'}
        </button>
      </div>

      {photoPreview && (
        <div>
          {/* 4-tile gallery: uploaded photo + up to 3 AI versions, all selectable */}
          <div style={{ display: 'grid', gridTemplateColumns: variant === 'sidebar' ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: '12px', alignItems: 'start' }}>
            {/* Uploaded photo (anchor) */}
            <div>
              <p style={{ fontSize: '11px', color: '#374151', fontWeight: 600, marginBottom: '6px', textAlign: 'center' }}>Your photo</p>
              <div style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: '6px', overflow: 'hidden', border: `1px solid ${GRAY.border}`, marginBottom: '6px' }}>
                <img src={photoPreview} alt="Your uploaded photo" style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
              </div>
              <button type="button" disabled={!!photoBusy} onClick={() => commitPhoto('original')} style={{ ...btn('#374151', !!photoBusy), width: '100%', padding: '8px 6px', fontSize: '12px' }}>
                {photoBusy === 'committing' ? 'Saving…' : 'Use This'}
              </button>
            </div>

            {/* AI versions, accumulating */}
            {aiPreviews.map((url, i) => (
              <div key={url}>
                <p style={{ fontSize: '11px', color: NSSA.dark, fontWeight: 600, marginBottom: '6px', textAlign: 'center' }}>AI v{i + 1}</p>
                <div style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: '6px', overflow: 'hidden', border: `2px solid ${NSSA.light}`, marginBottom: '6px' }}>
                  <img src={url} alt={`AI headshot version ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }} />
                </div>
                <button type="button" disabled={!!photoBusy} onClick={() => commitPhoto('ai', url)} style={{ ...btn(NSSA.dark, !!photoBusy), width: '100%', padding: '8px 6px', fontSize: '12px' }}>
                  {photoBusy === 'committing' ? 'Saving…' : 'Use This'}
                </button>
              </div>
            ))}

            {/* Empty generate slot (if under the cap) */}
            {!aiLimitReached && (
              <div>
                <p style={{ fontSize: '11px', color: GRAY.text, fontWeight: 600, marginBottom: '6px', textAlign: 'center' }}>{aiGenCount === 0 ? 'AI headshot' : `AI v${aiGenCount + 1}`}</p>
                <button type="button" disabled={!!photoBusy} onClick={generatePreview}
                  style={{ width: '100%', aspectRatio: '1 / 1', borderRadius: '6px', border: `2px dashed ${NSSA.light}`, background: '#f8fbfe', color: NSSA.medium, fontSize: '12px', fontWeight: 600, cursor: photoBusy ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '8px' }}>
                  {photoBusy === 'generating' ? 'Generating…' : (aiGenCount === 0 ? '✦ Enhance with AI' : '✦ Generate another')}
                </button>
              </div>
            )}
          </div>

          <p style={{ fontSize: '11px', color: GRAY.text, textAlign: 'center', margin: '10px 0 0' }}>Each photo is shown in the square crop used on your profile. Click <strong>Use This</strong> under the one you want.</p>

          {/* Likeness warning whenever AI versions exist */}
          {aiGenCount > 0 && (
            <div style={{ marginTop: '10px', padding: '10px 12px', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '6px', fontSize: '12px', color: '#9a3412', lineHeight: 1.5 }}>
              <strong>Check the AI photos carefully.</strong> AI can sometimes change a face. Only use one if it clearly looks like you — otherwise use your own photo.
            </div>
          )}

          {aiLimitReached && (
            <div style={{ marginTop: '10px', padding: '10px 12px', background: GRAY.bg, border: `1px solid ${GRAY.border}`, borderRadius: '6px', fontSize: '12px', color: GRAY.text, lineHeight: 1.5 }}>
              You’ve used all {AI_GEN_LIMIT} AI attempts for this session. Pick the version that looks most like you, or use your own photo.
            </div>
          )}

          <p style={{ fontSize: '11px', color: GRAY.text, marginTop: '10px', lineHeight: 1.4 }}>
            <strong>Enhance with AI</strong> creates a polished professional headshot — new background and attire, with only light touch-ups to your face. Nothing is saved until you pick one.
          </p>
        </div>
      )}

      {photoSuccess && (
        <div style={{ marginTop: '10px', padding: '8px 12px', background: GREEN.bg, border: `1px solid ${GREEN.border}`, borderRadius: '6px', fontSize: '13px', color: GREEN.text }}>✓ {photoSuccess}</div>
      )}
      {photoError && (
        <div style={{ marginTop: '10px', padding: '8px 12px', background: RED.bg, border: `1px solid ${RED.border}`, borderRadius: '6px', fontSize: '13px', color: RED.text }}>{photoError}</div>
      )}

      <p style={{ fontSize: '11px', color: GRAY.text, marginTop: '12px', lineHeight: 1.5 }}>
        Accepted formats: JPG, PNG, WebP. Best results with a clear photo of your face.
      </p>
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
            <Field label="Website"  name="website"      value={form.website}      onChange={handleChange} placeholder="yoursite.com" type="text" />
            <Field label="LinkedIn" name="linkedin_url" value={form.linkedin_url} onChange={handleChange} placeholder="linkedin.com/in/you" type="text" hint="Paste your full LinkedIn profile URL." />
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

      {/* ── Photo sidebar (shared PhotoPanel) ─────────────────────────────── */}
      <div style={{ position: 'sticky', top: '2rem' }}>
        <div style={{ background: 'white', borderRadius: '10px', border: `1px solid ${GRAY.border}`, padding: '1.5rem' }}>
          <h3 style={{ fontSize: '13px', fontWeight: 600, color: NSSA.dark, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '1.25rem', paddingBottom: '6px', borderBottom: `2px solid ${NSSA.light}` }}>
            Profile Photo
          </h3>
          <PhotoPanel userEmail={userEmail} initialPhoto={member.profile_photo || null} variant="sidebar" />
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

  // Bio-generation inputs — transient (NOT member columns, so not persisted by
  // /api/save). They only feed the bio generator. The generated text lands in
  // form.bio, which IS a column and gets saved.
  const [bioInputs, setBioInputs] = useState({
    years_experience: '',   // years in the business
    who_you_help: '',       // who they primarily serve
    focus_areas: '',        // main focus areas
    whats_different: '',     // what makes their approach different
    personal_touch: '',     // family / hometown / hobbies
    extra_credentials: '',   // designations beyond NSSA/IRMAACP
    talking_points: '',      // optional free-form catch-all
  })
  const [bioBusy, setBioBusy] = useState(false)
  const [bioError, setBioError] = useState(null)
  const [discBusy, setDiscBusy] = useState(false)
  const [discError, setDiscError] = useState(null)
  function updateBioInput(e) {
    const { name, value } = e.target
    setBioInputs(b => ({ ...b, [name]: value }))
  }

  // Photo: the shared PhotoPanel owns the upload flow; we keep just the saved
  // URL here so the Review step can show whether a photo was added.
  const [currentPhoto, setCurrentPhoto] = useState(member.profile_photo || null)

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
      // Fire the "your profile is live" confirmation email. Best-effort: never
      // block completion on it — the profile is already saved. Failures are
      // swallowed so the advisor always reaches the dashboard.
      try {
        await fetch('/api/profile-live-notification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: userEmail, firstName: form.first_name }),
        })
      } catch (_) { /* non-fatal: profile is live regardless */ }
      // Send them to the dashboard — they just finished, no need to drop them
      // straight into the edit form.
      if (typeof window !== 'undefined') window.location.href = '/dashboard'
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  // ── Photo handlers (mirror Simple Edit) ─────────────────────────────────
  // (Photo upload is now handled by the shared <PhotoPanel>; the wizard only
  // tracks the saved URL via the onPhotoSaved callback for the Review summary.)

  // Generate a bio via the AI endpoint, sending grounding facts (already
  // collected) plus the transient bio inputs. Result fills form.bio (editable).
  async function generateBio() {
    if (bioBusy) return
    setBioBusy(true); setBioError(null)
    try {
      const res = await fetch('/api/generate-bio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: form.first_name, last_name: form.last_name,
          job_title: form.job_title, company: form.company,
          city: form.city, state: form.state,
          years_experience: bioInputs.years_experience,
          who_you_help: bioInputs.who_you_help,
          focus_areas: bioInputs.focus_areas,
          whats_different: bioInputs.whats_different,
          personal_touch: bioInputs.personal_touch,
          extra_credentials: bioInputs.extra_credentials,
          talking_points: bioInputs.talking_points,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Generation failed')
      setForm(f => ({ ...f, bio: data.bio }))
    } catch (err) {
      setBioError(err.message)
    } finally {
      setBioBusy(false)
    }
  }

  // Generate a recommended, personalized non-affiliation disclosure. The result
  // fills form.financial_disclosure and is fully editable — advisors with their
  // own firm's required disclosure can replace it.
  async function generateDisclosure() {
    if (discBusy) return
    setDiscBusy(true); setDiscError(null)
    try {
      const res = await fetch('/api/generate-disclosure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ first_name: form.first_name, last_name: form.last_name, company: form.company }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Generation failed')
      setForm(f => ({ ...f, financial_disclosure: data.disclosure }))
    } catch (err) {
      setDiscError(err.message)
    } finally {
      setDiscBusy(false)
    }
  }

  const card = { background: 'white', borderRadius: '10px', border: `1px solid ${GRAY.border}`, padding: '2rem' }
  const twoCol = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }
  const btnP = (disabled) => ({ padding: '11px 26px', fontSize: '14px', fontWeight: 600, background: disabled ? GRAY.bg : NSSA.dark, color: disabled ? GRAY.text : 'white', border: 'none', borderRadius: '6px', cursor: disabled ? 'not-allowed' : 'pointer' })
  const btnS = { padding: '11px 22px', fontSize: '14px', fontWeight: 600, background: 'white', color: GRAY.dark, border: `1px solid ${GRAY.border}`, borderRadius: '6px', cursor: 'pointer' }

  return (
    <div style={card}>
      <style>{`
        @keyframes wizFadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .wiz-step { animation: wizFadeIn 0.32s ease-out; }
        @media (prefers-reduced-motion: reduce) {
          .wiz-step { animation: none; }
          .wiz-bar-fill { transition: none !important; }
        }
      `}</style>
      <ProgressBar step={step} />

      <div className="wiz-step" key={step}>
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
            <Field label="Office Phone" name="phone"        value={form.phone}        onChange={update} placeholder="(555) 555-5555" type="tel"
              hint="This is the number clients will see and use to reach you. It appears on your public profile." />
            <Field label="Mobile Phone" name="mobile_phone" value={form.mobile_phone} onChange={update} placeholder="(555) 555-5555" type="tel"
              hint="For NSSA internal use only. Never shown publicly and never shared with anyone." />
          </div>
          <div style={{ marginBottom: '1.25rem', padding: '10px 12px', background: '#eff6ff', border: `1px solid ${NSSA.light}`, borderRadius: '6px', fontSize: '12px', color: NSSA.dark, lineHeight: 1.5 }}>
            <strong>Your office phone is public</strong> — it's how clients get in touch. <strong>Your mobile phone is private</strong>, used only by NSSA to reach you, and is never displayed or shared.
          </div>
          <div style={twoCol}>
            <Field label="Website"  name="website"      value={form.website}      onChange={update} placeholder="yoursite.com" type="text" />
            <Field label="LinkedIn" name="linkedin_url" value={form.linkedin_url} onChange={update} placeholder="www.linkedin.com/in/your-name" type="text" />
          </div>
          <div style={{ padding: '10px 12px', background: GRAY.bg, border: `1px solid ${GRAY.border}`, borderRadius: '6px', fontSize: '12px', color: '#374151', lineHeight: 1.6 }}>
            <strong>How to find your LinkedIn link:</strong>
            <div style={{ marginTop: '4px' }}>
              <strong>On a computer:</strong> Go to LinkedIn, click your photo (top right) → <em>View Profile</em>. Then look at the web address bar at the very top of your browser — copy that whole address (it looks like <em>linkedin.com/in/your-name</em>) and paste it above.
            </div>
            <div style={{ marginTop: '4px' }}>
              <strong>On your phone (LinkedIn app):</strong> Tap your photo → <em>View Profile</em> → tap the <em>•••</em> (three dots) → <em>Copy profile URL</em>, then paste it above.
            </div>
            <div style={{ marginTop: '4px', color: GRAY.text }}>Don't have one or not sure? You can leave this blank.</div>
          </div>
        </div>
      )}

      {/* ── Step 4: Your Story (AI bio generation + financial disclosure) ── */}
      {step === 3 && (
        <div>
          <h2 style={{ fontSize: '18px', color: NSSA.dark, marginBottom: '6px' }}>Your professional story</h2>
          <p style={{ fontSize: '13px', color: GRAY.text, marginBottom: '1.25rem', lineHeight: 1.6 }}>
            Answer a few quick questions and we'll draft a polished, search-optimized bio for you. Short answers are fine — you can edit the result afterward.
          </p>

          <div style={twoCol}>
            <Field label="Years in the business" name="years_experience" value={bioInputs.years_experience} onChange={updateBioInput} placeholder="e.g. 15" />
            <Field label="Other credentials (CFP, ChFC, etc.)" name="extra_credentials" value={bioInputs.extra_credentials} onChange={updateBioInput} placeholder="e.g. CFP®, RICP®" />
          </div>

          <Field label="Who you primarily help" name="who_you_help" value={bioInputs.who_you_help} onChange={updateBioInput}
            placeholder="e.g. pre-retirees, business owners, federal employees, widows & widowers" />

          <Field label="Your main focus areas" name="focus_areas" value={bioInputs.focus_areas} onChange={updateBioInput}
            placeholder="e.g. Social Security timing, Medicare & IRMAA, retirement income, tax planning" />

          <Field label="What makes your approach different" name="whats_different" value={bioInputs.whats_different} onChange={updateBioInput}
            placeholder="One line on what sets your practice apart" />

          <Field label="A personal touch" name="personal_touch" value={bioInputs.personal_touch} onChange={updateBioInput}
            placeholder="Family, hometown, hobbies — anything that makes you, you" />

          <Field label="Anything else? (optional)" name="talking_points" value={bioInputs.talking_points} onChange={updateBioInput} textarea minHeight="70px"
            placeholder="Optional — any other details you'd like woven into your bio." />

          <div style={{ margin: '0.75rem 0 0.5rem' }}>
            <button type="button" onClick={generateBio} disabled={bioBusy}
              style={{ padding: '11px 24px', fontSize: '14px', fontWeight: 600, background: bioBusy ? GRAY.bg : NSSA.medium, color: bioBusy ? GRAY.text : 'white', border: 'none', borderRadius: '6px', cursor: bioBusy ? 'wait' : 'pointer' }}>
              {bioBusy ? 'Writing your bio…' : (form.bio.trim() ? '✦ Regenerate' : '✦ Generate Bio')}
            </button>
            {bioError && <p style={{ fontSize: '13px', color: RED.text, marginTop: '8px' }}>{bioError}</p>}
          </div>
          <p style={{ fontSize: '11px', color: GRAY.text, margin: '0 0 1rem', lineHeight: 1.5 }}>
            This creates a first draft from your answers. Edit it freely below — change anything you like, or rewrite it entirely.
          </p>

          <Field label="Your Bio" name="bio" value={form.bio} onChange={update} textarea minHeight="180px"
            placeholder="Your generated bio will appear here — or write your own. You can freely edit after generating." />
          <p style={{ fontSize: '11px', marginTop: '-8px', color: (form.bio || '').trim().length >= BIO_MIN ? GREEN.text : GRAY.text }}>
            {(form.bio || '').trim().length} characters{(form.bio || '').trim().length < BIO_MIN ? ` — aim for at least ${BIO_MIN}` : ' ✓'}
          </p>

          <div style={{ marginTop: '1.25rem' }}>
            <Field label="Financial Disclosure" name="financial_disclosure" value={form.financial_disclosure} onChange={update} textarea
              placeholder="e.g. Securities offered through XYZ Member FINRA/SIPC..." hint="Optional. Displayed at the bottom of your directory profile." />
            <div style={{ marginTop: '4px' }}>
              <button type="button" onClick={generateDisclosure} disabled={discBusy}
                style={{ padding: '8px 16px', fontSize: '13px', fontWeight: 600, background: discBusy ? GRAY.bg : 'white', color: discBusy ? GRAY.text : NSSA.dark, border: `1px solid ${NSSA.medium}`, borderRadius: '6px', cursor: discBusy ? 'wait' : 'pointer' }}>
                {discBusy ? 'Writing…' : '✦ Suggest a recommended disclosure'}
              </button>
              {discError && <p style={{ fontSize: '13px', color: RED.text, marginTop: '6px' }}>{discError}</p>}
              <p style={{ fontSize: '11px', color: GRAY.text, marginTop: '6px', lineHeight: 1.5 }}>
                This generates a recommended non-affiliation disclosure (not affiliated with the SSA, Medicare, CMS, or HHS). Please review it, and replace it with your firm's required disclosure if you have one.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 5: Photo ───────────────────────────────────────────────── */}
      {step === 4 && (
        <div>
          <h2 style={{ fontSize: '18px', color: NSSA.dark, marginBottom: '6px' }}>Add your photo</h2>
          <p style={{ fontSize: '13px', color: GRAY.text, marginBottom: '1.25rem', lineHeight: 1.6 }}>
            A professional photo helps clients connect with you. It's recommended but optional — you can add or change it anytime.
          </p>
          <div>
            <PhotoPanel
              userEmail={userEmail}
              initialPhoto={member.profile_photo || null}
              variant="wizard"
              onPhotoSaved={(url) => { setCurrentPhoto(url); setStep(5) }}
            />
          </div>
        </div>
      )}

      {/* ── Step 6: Review ──────────────────────────────────────────────── */}
      {step === 5 && (
        <div>
          <h2 style={{ fontSize: '18px', color: NSSA.dark, marginBottom: '1rem' }}>Review your profile</h2>
          <p style={{ fontSize: '13px', color: GRAY.text, marginBottom: '1.25rem', lineHeight: 1.6 }}>
            Here's what we have. When you finish, your profile goes live on the public NSSA® Advisor Directory and we'll email you a confirmation. You can edit it any time from your dashboard.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: currentPhoto ? '120px 1fr' : '1fr', gap: '1.5rem', alignItems: 'start' }}>
            {currentPhoto && (
              <img src={currentPhoto} alt="Your profile photo" style={{ width: '120px', height: '120px', objectFit: 'cover', objectPosition: 'top', borderRadius: '8px', border: `1px solid ${GRAY.border}` }} />
            )}
            <div style={{ fontSize: '14px', color: '#374151', lineHeight: 1.9 }}>
              <div><strong>Name:</strong> {form.first_name} {form.last_name}</div>
              {form.job_title && <div><strong>Title:</strong> {form.job_title}</div>}
              {form.company && <div><strong>Company:</strong> {form.company}</div>}
              <div><strong>Location:</strong> {[form.city, form.state].filter(Boolean).join(', ')}{form.zip ? ` ${form.zip}` : ''}</div>
              {form.phone && <div><strong>Phone:</strong> {form.phone}</div>}
              {form.website && <div><strong>Website:</strong> {form.website}</div>}
              <div><strong>Photo:</strong> {currentPhoto ? 'Added ✓' : 'Not added'}</div>
            </div>
          </div>

          {(form.bio || '').trim() && (
            <div style={{ marginTop: '1.5rem' }}>
              <p style={{ fontSize: '13px', fontWeight: 600, color: NSSA.dark, marginBottom: '6px' }}>Your bio</p>
              <div style={{ fontSize: '14px', color: '#374151', lineHeight: 1.7, background: GRAY.bg, borderRadius: '8px', padding: '1rem', whiteSpace: 'pre-wrap', maxHeight: '220px', overflowY: 'auto' }}>
                {form.bio.trim()}
              </div>
            </div>
          )}

          {(form.financial_disclosure || '').trim() && (
            <div style={{ marginTop: '1.25rem' }}>
              <p style={{ fontSize: '13px', fontWeight: 600, color: NSSA.dark, marginBottom: '6px' }}>Financial disclosure</p>
              <div style={{ fontSize: '13px', color: GRAY.text, lineHeight: 1.6, background: GRAY.bg, borderRadius: '8px', padding: '1rem', whiteSpace: 'pre-wrap' }}>
                {form.financial_disclosure.trim()}
              </div>
            </div>
          )}
        </div>
      )}
      </div>

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

export default function ProfilePage({ member, userEmail, mode, noMembership, loginEmail }) {
  if (noMembership) {
    return (
      <div style={{
        minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '2rem', fontFamily: 'system-ui, sans-serif'
      }}>
        <div style={{
          maxWidth: 540, textAlign: 'center', background: 'white',
          border: '1px solid #e5e7eb', borderRadius: 12, padding: '2.5rem 2rem'
        }}>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 600, color: '#13405E', marginBottom: '0.75rem' }}>
            We couldn&rsquo;t find your membership
          </h1>
          <p style={{ fontSize: '15px', color: '#4b5563', lineHeight: 1.6, marginBottom: '1rem' }}>
            We don&rsquo;t have an NSSA membership on file for{' '}
            <strong style={{ color: '#13405E' }}>{loginEmail || 'this email address'}</strong>.
            You may have signed in with a different email than the one associated with your
            certification.
          </p>
          <p style={{ fontSize: '15px', color: '#4b5563', lineHeight: 1.6, marginBottom: '1.5rem' }}>
            Please sign out and sign back in using the email address tied to your NSSA
            certification. If you&rsquo;re not sure which email that is, or you believe this
            is a mistake, we&rsquo;re happy to help.
          </p>
          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <a href="/login" style={{
              display: 'inline-block', background: '#1C80BC', color: 'white',
              padding: '0.6rem 1.2rem', borderRadius: 8, textDecoration: 'none', fontWeight: 600, fontSize: 14
            }}>Sign in with a different email</a>
            <a href="mailto:support@nssapros.com" style={{
              display: 'inline-block', background: 'white', color: '#1C80BC',
              border: '1px solid #1C80BC', padding: '0.6rem 1.2rem', borderRadius: 8,
              textDecoration: 'none', fontWeight: 600, fontSize: 14
            }}>Contact support</a>
          </div>
        </div>
      </div>
    )
  }

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

      <div style={{ maxWidth: mode === 'edit' ? '1040px' : '900px', margin: '0 auto', padding: '2rem' }}>
        {mode === 'edit'
          ? <SimpleEdit member={member} userEmail={userEmail} />
          : <BuildWizard member={member} userEmail={userEmail} certLabel={certLabel} />}
      </div>
    </div>
  )
}
