import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'

const NSSA  = { dark: '#13405E', medium: '#1C80BC', light: '#8ECAEE' }
const IRMAA = { dark: '#AF2A35', medium: '#DE5B63', light: '#ED8E8E' }
const GRAY  = { text: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' }
const GREEN = { bg: '#f0fdf4', text: '#15803d', border: '#bbf7d0' }

export async function getServerSideProps(context) {
  const supabaseServer = createServerSupabaseClient(context)
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session) return { redirect: { destination: '/login', permanent: false } }

  const isAdmin = session.user.email === 'jstanley@nssapros.com'
  if (!isAdmin) return { redirect: { destination: '/dashboard', permanent: false } }

  const viewEmail    = context.query.email || ''
  const selectedYear = parseInt(context.query.year) || new Date().getFullYear()
  if (!viewEmail) return { redirect: { destination: '/admin/members', permanent: false } }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data: member } = await supabaseAdmin
    .from('members').select('*').eq('email', viewEmail).single()

  const { data: subs } = await supabaseAdmin
    .from('ce_submissions').select('*').eq('email', viewEmail)
    .order('completion_date', { ascending: false })

  const years = [...new Set((subs || []).map(s => s.year).filter(Boolean))].sort((a, b) => b - a)
  const currentYear = new Date().getFullYear()
  if (!years.includes(currentYear)) years.unshift(currentYear)

  const yearSubs    = (subs || []).filter(s => s.year === selectedYear && s.status === 'approved')
  const nssaHours   = yearSubs.filter(s => s.designation === 'NSSA'  || s.designation === 'both').reduce((sum, s) => sum + Number(s.hours_earned), 0)
  const irmaaHours  = yearSubs.filter(s => s.designation === 'IRMAA' || s.designation === 'both').reduce((sum, s) => sum + Number(s.hours_earned), 0)
  const certYear    = (d) => d ? new Date(d).getFullYear() : null
  const nssaExempt  = certYear(member?.nssa_cert_date)  === selectedYear
  const irmaaExempt = certYear(member?.irmaa_cert_date) === selectedYear
  const nssaStatus  = !member?.nssa_certified ? 'na' : nssaExempt  ? 'exempt' : nssaHours  >= 4 ? 'met' : nssaHours  > 0 ? 'progress' : 'unstarted'
  const irmaaStatus = !member?.irmaa_certified ? 'na' : irmaaExempt ? 'exempt' : irmaaHours >= 4 ? 'met' : irmaaHours > 0 ? 'progress' : 'unstarted'
  const daysLeft    = Math.ceil((new Date(`${selectedYear}-12-31`) - new Date()) / (1000 * 60 * 60 * 24))

  return {
    props: {
      member: member ? JSON.parse(JSON.stringify(member)) : null,
      subs: JSON.parse(JSON.stringify(subs || [])),
      viewEmail, selectedYear, availableYears: years,
      nssaHours: nssaExempt ? 4 : nssaHours, irmaaHours: irmaaExempt ? 4 : irmaaHours,
      nssaStatus, irmaaStatus, daysLeft,
    }
  }
}

