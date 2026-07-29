/**
 * /admin/blog-review/[slug] — Per-post claim review
 * Shows all extracted claims with verdicts + controls to resolve them.
 * Admin only: jstanley@nssapros.com
 */
import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/router'

const ADMIN_EMAIL = 'jstanley@nssapros.com'

const VERDICT = {
  verified:    { bg: '#D1FAE5', text: '#065F46',  label: 'Verified',    icon: '✅' },
  unsupported: { bg: '#FEF3C7', text: '#92400E',  label: 'Unsupported', icon: '🟡' },
  mismatch:    { bg: '#FEE2E2', text: '#991B1B',  label: 'Mismatch',    icon: '🔴' },
  superseded:  { bg: '#F3E8FF', text: '#6B21A8',  label: 'Superseded',  icon: '🟣' },
  unchecked:   { bg: '#F3F4F6', text: '#6B7280',  label: 'Unchecked',   icon: '⬜' },
}

const TRIAGE = ['keep','fix','archive','retire']
const TRIAGE_COLORS = {
  keep:    { bg: '#D1FAE5', text: '#065F46' },
  fix:     { bg: '#DBEAFE', text: '#1E40AF' },
  archive: { bg: '#FEF3C7', text: '#92400E' },
  retire:  { bg: '#FEE2E2', text: '#991B1B' },
}

