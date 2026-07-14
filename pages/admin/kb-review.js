/**
 * /admin/kb-review — Knowledge Base review queue
 * Lists reference_pages with status = 'in_review', waiting for SME approval.
 */
import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'

const NSSA = { light: '#8ECAEE', medium: '#1C80BC', dark: '#13405E' }
const IRMAA = { light: '#ED8E8E', medium: '#DE5B63', dark: '#AF2A35' }
const GRAY = { text: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' }

const STATUS_COLORS = {
  draft:     { bg: '#f3f4f6', text: '#374151', label: 'Draft' },
  in_review: { bg: '#FEF3C7', text: '#92400E', label: 'Needs Review' },
  approved:  { bg: '#D1FAE5', text: '#065F46', label: 'Approved' },
  published: { bg: '#DBEAFE', text: '#1E40AF', label: 'Published' },
  retired:   { bg: '#F3F4F6', text: '#6B7280', label: 'Retired' },
}

export async function getServerSideProps(context) {
  const supabaseServer = createServerSupabaseClient(context)
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session) return { redirect: { destination: '/login', permanent: false } }

  const isAdmin = session.user.email === 'jstanley@nssapros.com'
  if (!isAdmin) return { redirect: { destination: '/dashboard', permanent: false } }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const statusFilter = context.query.status || 'in_review'

  const { data: pages, error } = await supabaseAdmin
    .from('reference_pages')
    .select('id, slug, category, title, status, reviewer, updated_at, date_modified, primary_sources')
    .eq('status', statusFilter)
    .order('updated_at', { ascending: false })

  if (error) console.error('KB review fetch error:', error.message)

  return {
    props: {
      pages: pages || [],
      statusFilter,
    }
  }
}

export default function KBReview({ pages, statusFilter }) {
  const tabs = [
    { key: 'in_review', label: 'Needs Review' },
    { key: 'draft',     label: 'Drafts' },
    { key: 'approved',  label: 'Approved' },
    { key: 'published', label: 'Published' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: GRAY.bg, fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ background: NSSA.dark, color: '#fff', padding: '16px 32px', display: 'flex', alignItems: 'center', gap: 16 }}>
        <Link href="/admin/members" style={{ color: '#8ECAEE', textDecoration: 'none', fontSize: 14 }}>
          ← Admin
        </Link>
        <span style={{ color: '#8ECAEE' }}>/</span>
        <span style={{ fontWeight: 600, fontSize: 18 }}>Knowledge Base Review Queue</span>
      </div>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px' }}>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: `2px solid ${GRAY.border}` }}>
          {tabs.map(tab => (
            <Link
              key={tab.key}
              href={`/admin/kb-review?status=${tab.key}`}
              style={{
                padding: '10px 18px',
                fontWeight: statusFilter === tab.key ? 700 : 500,
                fontSize: 14,
                color: statusFilter === tab.key ? NSSA.dark : GRAY.text,
                textDecoration: 'none',
                borderBottom: statusFilter === tab.key ? `2px solid ${NSSA.dark}` : '2px solid transparent',
                marginBottom: -2,
                whiteSpace: 'nowrap',
              }}
            >
              {tab.label}
              {statusFilter === tab.key && (
                <span style={{
                  marginLeft: 8, background: NSSA.dark, color: '#fff',
                  borderRadius: 10, padding: '1px 8px', fontSize: 12
                }}>
                  {pages.length}
                </span>
              )}
            </Link>
          ))}
        </div>

        {/* Empty state */}
        {pages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: GRAY.text }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
            <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 4 }}>Queue is empty</div>
            <div style={{ fontSize: 14 }}>No pages with status "{statusFilter}"</div>
          </div>
        )}

        {/* Page list */}
        {pages.map(page => {
          const sc = STATUS_COLORS[page.status] || STATUS_COLORS.draft
          const categoryColor = page.category === 'irmaa' ? IRMAA.dark : NSSA.dark
          const citationCount = (page.primary_sources || []).length

          return (
            <Link key={page.id} href={`/admin/kb-review/${page.id}`} style={{ textDecoration: 'none' }}>
              <div style={{
                background: '#fff',
                border: `1px solid ${GRAY.border}`,
                borderRadius: 8,
                padding: '16px 20px',
                marginBottom: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                cursor: 'pointer',
                transition: 'box-shadow 0.15s',
              }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
              >
                {/* Category badge */}
                <span style={{
                  flex: 'none',
                  background: categoryColor,
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  padding: '3px 8px',
                  borderRadius: 4,
                  minWidth: 80,
                  textAlign: 'center',
                }}>
                  {page.category === 'irmaa' ? 'IRMAA' : 'Soc. Sec.'}
                </span>

                {/* Title + meta */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: '#111', fontSize: 15, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {page.title}
                  </div>
                  <div style={{ fontSize: 13, color: GRAY.text }}>
                    <code style={{ background: GRAY.bg, padding: '1px 5px', borderRadius: 3, marginRight: 8 }}>{page.slug}</code>
                    {citationCount} citation{citationCount !== 1 ? 's' : ''}
                    {page.reviewer && <span style={{ marginLeft: 8 }}>· {page.reviewer}</span>}
                  </div>
                </div>

                {/* Status + date */}
                <div style={{ flex: 'none', textAlign: 'right' }}>
                  <span style={{
                    background: sc.bg, color: sc.text,
                    fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 10,
                    display: 'inline-block', marginBottom: 4,
                  }}>
                    {sc.label}
                  </span>
                  <div style={{ fontSize: 12, color: GRAY.text }}>
                    {new Date(page.updated_at).toLocaleDateString()}
                  </div>
                </div>

                <span style={{ color: GRAY.text, fontSize: 18, flex: 'none' }}>›</span>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
