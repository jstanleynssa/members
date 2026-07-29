/**
 * /admin/blog-review — Blog content review queue
 * Shows all 170 posts with claim verification verdicts.
 * Allows filtering by blocker status and updating triage bucket.
 * Admin only: jstanley@nssapros.com
 */
import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'
import { useState } from 'react'

const ADMIN_EMAIL = 'jstanley@nssapros.com'

const VERDICT_COLORS = {
  verified:    { bg: '#D1FAE5', text: '#065F46' },
  unsupported: { bg: '#FEF3C7', text: '#92400E' },
  mismatch:    { bg: '#FEE2E2', text: '#991B1B' },
  superseded:  { bg: '#F3E8FF', text: '#6B21A8' },
}

const TRIAGE_COLORS = {
  keep:        { bg: '#D1FAE5', text: '#065F46', label: 'Keep' },
  fix:         { bg: '#DBEAFE', text: '#1E40AF', label: 'Fix' },
  archive:     { bg: '#FEF3C7', text: '#92400E', label: 'Archive' },
  retire:      { bg: '#FEE2E2', text: '#991B1B', label: 'Retire' },
  null:        { bg: '#F3F4F6', text: '#6B7280', label: 'Unset' },
}

const STYLES = {
  container: { maxWidth: 1100, margin: '0 auto', padding: '32px 24px', fontFamily: 'system-ui, sans-serif' },
  header:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32 },
  title:     { fontSize: 22, fontWeight: 700, color: '#111827', margin: 0 },
  subtitle:  { fontSize: 13, color: '#6b7280', marginTop: 4 },
  filters:   { display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' },
  pill:      (active) => ({
    padding: '5px 14px', borderRadius: 20, fontSize: 12, fontWeight: 600,
    cursor: 'pointer', border: 'none',
    background: active ? '#13405E' : '#f3f4f6',
    color: active ? '#fff' : '#374151',
  }),
  table:     { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th:        { textAlign: 'left', padding: '10px 12px', borderBottom: '2px solid #e5e7eb', color: '#6b7280', fontWeight: 600, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' },
  td:        { padding: '10px 12px', borderBottom: '1px solid #f3f4f6', verticalAlign: 'middle' },
  badge:     (color) => ({ display: 'inline-block', padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600, background: color.bg, color: color.text }),
  link:      { color: '#13405E', textDecoration: 'none', fontWeight: 500 },
  count:     (n, type) => ({
    display: 'inline-block', width: 24, height: 24, borderRadius: '50%', lineHeight: '24px',
    textAlign: 'center', fontSize: 11, fontWeight: 700,
    background: n > 0 ? VERDICT_COLORS[type].bg : '#f3f4f6',
    color: n > 0 ? VERDICT_COLORS[type].text : '#9ca3af',
  }),
  summary:   { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 },
  card:      (color) => ({ background: color.bg, borderRadius: 10, padding: '16px 20px', borderLeft: `4px solid ${color.text}` }),
  cardN:     (color) => ({ fontSize: 26, fontWeight: 800, color: color.text, marginBottom: 2 }),
  cardL:     { fontSize: 12, color: '#6b7280', fontWeight: 500 },
}

export default function BlogReview({ posts, counts }) {
  const [filter, setFilter] = useState('all')
  const [triage, setTriage]  = useState('all')
  const [sortCol, setSortCol] = useState('mismatch')
  const [sortDir, setSortDir] = useState('desc')

  function handleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir(col === 'title' ? 'asc' : 'desc') }
  }

  function sortIndicator(col) {
    if (sortCol !== col) return <span style={{ color: '#d1d5db', marginLeft: 4 }}>↕</span>
    return <span style={{ marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>
  }

  const filtered = posts
    .filter(p => {
      const hasBlocker = p.mismatch > 0 || p.superseded > 0
      if (filter === 'blockers' && !hasBlocker) return false
      if (filter === 'clean' && hasBlocker) return false
      if (triage !== 'all' && (p.triage_bucket || 'null') !== triage) return false
      return true
    })
    .sort((a, b) => {
      let aVal = a[sortCol] ?? ''
      let bVal = b[sortCol] ?? ''
      if (sortCol === 'triage_bucket') { aVal = a.triage_bucket || ''; bVal = b.triage_bucket || '' }
      const cmp = typeof aVal === 'number' ? aVal - bVal : String(aVal).localeCompare(String(bVal))
      return sortDir === 'asc' ? cmp : -cmp
    })

  return (
    <div style={STYLES.container}>
      <div style={STYLES.header}>
        <div>
          <h1 style={STYLES.title}>Blog Content Review</h1>
          <p style={STYLES.subtitle}>
            {posts.length} posts · {counts.mismatch} mismatches · {counts.superseded} superseded · {counts.blockerPosts} posts need attention
          </p>
        </div>
        <Link href="/admin/members" style={{ ...STYLES.link, fontSize: 13 }}>← Admin</Link>
      </div>

      {/* Summary cards */}
      <div style={STYLES.summary}>
        {[
          { label: 'Verified claims',    n: counts.verified,    color: { bg: '#D1FAE5', text: '#065F46' } },
          { label: 'Unsupported claims', n: counts.unsupported, color: { bg: '#FEF9C3', text: '#854D0E' } },
          { label: 'Mismatches',         n: counts.mismatch,    color: { bg: '#FEE2E2', text: '#991B1B' } },
          { label: 'Superseded',         n: counts.superseded,  color: { bg: '#F3E8FF', text: '#6B21A8' } },
        ].map(({ label, n, color }) => (
          <div key={label} style={STYLES.card(color)}>
            <div style={STYLES.cardN(color)}>{n}</div>
            <div style={STYLES.cardL}>{label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={STYLES.filters}>
        <span style={{ fontSize: 12, color: '#9ca3af', lineHeight: '28px', marginRight: 4 }}>Status:</span>
        {[['all','All posts'],['blockers','🔴 Blockers only'],['clean','✅ Clean']].map(([v,l]) => (
          <button key={v} style={STYLES.pill(filter===v)} onClick={() => setFilter(v)}>{l}</button>
        ))}
        <span style={{ fontSize: 12, color: '#9ca3af', lineHeight: '28px', margin: '0 4px 0 12px' }}>Triage:</span>
        {[['all','All'],['null','Unset'],['keep','Keep'],['fix','Fix'],['archive','Archive'],['retire','Retire']].map(([v,l]) => (
          <button key={v} style={STYLES.pill(triage===v)} onClick={() => setTriage(v)}>{l}</button>
        ))}
      </div>

      <p style={{ fontSize: 12, color: '#9ca3af', marginBottom: 12 }}>{filtered.length} posts shown</p>

      {/* Table */}
      <table style={STYLES.table}>
        <thead>
          <tr>
            <th style={STYLES.th} onClick={() => handleSort('title')}>Post{sortIndicator('title')}</th>
            <th style={{ ...STYLES.th, textAlign: 'center' }} onClick={() => handleSort('verified')}>✅{sortIndicator('verified')}</th>
            <th style={{ ...STYLES.th, textAlign: 'center' }} onClick={() => handleSort('unsupported')}>🟡{sortIndicator('unsupported')}</th>
            <th style={{ ...STYLES.th, textAlign: 'center' }} onClick={() => handleSort('mismatch')}>🔴 Mismatch{sortIndicator('mismatch')}</th>
            <th style={{ ...STYLES.th, textAlign: 'center' }} onClick={() => handleSort('superseded')}>🟣 Superseded{sortIndicator('superseded')}</th>
            <th style={STYLES.th} onClick={() => handleSort('triage_bucket')}>Triage{sortIndicator('triage_bucket')}</th>
            <th style={{ ...STYLES.th, cursor: 'default' }}></th>
          </tr>
        </thead>
        <tbody>
          {filtered.map(p => {
            const hasBlocker = p.mismatch > 0 || p.superseded > 0
            const tColor = TRIAGE_COLORS[p.triage_bucket || 'null']
            return (
              <tr key={p.id} style={{ background: hasBlocker ? '#fffbfb' : 'white' }}>
                <td style={STYLES.td}>
                  <Link href={`/admin/blog-review/${p.slug}`} style={STYLES.link}>
                    {p.title}
                  </Link>
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{p.slug}</div>
                </td>
                {['verified','unsupported','mismatch','superseded'].map(v => (
                  <td key={v} style={{ ...STYLES.td, textAlign: 'center' }}>
                    {p[v] > 0 ? (
                      <span style={STYLES.count(p[v], v)}>{p[v]}</span>
                    ) : (
                      <span style={{ color: '#d1d5db' }}>—</span>
                    )}
                  </td>
                ))}
                <td style={STYLES.td}>
                  <span style={STYLES.badge(tColor)}>{tColor.label}</span>
                </td>
                <td style={{ ...STYLES.td, whiteSpace: 'nowrap' }}>
                  <Link href={`/admin/blog-review/${p.slug}`} style={{ ...STYLES.link, fontSize: 12 }}>
                    Review →
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {filtered.length === 0 && (
        <p style={{ textAlign: 'center', color: '#9ca3af', padding: '40px 0' }}>No posts match this filter.</p>
      )}
    </div>
  )
}

export async function getServerSideProps(context) {
  const supabaseServer = createServerSupabaseClient(context)
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session) return { redirect: { destination: '/login', permanent: false } }
  if (session.user.email !== ADMIN_EMAIL) return { notFound: true }

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  // Get all posts
  const { data: posts } = await sb
    .from('blog_posts')
    .select('id,slug,title,triage_bucket,review_status')
    .in('status', ['imported','published'])
    .order('title')

  // Get claim counts grouped by post + verdict
  const { data: claims } = await sb
    .from('blog_post_claims')
    .select('post_id, verdict')

  // Aggregate
  const claimMap = {}
  ;(claims || []).forEach(c => {
    if (!claimMap[c.post_id]) claimMap[c.post_id] = { verified: 0, unsupported: 0, mismatch: 0, superseded: 0 }
    claimMap[c.post_id][c.verdict] = (claimMap[c.post_id][c.verdict] || 0) + 1
  })

  const enriched = (posts || []).map(p => ({
    ...p,
    verified:    claimMap[p.id]?.verified    || 0,
    unsupported: claimMap[p.id]?.unsupported || 0,
    mismatch:    claimMap[p.id]?.mismatch    || 0,
    superseded:  claimMap[p.id]?.superseded  || 0,
  }))

  const totals = { verified: 0, unsupported: 0, mismatch: 0, superseded: 0, blockerPosts: 0 }
  enriched.forEach(p => {
    totals.verified    += p.verified
    totals.unsupported += p.unsupported
    totals.mismatch    += p.mismatch
    totals.superseded  += p.superseded
    if (p.mismatch > 0 || p.superseded > 0) totals.blockerPosts++
  })

  return { props: { posts: enriched, counts: totals } }
}