const S = {
  container: { maxWidth: 900, margin: '0 auto', padding: '32px 24px', fontFamily: 'system-ui, sans-serif' },
  back:      { fontSize: 13, color: '#13405E', textDecoration: 'none', display: 'inline-block', marginBottom: 20 },
  title:     { fontSize: 22, fontWeight: 700, color: '#111827', marginBottom: 4 },
  slug:      { fontSize: 12, color: '#9ca3af', marginBottom: 24, fontFamily: 'monospace' },
  section:   { marginBottom: 32 },
  sectionH:  { fontSize: 13, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 },
  card:      { border: '1px solid #e5e7eb', borderRadius: 10, padding: 18, marginBottom: 12, background: 'white' },
  badge:     (v) => ({
    display: 'inline-block', padding: '3px 10px', borderRadius: 10,
    fontSize: 11, fontWeight: 700,
    background: VERDICT[v]?.bg || '#f3f4f6',
    color: VERDICT[v]?.text || '#374151',
    marginBottom: 8,
  }),
  claimText: { fontSize: 14, color: '#1f2937', lineHeight: 1.6, marginBottom: 8, fontStyle: 'italic' },
  meta:      { fontSize: 12, color: '#6b7280', marginBottom: 6 },
  note:      { fontSize: 12, color: '#374151', background: '#f9fafb', borderRadius: 6, padding: '8px 12px', marginTop: 8 },
  controls:  { display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' },
  btn:       (active, color) => ({
    padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
    cursor: 'pointer', border: `1px solid ${active ? color : '#e5e7eb'}`,
    background: active ? color : 'white', color: active ? 'white' : '#374151',
    transition: 'all 0.15s',
  }),
  saveBtn:   { padding: '6px 16px', background: '#13405E', color: 'white', border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  textarea:  { width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 6, resize: 'vertical', minHeight: 60, boxSizing: 'border-box', marginTop: 8 },
  triageBar: { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '16px 20px', background: '#f9fafb', borderRadius: 10, marginBottom: 28 },
  triageL:   { fontSize: 13, fontWeight: 600, color: '#374151', marginRight: 4 },
}

function ClaimCard({ claim, onUpdate }) {
  const [editing, setEditing]     = useState(false)
  const [newVerdict, setVerdict]  = useState(claim.verdict)
  const [note, setNote]           = useState(claim.sme_note || '')
  const [saving, setSaving]       = useState(false)
  const v = VERDICT[claim.verdict] || VERDICT.unchecked

  async function save() {
    setSaving(true)
    await fetch('/api/admin/blog-claim-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: claim.id, verdict: newVerdict, sme_note: note }),
    })
    onUpdate(claim.id, newVerdict, note)
    setEditing(false)
    setSaving(false)
  }

  return (
    <div style={{ ...S.card, borderLeft: `3px solid ${VERDICT[editing ? newVerdict : claim.verdict]?.text || '#e5e7eb'}` }}>
      <span style={S.badge(editing ? newVerdict : claim.verdict)}>
        {VERDICT[editing ? newVerdict : claim.verdict]?.icon} {VERDICT[editing ? newVerdict : claim.verdict]?.label}
        {claim.claim_type && <span style={{ marginLeft: 6, fontWeight: 400, opacity: 0.8 }}>· {claim.claim_type}</span>}
      </span>

      <p style={S.claimText}>"{claim.claim_text}"</p>

      {claim.stated_value && (
        <p style={S.meta}>Stated value: <strong>{claim.stated_value}</strong></p>
      )}
      {claim.kb_source_ref && (
        <p style={S.meta}>
          KB source: <strong>{claim.kb_source_ref}</strong>
          {claim.kb_source_url && (
            <> · <a href={claim.kb_source_url} target="_blank" rel="noopener noreferrer" style={{ color: '#13405E' }}>view →</a></>
          )}
        </p>
      )}
      {claim.retrieved_text && (
        <p style={S.note}>📄 {claim.retrieved_text}</p>
      )}
      {(claim.sme_note && !editing) && (
        <p style={{ ...S.note, background: '#eff6ff', color: '#1d4ed8' }}>💬 {claim.sme_note}</p>
      )}

      {!editing ? (
        <div style={S.controls}>
          <button style={S.btn(false, '#13405E')} onClick={() => setEditing(true)}>Edit verdict</button>
        </div>
      ) : (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 8, fontWeight: 600 }}>Update verdict:</div>
          <div style={S.controls}>
            {Object.entries(VERDICT).filter(([k]) => k !== 'unchecked').map(([k, val]) => (
              <button key={k} style={S.btn(newVerdict===k, val.text)} onClick={() => setVerdict(k)}>
                {val.icon} {val.label}
              </button>
            ))}
          </div>
          <textarea
            style={S.textarea}
            placeholder="SME note (optional — explain resolution)"
            value={note}
            onChange={e => setNote(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button style={S.saveBtn} onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button style={{ ...S.btn(false, '#e5e7eb'), fontSize: 12 }} onClick={() => { setEditing(false); setVerdict(claim.verdict); setNote(claim.sme_note||'') }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function PostReview({ post, claims: initialClaims }) {
  const router = useRouter()
  const [claims, setClaims]     = useState(initialClaims)
  const [triage, setTriage]     = useState(post.triage_bucket || null)
  const [triageSaving, setSaving] = useState(false)

  function handleClaimUpdate(id, verdict, note) {
    setClaims(prev => prev.map(c => c.id === id ? { ...c, verdict, sme_note: note } : c))
  }

  async function saveTriage(bucket) {
    setSaving(true)
    setTriage(bucket)
    await fetch('/api/admin/blog-post-update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: post.id, triage_bucket: bucket }),
    })
    setSaving(false)
  }

  const blockers = claims.filter(c => c.verdict === 'mismatch' || c.verdict === 'superseded')
  const others   = claims.filter(c => c.verdict !== 'mismatch' && c.verdict !== 'superseded')

  return (
    <div style={S.container}>
      <Link href="/admin/blog-review" style={S.back}>← All posts</Link>
      <h1 style={S.title}>{post.title}</h1>
      <p style={S.slug}>{post.slug}</p>

      {/* Triage controls */}
      <div style={S.triageBar}>
        <span style={S.triageL}>Triage:</span>
        {TRIAGE.map(t => {
          const c = TRIAGE_COLORS[t]
          return (
            <button key={t} style={S.btn(triage===t, c.text)} onClick={() => saveTriage(t)}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          )
        })}
        {triage && (
          <button style={{ ...S.btn(false,'#e5e7eb'), fontSize:12 }} onClick={() => saveTriage(null)}>Clear</button>
        )}
        {triageSaving && <span style={{ fontSize: 12, color: '#9ca3af' }}>Saving…</span>}
        <a
          href={`https://blog-nssapros.vercel.app/blog/${post.slug}`}
          target="_blank" rel="noopener noreferrer"
          style={{ marginLeft: 'auto', fontSize: 12, color: '#13405E' }}
        >
          Preview post →
        </a>
      </div>

      {/* Blockers */}
      {blockers.length > 0 && (
        <div style={S.section}>
          <div style={S.sectionH}>🔴 Blockers — {blockers.length} claim{blockers.length !== 1 ? 's' : ''} need resolution</div>
          {blockers.map(c => <ClaimCard key={c.id} claim={c} onUpdate={handleClaimUpdate} />)}
        </div>
      )}

      {/* Other claims */}
      {others.length > 0 && (
        <div style={S.section}>
          <div style={S.sectionH}>Other claims ({others.length})</div>
          {others.map(c => <ClaimCard key={c.id} claim={c} onUpdate={handleClaimUpdate} />)}
        </div>
      )}

      {claims.length === 0 && (
        <p style={{ color: '#9ca3af', textAlign: 'center', padding: '40px 0' }}>No claims extracted for this post.</p>
      )}
    </div>
  )
}

export async function getServerSideProps(context) {
  const supabaseServer = createServerSupabaseClient(context)
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session) return { redirect: { destination: '/login', permanent: false } }
  if (session.user.email !== ADMIN_EMAIL) return { notFound: true }

  const { slug } = context.params
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  const { data: post } = await sb
    .from('blog_posts')
    .select('id,slug,title,triage_bucket,review_status,meta_description,legacy_published_at')
    .eq('slug', slug)
    .single()

  if (!post) return { notFound: true }

  const { data: claims } = await sb
    .from('blog_post_claims')
    .select('id,claim_text,claim_type,stated_value,verdict,kb_source_ref,kb_source_url,retrieved_text,sme_note')
    .eq('post_id', post.id)
    .order('verdict')  // blockers (mismatch/superseded) sort first alphabetically

  // Sort so mismatch + superseded appear first
  const ORDER = { mismatch: 0, superseded: 1, unsupported: 2, verified: 3, unchecked: 4 }
  const sorted = (claims || []).sort((a, b) => (ORDER[a.verdict]??9) - (ORDER[b.verdict]??9))

  return { props: { post, claims: sorted } }
}
