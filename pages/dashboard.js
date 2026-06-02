import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'

const NSSA  = { dark: '#13405E', medium: '#1C80BC', light: '#8ECAEE' }
const IRMAA = { dark: '#AF2A35', medium: '#DE5B63', light: '#ED8E8E' }
const GRAY  = { text: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' }
const GREEN = { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' }
const RED   = { bg: '#fef2f2', text: '#dc2626', border: '#fecaca' }

// Strip HTML tags so legacy bios stored with <p>...</p> don't render as
// literal text in the plain-text textarea / display. Collapses block tags
// to newlines, removes the rest, and decodes a few common entities.
function stripHtml(str) {
  if (!str) return ''
  return str
    .replace(/<\/(p|div|br)\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
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
    .select('email, first_name, last_name, nssa_certified, irmaa_certified, nssa_cert_date, irmaa_cert_date, nssa_number, irmaa_number, profile_photo, job_title, company, address, city, state, zip, phone, website, bio, financial_disclosure, is_active')
    .eq('email', session.user.email)
    .single()

  // Guard: must be a certified, active member
  if (!member || (!member.nssa_certified && !member.irmaa_certified)) {
    await supabaseServer.auth.signOut()
    return { redirect: { destination: '/login?error=not_authorized', permanent: false } }
  }

  const selectedYear = parseInt(context.query.year) || new Date().getFullYear()

  // CE submissions for selected year
  const { data: subs } = await supabaseAdmin
    .from('ce_submissions')
    .select('*')
    .eq('email', session.user.email)
    .order('completion_date', { ascending: false })

  const years = [...new Set((subs || []).map(r => r.year).filter(Boolean))].sort((a, b) => b - a)
  const currentYear = new Date().getFullYear()
  if (!years.includes(currentYear)) years.unshift(currentYear)

  const yearSubs = (subs || []).filter(s => s.year === selectedYear && s.status === 'approved')
  const nssaHours  = yearSubs.filter(s => s.designation === 'NSSA'  || s.designation === 'both').reduce((sum, s) => sum + Number(s.hours_earned), 0)
  const irmaaHours = yearSubs.filter(s => s.designation === 'IRMAA' || s.designation === 'both').reduce((sum, s) => sum + Number(s.hours_earned), 0)

  const certYear = (d) => d ? new Date(d).getFullYear() : null
  const nssaExempt  = certYear(member.nssa_cert_date)  === selectedYear
  const irmaaExempt = certYear(member.irmaa_cert_date) === selectedYear

  const nssaStatus = !member.nssa_certified ? 'na'
    : nssaExempt  ? 'exempt'
    : nssaHours  >= 4 ? 'met'
    : nssaHours  > 0  ? 'progress'
    : 'unstarted'

  const irmaaStatus = !member.irmaa_certified ? 'na'
    : irmaaExempt ? 'exempt'
    : irmaaHours >= 4 ? 'met'
    : irmaaHours > 0  ? 'progress'
    : 'unstarted'

  const daysLeft = Math.ceil((new Date(`${selectedYear}-12-31`) - new Date()) / (1000 * 60 * 60 * 24))

  return {
    props: {
      member: JSON.parse(JSON.stringify(member)),
      subs: JSON.parse(JSON.stringify(subs || [])),
      selectedYear,
      availableYears: years,
      currentYear,
      nssaHours: nssaExempt ? 4 : nssaHours,
      irmaaHours: irmaaExempt ? 4 : irmaaHours,
      nssaStatus,
      irmaaStatus,
      daysLeft,
      userEmail: session.user.email,
    }
  }
}

function StatusPill({ status, hours }) {
  const map = {
    met:       { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0', label: '✓ Requirement Met' },
    exempt:    { bg: '#eff6ff', color: NSSA.medium, border: NSSA.light, label: '✓ Exempt — new cert' },
    progress:  { bg: '#fef9c3', color: '#854d0e', border: '#fde68a', label: 'In progress' },
    unstarted: { bg: '#fef2f2', color: '#dc2626', border: '#fecaca', label: 'Not started' },
    na:        { bg: GRAY.bg,   color: GRAY.text,  border: GRAY.border, label: 'Not enrolled' },
  }
  const s = map[status] || map.na
  return (
    <span style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '99px', background: s.bg, color: s.color, border: `1px solid ${s.border}`, fontWeight: 500 }}>
      {s.label}
    </span>
  )
}

// ── Inline profile form helpers (ported from /profile/edit) ───────────────
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

export default function Dashboard({ member, subs, selectedYear, availableYears, currentYear, nssaHours, irmaaHours, nssaStatus, irmaaStatus, daysLeft, userEmail }) {
  const router = useRouter()
  const [yearFilter, setYearFilter] = useState(selectedYear)

  const filteredSubs = subs.filter(s => s.year === yearFilter)
  const isAdmin = userEmail === 'jstanley@nssapros.com'

  // ── Profile form state (seeded from SSR member props) ───────────────────
  const [form, setForm] = useState({
    first_name:           member.first_name           || '',
    last_name:            member.last_name            || '',
    job_title:            member.job_title            || '',
    company:              member.company              || '',
    address:              member.address              || '',
    city:                 member.city                 || '',
    state:                member.state                || '',
    zip:                  member.zip                  || '',
    phone:                member.phone                || '',
    website:              member.website              || '',
    bio:                  stripHtml(member.bio)       || '',
    financial_disclosure: member.financial_disclosure || '',
  })

  const [dirty, setDirty]     = useState(false)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [saveError, setSaveError] = useState(null)

  // ── Photo state ─────────────────────────────────────────────────────────
  const fileInputRef = useRef(null)
  const [currentPhoto, setCurrentPhoto] = useState(member.profile_photo || null)
  const [selectedFile, setSelectedFile] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [photoLoading, setPhotoLoading] = useState(null) // 'asis' | 'ai' | null
  const [photoSuccess, setPhotoSuccess] = useState(null)
  const [photoError, setPhotoError]     = useState(null)

  // ── Unsaved-changes guard ────────────────────────────────────────────────
  // Browser/tab close + hard reload
  useEffect(() => {
    function handleBeforeUnload(e) {
      if (!dirty) return
      e.preventDefault()
      e.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [dirty])

  // In-app Next.js navigation (Dashboard link, Admin link, etc.)
  useEffect(() => {
    function handleRouteChange() {
      if (!dirty) return
      if (!window.confirm('You have unsaved profile changes. Leave anyway?')) {
        router.events.emit('routeChangeError')
        // Abort the route change
        throw 'routeChange aborted by unsaved-changes guard'
      }
    }
    router.events.on('routeChangeStart', handleRouteChange)
    return () => router.events.off('routeChangeStart', handleRouteChange)
  }, [dirty, router.events])

  function handleChange(e) {
    const { name, value } = e.target
    setForm(f => ({ ...f, [name]: value }))
    setDirty(true)
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
      setDirty(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 4000)
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  function statusColor(s) {
    if (s === 'approved') return { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' }
    if (s === 'rejected') return { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' }
    return { bg: '#fef9c3', color: '#854d0e', border: '#fde68a' }
  }

  const td = { padding: '10px 14px', fontSize: '13px', verticalAlign: 'middle', borderTop: `1px solid ${GRAY.bg}` }

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
          <img src="/nssa-irmaa-logos.png" alt="NSSA IRMAA logos" style={{ height: '40px', width: 'auto' }} />
          <div>
            <h1 style={{ fontSize: '16px', fontWeight: 700, color: '#111' }}>Member Dashboard</h1>
            <p style={{ fontSize: '12px', color: GRAY.text }}>Welcome back, {member.first_name || 'Member'}</p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {isAdmin && (
            <Link href="/admin/members" style={{ fontSize: '12px', color: NSSA.medium, textDecoration: 'none', fontWeight: 500 }}>
              Admin →
            </Link>
          )}
          <span style={{ fontSize: '12px', color: GRAY.text }}>{userEmail}</span>
          <Link href="/api/auth/signout" style={{ fontSize: '12px', color: GRAY.text, textDecoration: 'none', padding: '5px 10px', border: `1px solid ${GRAY.border}`, borderRadius: '5px' }}>
            Sign out
          </Link>
        </div>
      </div>

      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem' }}>

        {/* CE Requirements Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '11px', fontWeight: 600, color: GRAY.text, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            CE Requirements — {selectedYear}
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {daysLeft > 0 && daysLeft < 365 && (
              <span style={{ fontSize: '12px', color: daysLeft < 60 ? '#dc2626' : GRAY.text, background: daysLeft < 60 ? '#fef2f2' : GRAY.bg, padding: '3px 10px', borderRadius: '99px', border: `1px solid ${daysLeft < 60 ? '#fecaca' : GRAY.border}` }}>
                {daysLeft} days remaining in {selectedYear}
              </span>
            )}
          </div>
        </div>

        {/* CE Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>

          {/* NSSA CE Card */}
          {member.nssa_certified && (
            <div style={{ background: 'white', border: `2px solid ${nssaStatus === 'met' || nssaStatus === 'exempt' ? NSSA.medium : nssaStatus === 'unstarted' ? '#fecaca' : '#fde68a'}`, borderRadius: '10px', padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <span style={{ fontSize: '13px', color: GRAY.text }}>NSSA® CE Requirement</span>
                <StatusPill status={nssaStatus} hours={nssaHours} />
              </div>
              <p style={{ fontSize: '32px', fontWeight: 700, color: nssaStatus === 'met' || nssaStatus === 'exempt' ? NSSA.dark : nssaStatus === 'unstarted' ? '#dc2626' : '#854d0e', marginBottom: '6px' }}>
                {nssaHours} <span style={{ fontSize: '14px', fontWeight: 400, color: GRAY.text }}>/ 4 hrs</span>
              </p>
              <p style={{ fontSize: '12px', color: GRAY.text, marginBottom: '12px' }}>
                {nssaHours} of 4 hours completed &nbsp; {Math.round((nssaHours / 4) * 100)}%
              </p>
              <div style={{ background: GRAY.bg, borderRadius: '4px', height: '6px', overflow: 'hidden', marginBottom: '1rem' }}>
                <div style={{ height: '100%', width: `${Math.min(100, (nssaHours / 4) * 100)}%`, background: nssaStatus === 'met' || nssaStatus === 'exempt' ? NSSA.medium : '#f59e0b', borderRadius: '4px' }} />
              </div>
              {nssaStatus !== 'met' && nssaStatus !== 'exempt' && (
                <Link href="/ce/submit?designation=NSSA" style={{ display: 'block', textAlign: 'center', padding: '9px', background: NSSA.dark, color: 'white', borderRadius: '6px', fontSize: '13px', fontWeight: 500, textDecoration: 'none' }}>
                  + Submit NSSA® CE
                </Link>
              )}
            </div>
          )}

          {/* IRMAA CE Card */}
          {member.irmaa_certified && (
            <div style={{ background: 'white', border: `2px solid ${irmaaStatus === 'met' || irmaaStatus === 'exempt' ? IRMAA.medium : irmaaStatus === 'unstarted' ? '#fecaca' : '#fde68a'}`, borderRadius: '10px', padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <span style={{ fontSize: '13px', color: GRAY.text }}>IRMAACP™ CE Requirement</span>
                <StatusPill status={irmaaStatus} hours={irmaaHours} />
              </div>
              <p style={{ fontSize: '32px', fontWeight: 700, color: irmaaStatus === 'met' || irmaaStatus === 'exempt' ? IRMAA.dark : irmaaStatus === 'unstarted' ? '#dc2626' : '#854d0e', marginBottom: '6px' }}>
                {irmaaHours} <span style={{ fontSize: '14px', fontWeight: 400, color: GRAY.text }}>/ 4 hrs</span>
              </p>
              <p style={{ fontSize: '12px', color: GRAY.text, marginBottom: '12px' }}>
                {irmaaHours} of 4 hours completed &nbsp; {Math.round((irmaaHours / 4) * 100)}%
              </p>
              <div style={{ background: GRAY.bg, borderRadius: '4px', height: '6px', overflow: 'hidden', marginBottom: '1rem' }}>
                <div style={{ height: '100%', width: `${Math.min(100, (irmaaHours / 4) * 100)}%`, background: irmaaStatus === 'met' || irmaaStatus === 'exempt' ? IRMAA.medium : '#f59e0b', borderRadius: '4px' }} />
              </div>
              {irmaaStatus !== 'met' && irmaaStatus !== 'exempt' && (
                <Link href="/ce/submit?designation=IRMAA" style={{ display: 'block', textAlign: 'center', padding: '9px', background: IRMAA.dark, color: 'white', borderRadius: '6px', fontSize: '13px', fontWeight: 500, textDecoration: 'none' }}>
                  + Submit IRMAACP™ CE
                </Link>
              )}
            </div>
          )}

          {/* Enrollment CTAs for non-certified designations */}
          {!member.nssa_certified && (
            <div style={{ background: 'white', border: `1px solid ${GRAY.border}`, borderRadius: '10px', padding: '1.5rem' }}>
              <p style={{ fontWeight: 600, marginBottom: '6px' }}>Earn Your NSSA® Designation</p>
              <p style={{ fontSize: '13px', color: GRAY.text, marginBottom: '1rem' }}>Get certified and join 1,700+ NSSA® advisors.</p>
              <a href="https://nssapros.com/nssa-course" style={{ display: 'block', textAlign: 'center', padding: '9px', background: NSSA.dark, color: 'white', borderRadius: '6px', fontSize: '13px', fontWeight: 500, textDecoration: 'none' }}>
                Enroll — 50% off
              </a>
            </div>
          )}

          {!member.irmaa_certified && (
            <div style={{ background: 'white', border: `1px solid ${GRAY.border}`, borderRadius: '10px', padding: '1.5rem' }}>
              <p style={{ fontWeight: 600, marginBottom: '6px' }}>Earn Your IRMAACP™ Designation</p>
              <p style={{ fontSize: '13px', color: GRAY.text, marginBottom: '1rem' }}>Add IRMAA expertise to your practice.</p>
              <a href="https://nssapros.com/irmaa-course" style={{ display: 'block', textAlign: 'center', padding: '9px', background: IRMAA.dark, color: 'white', borderRadius: '6px', fontSize: '13px', fontWeight: 500, textDecoration: 'none' }}>
                Enroll — 50% off
              </a>
            </div>
          )}
        </div>

        {/* CE Submission History */}
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '11px', fontWeight: 600, color: GRAY.text, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              CE Submission History
            </h2>
            <select
              value={yearFilter}
              onChange={e => setYearFilter(parseInt(e.target.value))}
              style={{ fontSize: '13px', padding: '5px 10px', borderRadius: '6px', border: `1px solid ${GRAY.border}`, background: 'white' }}
            >
              {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>

          <div style={{ background: 'white', border: `1px solid ${GRAY.border}`, borderRadius: '10px', overflow: 'hidden' }}>
            <div style={{ padding: '10px 14px', fontSize: '12px', color: GRAY.text, borderBottom: `1px solid ${GRAY.bg}`, display: 'flex', justifyContent: 'space-between' }}>
              <span>{yearFilter} Submissions</span>
              <span style={{ color: GRAY.text }}>Pending submissions reviewed within 48 hours</span>
            </div>

            {filteredSubs.length === 0 ? (
              <div style={{ padding: '2.5rem', textAlign: 'center' }}>
                <p style={{ color: GRAY.text, fontSize: '13px', marginBottom: '1rem' }}>No CE submissions for {yearFilter}.</p>
                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                  {member.nssa_certified && (
                    <Link href="/ce/submit?designation=NSSA" style={{ fontSize: '13px', color: NSSA.medium, textDecoration: 'none', fontWeight: 500 }}>
                      + Submit NSSA® CE
                    </Link>
                  )}
                  {member.irmaa_certified && (
                    <Link href="/ce/submit?designation=IRMAA" style={{ fontSize: '13px', color: IRMAA.medium, textDecoration: 'none', fontWeight: 500 }}>
                      + Submit IRMAACP™ CE
                    </Link>
                  )}
                </div>
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#fafafa' }}>
                    {['Date', 'Course Title', 'CE Type', 'Hours', 'Designation', 'Status'].map(h => (
                      <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 600, color: GRAY.text, borderBottom: `1px solid ${GRAY.border}` }}>{h}</th>
                    ))}
                    <th style={{ padding: '9px 14px', borderBottom: `1px solid ${GRAY.border}` }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSubs.map(s => {
                    const sc = statusColor(s.status)
                    return (
                      <tr key={s.id}>
                        <td style={td}>{s.completion_date ? new Date(s.completion_date).toLocaleDateString() : '—'}</td>
                        <td style={{ ...td, fontWeight: 500, maxWidth: '220px' }}>{s.course_title || '—'}</td>
                        <td style={td}>{s.ce_type || '—'}</td>
                        <td style={{ ...td, fontWeight: 600 }}>{s.hours_earned}</td>
                        <td style={td}>
                          <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: s.designation === 'NSSA' ? '#eff6ff' : s.designation === 'IRMAA' ? '#fef2f2' : '#f5f3ff', color: s.designation === 'NSSA' ? NSSA.medium : s.designation === 'IRMAA' ? IRMAA.dark : '#7c3aed' }}>
                            {s.designation}
                          </span>
                        </td>
                        <td style={td}>
                          <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '99px', background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`, fontWeight: 500, textTransform: 'capitalize' }}>
                            {s.status}
                          </span>
                        </td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          {s.status === 'pending' && (
                            <Link href={`/ce/edit/${s.id}`} style={{ fontSize: '12px', color: GRAY.text, textDecoration: 'none' }}>Edit</Link>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* ── Member Profile (inline editable) ─────────────────────────────── */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
            <h2 style={{ fontSize: '11px', fontWeight: 600, color: GRAY.text, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Member Profile
            </h2>

            {/* Cert badges (read-only) */}
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {member.nssa_certified && (
                <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#eff6ff', color: NSSA.medium, border: `1px solid ${NSSA.light}` }}>
                  NSSA® Certified{member.nssa_number ? ` #${member.nssa_number}` : ''}
                </span>
              )}
              {member.irmaa_certified && (
                <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: '#fef2f2', color: IRMAA.dark, border: `1px solid ${IRMAA.light}` }}>
                  IRMAACP™ Certified{member.irmaa_number ? ` #${member.irmaa_number}` : ''}
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: '1.5rem', alignItems: 'start' }}>

            {/* LEFT: editable form */}
            <form onSubmit={handleSave}>
              <div style={{ background: 'white', borderRadius: '10px', border: `1px solid ${GRAY.border}`, padding: '1.5rem' }}>

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
                  {dirty && !saving && !saved && (
                    <span style={{ fontSize: '12px', color: GRAY.text }}>Unsaved changes</span>
                  )}
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

            {/* RIGHT: photo panel (sticky) */}
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
        </div>

      </div>
    </div>
  )
}