function StatusPill({ status, hours }) {
  const map = {
    met:       { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0', label: '✓ Met' },
    exempt:    { bg: '#eff6ff', color: NSSA.medium, border: NSSA.light, label: '✓ Exempt' },
    progress:  { bg: '#fef9c3', color: '#854d0e', border: '#fde68a', label: `${hours} / 4 hrs` },
    unstarted: { bg: '#fef2f2', color: '#dc2626', border: '#fecaca', label: '0 / 4 hrs' },
    na:        { bg: GRAY.bg, color: GRAY.text, border: GRAY.border, label: '—' },
  }
  const s = map[status] || map.na
  return (
    <span style={{ fontSize: '11px', padding: '3px 10px', borderRadius: '99px', background: s.bg, color: s.color, border: `1px solid ${s.border}`, fontWeight: 500 }}>
      {s.label}
    </span>
  )
}

function Input({ label, value, onChange, textarea, hint }) {
  const base = { width: '100%', padding: '7px 10px', fontSize: '13px', border: `1px solid ${GRAY.border}`, borderRadius: '5px', outline: 'none', boxSizing: 'border-box', fontFamily: 'system-ui, sans-serif', background: 'white' }
  return (
    <div style={{ marginBottom: '10px' }}>
      <label style={{ display: 'block', fontSize: '11px', fontWeight: 500, color: GRAY.text, marginBottom: '3px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</label>
      {textarea
        ? <textarea value={value || ''} onChange={onChange} style={{ ...base, minHeight: '120px', resize: 'vertical' }} />
        : <input value={value || ''} onChange={onChange} style={base} />
      }
      {hint && <p style={{ fontSize: '11px', color: GRAY.text, marginTop: '2px' }}>{hint}</p>}
    </div>
  )
}

export default function MemberView({ member: initialMember, subs, viewEmail, selectedYear, availableYears, nssaHours, irmaaHours, nssaStatus, irmaaStatus, daysLeft }) {
  const router = useRouter()
  const [member, setMember] = useState(initialMember)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    first_name: initialMember?.first_name || '',
    last_name: initialMember?.last_name || '',
    job_title: initialMember?.job_title || '',
    company: initialMember?.company || '',
    address: initialMember?.address || '',
    city: initialMember?.city || '',
    state: initialMember?.state || '',
    zip: initialMember?.zip || '',
    phone: initialMember?.phone || '',
    website: initialMember?.website || '',
    bio: initialMember?.bio || '',
    financial_disclosure: initialMember?.financial_disclosure || '',
  })
  const [saving, setSaving]     = useState(false)
  const [saveMsg, setSaveMsg]   = useState(null)
  const [yearFilter, setYearFilter] = useState('all')

  if (!member) return (
    <div style={{ padding: '3rem', textAlign: 'center', fontFamily: 'system-ui, sans-serif' }}>
      <p style={{ color: GRAY.text }}>Member not found for {viewEmail}</p>
      <Link href="/admin/members" style={{ color: NSSA.medium }}>← Back</Link>
    </div>
  )

  const fullName = [member.first_name, member.last_name].filter(Boolean).join(' ') || viewEmail
  const filteredSubs = yearFilter === 'all' ? subs : subs.filter(s => String(s.year) === yearFilter)
  const td = { padding: '10px 14px', fontSize: '13px', verticalAlign: 'middle', borderTop: `1px solid ${GRAY.bg}` }

  function handle(field) {
    return e => setForm(f => ({ ...f, [field]: e.target.value }))
  }

  async function handleSave() {
    setSaving(true)
    setSaveMsg(null)
    try {
      const res = await fetch('/api/admin/save-member', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: viewEmail, ...form })
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Save failed')
      // Update local member state so display reflects changes immediately
      setMember(m => ({ ...m, ...form }))
      setEditing(false)
      setSaveMsg('Saved!')
      setTimeout(() => setSaveMsg(null), 3000)
    } catch (err) {
      setSaveMsg('Error: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  function handleCancel() {
    setForm({
      first_name: member.first_name || '', last_name: member.last_name || '',
      job_title: member.job_title || '', company: member.company || '',
      address: member.address || '', city: member.city || '',
      state: member.state || '', zip: member.zip || '',
      phone: member.phone || '', website: member.website || '',
      bio: member.bio || '', financial_disclosure: member.financial_disclosure || '',
    })
    setEditing(false)
  }

  function statusColor(s) {
    if (s === 'approved') return { bg: '#f0fdf4', color: '#15803d', border: '#bbf7d0' }
    if (s === 'rejected') return { bg: '#fef2f2', color: '#dc2626', border: '#fecaca' }
    return { bg: '#fef9c3', color: '#854d0e', border: '#fde68a' }
  }

  const twoCol = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }
  const threeCol = { display: 'grid', gridTemplateColumns: '1fr 80px 100px', gap: '0 1rem' }

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', fontFamily: 'system-ui, sans-serif' }}>

      {/* Admin nav */}
      <div style={{ background: 'white', borderBottom: `1px solid ${GRAY.border}`, padding: '0.75rem 2rem', display: 'flex', alignItems: 'center', gap: '12px' }}>
        <Link href="/admin/members" style={{ fontSize: '13px', color: NSSA.medium, textDecoration: 'none' }}>← All Members</Link>
        <span style={{ color: GRAY.border }}>|</span>
        <span style={{ fontSize: '13px', color: GRAY.text }}>{fullName}</span>
        <span style={{ marginLeft: 'auto', fontSize: '11px', padding: '2px 8px', borderRadius: '4px', background: member.is_active !== false ? '#f0fdf4' : GRAY.bg, color: member.is_active !== false ? '#15803d' : GRAY.text, border: `1px solid ${member.is_active !== false ? '#bbf7d0' : GRAY.border}` }}>
          {member.is_active !== false ? 'Active' : 'Inactive'}
        </span>
      </div>

      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '2rem' }}>

        {/* Header */}
        <div style={{ background: 'white', border: `1px solid ${GRAY.border}`, borderRadius: '10px', padding: '1.5rem 2rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: 700, color: '#111', marginBottom: '4px' }}>{fullName}</h1>
            <p style={{ fontSize: '13px', color: GRAY.text }}>{viewEmail}</p>
          </div>
          <img src="/nssa-irmaa-logos.png" alt="NSSA IRMAA" style={{ height: '48px', width: 'auto' }} />
        </div>

        {/* CE Requirements */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '11px', fontWeight: 600, color: GRAY.text, textTransform: 'uppercase', letterSpacing: '0.08em' }}>CE Requirements — {selectedYear}</h2>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            {daysLeft > 0 && daysLeft < 365 && (
              <span style={{ fontSize: '12px', color: daysLeft < 60 ? '#dc2626' : GRAY.text, background: daysLeft < 60 ? '#fef2f2' : GRAY.bg, padding: '3px 10px', borderRadius: '99px', border: `1px solid ${daysLeft < 60 ? '#fecaca' : GRAY.border}` }}>
                {daysLeft} days remaining
              </span>
            )}
            <select value={selectedYear}
              onChange={e => router.push(`/admin/member-view?email=${encodeURIComponent(viewEmail)}&year=${e.target.value}`)}
              style={{ fontSize: '13px', padding: '5px 10px', borderRadius: '6px', border: `1px solid ${GRAY.border}`, background: 'white' }}>
              {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '2rem' }}>
          {member.nssa_certified ? (
            <div style={{ background: 'white', border: `2px solid ${nssaStatus === 'met' || nssaStatus === 'exempt' ? NSSA.medium : nssaStatus === 'unstarted' ? '#fecaca' : '#fde68a'}`, borderRadius: '10px', padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <span style={{ fontSize: '13px', color: GRAY.text }}>NSSA® CE Requirement</span>
                <StatusPill status={nssaStatus} hours={nssaHours} />
              </div>
              <p style={{ fontSize: '32px', fontWeight: 700, color: nssaStatus === 'met' || nssaStatus === 'exempt' ? NSSA.dark : nssaStatus === 'unstarted' ? '#dc2626' : '#854d0e', marginBottom: '6px' }}>
                {nssaHours} <span style={{ fontSize: '14px', fontWeight: 400, color: GRAY.text }}>/ 4 hrs</span>
              </p>
              <div style={{ background: GRAY.bg, borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(100, (nssaHours / 4) * 100)}%`, background: nssaStatus === 'met' || nssaStatus === 'exempt' ? NSSA.medium : '#f59e0b', borderRadius: '4px' }} />
              </div>
            </div>
          ) : (
            <div style={{ background: 'white', border: `1px solid ${GRAY.border}`, borderRadius: '10px', padding: '1.5rem' }}>
              <p style={{ fontWeight: 600, marginBottom: '6px' }}>Not NSSA® Certified</p>
              <p style={{ fontSize: '13px', color: GRAY.text, marginBottom: '1rem' }}>Member has not enrolled in the NSSA® program.</p>
              <a href="https://nssapros.com/nssa-course" target="_blank" rel="noopener noreferrer" style={{ display: 'block', textAlign: 'center', padding: '8px', background: NSSA.dark, color: 'white', borderRadius: '6px', fontSize: '12px', fontWeight: 500, textDecoration: 'none' }}>
                Enroll in NSSA® — 50% off
              </a>
            </div>
          )}

          {member.irmaa_certified ? (
            <div style={{ background: 'white', border: `2px solid ${irmaaStatus === 'met' || irmaaStatus === 'exempt' ? IRMAA.medium : irmaaStatus === 'unstarted' ? '#fecaca' : '#fde68a'}`, borderRadius: '10px', padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                <span style={{ fontSize: '13px', color: GRAY.text }}>IRMAACP™ CE Requirement</span>
                <StatusPill status={irmaaStatus} hours={irmaaHours} />
              </div>
              <p style={{ fontSize: '32px', fontWeight: 700, color: irmaaStatus === 'met' || irmaaStatus === 'exempt' ? IRMAA.dark : irmaaStatus === 'unstarted' ? '#dc2626' : '#854d0e', marginBottom: '6px' }}>
                {irmaaHours} <span style={{ fontSize: '14px', fontWeight: 400, color: GRAY.text }}>/ 4 hrs</span>
              </p>
              <div style={{ background: GRAY.bg, borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
                <div style={{ height: '100%', width: `${Math.min(100, (irmaaHours / 4) * 100)}%`, background: irmaaStatus === 'met' || irmaaStatus === 'exempt' ? IRMAA.medium : '#f59e0b', borderRadius: '4px' }} />
              </div>
            </div>
          ) : (
            <div style={{ background: 'white', border: `1px solid ${GRAY.border}`, borderRadius: '10px', padding: '1.5rem' }}>
              <p style={{ fontWeight: 600, marginBottom: '6px' }}>Not IRMAACP™ Certified</p>
              <p style={{ fontSize: '13px', color: GRAY.text, marginBottom: '1rem' }}>Member has not enrolled in the IRMAACP™ program.</p>
              <a href="https://nssapros.com/irmaa-course" target="_blank" rel="noopener noreferrer" style={{ display: 'block', textAlign: 'center', padding: '8px', background: IRMAA.dark, color: 'white', borderRadius: '6px', fontSize: '12px', fontWeight: 500, textDecoration: 'none' }}>
                Enroll in IRMAACP™ — 50% off
              </a>
            </div>
          )}
        </div>

        {/* ── Member Profile — editable ────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '11px', fontWeight: 600, color: GRAY.text, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Member Profile</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {saveMsg && (
              <span style={{ fontSize: '12px', color: saveMsg.startsWith('Error') ? '#dc2626' : GREEN.text, background: saveMsg.startsWith('Error') ? '#fef2f2' : GREEN.bg, border: `1px solid ${saveMsg.startsWith('Error') ? '#fecaca' : GREEN.border}`, padding: '4px 10px', borderRadius: '6px' }}>
                {saveMsg}
              </span>
            )}
            {!editing ? (
              <button onClick={() => setEditing(true)}
                style={{ fontSize: '12px', padding: '5px 14px', borderRadius: '6px', border: `1px solid ${GRAY.border}`, background: 'white', cursor: 'pointer', fontWeight: 500, color: '#374151' }}>
                ✏ Edit
              </button>
            ) : (
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={handleCancel} disabled={saving}
                  style={{ fontSize: '12px', padding: '5px 14px', borderRadius: '6px', border: `1px solid ${GRAY.border}`, background: 'white', cursor: 'pointer', color: GRAY.text }}>
                  Cancel
                </button>
                <button onClick={handleSave} disabled={saving}
                  style={{ fontSize: '12px', padding: '5px 14px', borderRadius: '6px', border: 'none', background: NSSA.dark, color: 'white', cursor: saving ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: saving ? 0.7 : 1 }}>
                  {saving ? 'Saving…' : 'Save Changes'}
                </button>
              </div>
            )}
          </div>
        </div>

        <div style={{ background: 'white', border: `1px solid ${editing ? NSSA.medium : GRAY.border}`, borderRadius: '10px', padding: '1.5rem', marginBottom: '2rem', transition: 'border-color 0.2s' }}>

          {editing ? (
            /* ── Edit mode ───────────────────────────────────────────────── */
            <>
              <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
                {/* Photo (display only in admin edit) */}
                <div style={{ flexShrink: 0 }}>
                  {member.profile_photo ? (
                    <img src={member.profile_photo} alt={fullName}
                      style={{ width: '100px', height: '103px', objectFit: 'cover', objectPosition: 'top', borderRadius: '8px', border: `1px solid ${GRAY.border}` }} />
                  ) : (
                    <div style={{ width: '100px', height: '103px', borderRadius: '8px', background: NSSA.dark, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '32px', fontWeight: 700 }}>
                      {member.first_name?.[0] || '?'}
                    </div>
                  )}
                  <p style={{ fontSize: '10px', color: GRAY.text, textAlign: 'center', marginTop: '4px' }}>Photo via portal</p>
                </div>

                <div style={{ flex: 1 }}>
                  <div style={twoCol}>
                    <Input label="First Name" value={form.first_name} onChange={handle('first_name')} />
                    <Input label="Last Name"  value={form.last_name}  onChange={handle('last_name')} />
                  </div>
                  <div style={twoCol}>
                    <Input label="Job Title" value={form.job_title} onChange={handle('job_title')} />
                    <Input label="Company"   value={form.company}   onChange={handle('company')} />
                  </div>
                  <div style={twoCol}>
                    <Input label="Phone"   value={form.phone}   onChange={handle('phone')} />
                    <Input label="Website" value={form.website} onChange={handle('website')} />
                  </div>
                </div>
              </div>

              <Input label="Street Address" value={form.address} onChange={handle('address')} />
              <div style={threeCol}>
                <Input label="City"  value={form.city}  onChange={handle('city')} />
                <Input label="State" value={form.state} onChange={handle('state')} />
                <Input label="Zip"   value={form.zip}   onChange={handle('zip')} />
              </div>

              <Input label="Bio (HTML supported)" value={form.bio} onChange={handle('bio')} textarea
                hint="HTML tags like <p> are rendered on the profile page." />
              <Input label="Financial Disclosure" value={form.financial_disclosure} onChange={handle('financial_disclosure')} textarea />
            </>
          ) : (
            /* ── View mode ───────────────────────────────────────────────── */
            <>
              <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'flex-start', marginBottom: member.bio || member.financial_disclosure || member.address ? '1.25rem' : 0 }}>
                <div style={{ flexShrink: 0 }}>
                  {member.profile_photo ? (
                    <img src={member.profile_photo} alt={fullName}
                      style={{ width: '130px', height: '134px', objectFit: 'cover', objectPosition: 'top', borderRadius: '8px', border: `1px solid ${GRAY.border}` }} />
                  ) : (
                    <div style={{ width: '130px', height: '134px', borderRadius: '8px', background: NSSA.dark, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '40px', fontWeight: 700 }}>
                      {member.first_name?.[0] || '?'}
                    </div>
                  )}
                </div>

                <div style={{ flex: 1 }}>
                  <h3 style={{ fontSize: '20px', fontWeight: 700, color: '#111', marginBottom: '3px' }}>{fullName}</h3>
                  {(member.job_title || member.company) && (
                    <p style={{ fontSize: '13px', color: GRAY.text, marginBottom: '2px' }}>
                      {[member.job_title, member.company].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  {(member.city || member.state) && (
                    <p style={{ fontSize: '12px', color: GRAY.text, marginBottom: '10px' }}>
                      {[member.city, member.state].filter(Boolean).join(', ')}
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px' }}>
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
                  <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '12px', color: GRAY.text }}>{viewEmail}</span>
                    {member.phone && <span style={{ fontSize: '12px', color: GRAY.text }}>📞 {member.phone}</span>}
                    {member.website && (
                      <a href={member.website} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px', color: NSSA.medium, textDecoration: 'none' }}>
                        🌐 {member.website.replace(/^https?:\/\//, '')}
                      </a>
                    )}
                  </div>
                </div>
              </div>

              {member.bio && (
                <div style={{ borderTop: `1px solid ${GRAY.bg}`, paddingTop: '1.25rem' }}>
                  <p style={{ fontSize: '11px', fontWeight: 600, color: GRAY.text, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>Bio</p>
                  <div style={{ fontSize: '13px', color: '#374151', lineHeight: 1.7, maxWidth: '700px' }}
                    dangerouslySetInnerHTML={{ __html: member.bio }} />
                </div>
              )}

              {member.financial_disclosure && (
                <div style={{ borderTop: `1px solid ${GRAY.bg}`, paddingTop: '1rem', marginTop: '1rem' }}>
                  <p style={{ fontSize: '11px', fontWeight: 600, color: GRAY.text, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Financial Disclosure</p>
                  <p style={{ fontSize: '11px', color: GRAY.text, fontStyle: 'italic', lineHeight: 1.6 }}>{member.financial_disclosure}</p>
                </div>
              )}

              {(member.address || member.city) && (
                <div style={{ borderTop: `1px solid ${GRAY.bg}`, paddingTop: '1rem', marginTop: '1rem' }}>
                  <p style={{ fontSize: '11px', fontWeight: 600, color: GRAY.text, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Address</p>
                  <p style={{ fontSize: '13px', color: '#374151' }}>
                    {[member.address, member.city, member.state, member.zip].filter(Boolean).join(', ')}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* CE Submission History */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
          <h2 style={{ fontSize: '11px', fontWeight: 600, color: GRAY.text, textTransform: 'uppercase', letterSpacing: '0.08em' }}>CE Submission History</h2>
          <select value={yearFilter} onChange={e => setYearFilter(e.target.value)}
            style={{ fontSize: '13px', padding: '5px 10px', borderRadius: '6px', border: `1px solid ${GRAY.border}`, background: 'white' }}>
            <option value="all">All years</option>
            {availableYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <div style={{ background: 'white', border: `1px solid ${GRAY.border}`, borderRadius: '10px', overflow: 'hidden', marginBottom: '1.5rem' }}>
          {filteredSubs.length === 0 ? (
            <p style={{ padding: '2.5rem', textAlign: 'center', color: GRAY.text, fontSize: '13px' }}>No submissions found.</p>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#1a1a1a' }}>
                  {['Date', 'Course Title', 'CE Type', 'Hours', 'Designation', 'Source', 'Status'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: 500, color: 'white', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredSubs.map((s, i) => {
                  const sc = statusColor(s.status)
                  return (
                    <tr key={s.id} style={{ background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                      <td style={td}>{s.completion_date ? new Date(s.completion_date).toLocaleDateString() : '—'}</td>
                      <td style={{ ...td, fontWeight: 500, maxWidth: '240px' }}>
                        {s.course_title || '—'}
                        {s.notes && <p style={{ fontSize: '11px', color: GRAY.text, margin: '2px 0 0' }}>{s.notes}</p>}
                      </td>
                      <td style={td}>{s.ce_type || '—'}</td>
                      <td style={{ ...td, fontWeight: 600 }}>{s.hours_earned}</td>
                      <td style={td}>
                        <span style={{ fontSize: '11px', padding: '2px 6px', borderRadius: '4px', background: s.designation === 'NSSA' ? '#eff6ff' : s.designation === 'IRMAA' ? '#fef2f2' : '#f5f3ff', color: s.designation === 'NSSA' ? NSSA.medium : s.designation === 'IRMAA' ? IRMAA.dark : '#7c3aed' }}>
                          {s.designation || '—'}
                        </span>
                      </td>
                      <td style={{ ...td, fontSize: '11px', color: GRAY.text, textTransform: 'capitalize' }}>{s.source || '—'}</td>
                      <td style={td}>
                        <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '99px', background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`, fontWeight: 500, textTransform: 'capitalize' }}>
                          {s.status}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Record Details */}
        <div style={{ background: 'white', border: `1px solid ${GRAY.border}`, borderRadius: '10px', padding: '1.25rem' }}>
          <h3 style={{ fontSize: '11px', fontWeight: 600, color: GRAY.text, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '1rem' }}>Record Details</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
            {[
              ['Email', viewEmail],
              ['NSSA Cert Date',  member.nssa_cert_date  ? new Date(member.nssa_cert_date).toLocaleDateString()  : '—'],
              ['IRMAA Cert Date', member.irmaa_cert_date ? new Date(member.irmaa_cert_date).toLocaleDateString() : '—'],
              ['NSSA #',  member.nssa_number  || '—'],
              ['IRMAA #', member.irmaa_number || '—'],
              ['Org',     member.org_id       || '—'],
            ].map(([lbl, val]) => (
              <div key={lbl}>
                <p style={{ fontSize: '11px', fontWeight: 500, color: GRAY.text, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '3px' }}>{lbl}</p>
                <p style={{ fontSize: '13px', color: '#111' }}>{val}</p>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}
