/**
 * /admin/kb-review — Knowledge Base review queue
 * Accessible to: jstanley@nssapros.com (admin) + anyone in kb_reviewers table
 * Filters: status (in_review / draft / approved / published) + category (all / SS / IRMAA)
 */
import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import Link from 'next/link'

const NSSA  = { light: '#8ECAEE', medium: '#1C80BC', dark: '#13405E' }
const IRMAA = { light: '#ED8E8E', medium: '#DE5B63', dark: '#AF2A35' }
const GRAY  = { text: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' }

const STATUS_COLORS = {
  draft:      { bg: '#f3f4f6', text: '#374151', label: 'Draft' },
  in_review:  { bg: '#FEF3C7', text: '#92400E', label: 'Needs Review' },
  approved:   { bg: '#D1FAE5', text: '#065F46', label: 'Approved' },
  published:  { bg: '#DBEAFE', text: '#1E40AF', label: 'Published' },
  superseded: { bg: '#FEE2E2', text: '#7F1D1D', label: 'Superseded' },
  retired:    { bg: '#F3F4F6', text: '#6B7280', label: 'Retired' },
}

const ADMIN_EMAIL = 'jstanley@nssapros.com'

export async function getServerSideProps(context) {
  const supabaseServer = createServerSupabaseClient(context)
  const { data: { session } } = await supabaseServer.auth.getSession()
  if (!session) return { redirect: { destination: '/login', permanent: false } }

  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const isAdmin = session.user.email === ADMIN_EMAIL

  // Check if logged-in user is a registered reviewer
  const { data: reviewerRow } = await supabaseAdmin
    .from('kb_reviewers')
    .select('display_name, active')
    .eq('email', session.user.email)
    .single()

  const isReviewer = !!(reviewerRow?.active)

  if (!isAdmin && !isReviewer) {
    return { redirect: { destination: '/dashboard', permanent: false } }
  }

  const reviewer = {
    email: session.user.email,
    displayName: isAdmin ? 'Jason Stanley' : reviewerRow.display_name,
    isAdmin,
  }

  const statusFilter   = context.query.status   || 'in_review'
  const categoryFilter = context.query.category || 'all'

  let query = supabaseAdmin
    .from('reference_pages')
    .select('id, slug, category, title, status, reviewer, approved_by, approved_at, updated_at, primary_sources')
    .eq('status', statusFilter)
    .order('updated_at', { ascending: false })

  if (categoryFilter !== 'all') {
    query = query.eq('category', categoryFilter)
  }

  const { data: pages, error } = await query
  if (error) console.error('KB review fetch error:', error.message)

  return {
    props: { pages: pages || [], statusFilter, categoryFilter, reviewer }
  }
}

export default function KBReview({ pages, statusFilter, categoryFilter, reviewer }) {
  const statusTabs = [
    { key: 'in_review', label: 'Needs Review' },
    { key: 'draft',     label: 'Drafts' },
    { key: 'approved',  label: 'Approved' },
    { key: 'published', label: 'Published' },
  ]

  const categoryTabs = [
    { key: 'all',              label: 'All' },
    { key: 'social-security',  label: 'Social Security' },
    { key: 'irmaa',            label: 'IRMAA' },
  ]

  function tabHref(overrides) {
    const params = new URLSearchParams({
      status:   statusFilter,
      category: categoryFilter,
      ...overrides,
    })
    return `/admin/kb-review?${params}`
  }

  return (
    <div style={{ minHeight: '100vh', background: GRAY.bg, fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      {/* Header */}
      <div style={{ background: NSSA.dark, color: '#fff', padding: '16px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {reviewer.isAdmin && (
            <Link href="/admin/members" style={{ color: '#8ECAEE', textDecoration: 'none', fontSize: 14 }}>← Admin</Link>
          )}
          {reviewer.isAdmin && <span style={{ color: '#8ECAEE' }}>/</span>}
          <span style={{ fontWeight: 600, fontSize: 18 }}>Knowledge Base Review</span>
        </div>
        <span style={{ fontSize: 13, color: '#8ECAEE' }}>
          Reviewing as <strong style={{ color: '#fff' }}>{reviewer.displayName}</strong>
        </span>
      </div>

      <div style={{ maxWidth: 1000, margin: '0 auto', padding: '28px 24px' }}>

        {/* Status tabs */}
        <div style={{ display: 'flex', gap: 4, borderBottom: `2px solid ${GRAY.border}`, marginBottom: 16 }}>
          {statusTabs.map(tab => {
            const active = statusFilter === tab.key
            return (
              <Link key={tab.key} href={tabHref({ status: tab.key })}
                style={{ padding: '10px 18px', fontWeight: active ? 700 : 500, fontSize: 14, color: active ? NSSA.dark : GRAY.text, textDecoration: 'none', borderBottom: active ? `2px solid ${NSSA.dark}` : '2px solid transparent', marginBottom: -2, whiteSpace: 'nowrap' }}>
                {tab.label}
              </Link>
            )
          })}
        </div>

        {/* Category filter pills */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 24, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: GRAY.text, fontWeight: 600, marginRight: 4 }}>FILTER:</span>
          {categoryTabs.map(tab => {
            const active = categoryFilter === tab.key
            const color = tab.key === 'irmaa' ? IRMAA.dark : NSSA.dark
            return (
              <Link key={tab.key} href={tabHref({ category: tab.key })}
                style={{
                  padding: '5px 14px', borderRadius: 20, fontSize: 13, fontWeight: active ? 700 : 500,
                  textDecoration: 'none',
                  background: active ? color : '#fff',
                  color: active ? '#fff' : GRAY.text,
                  border: `1px solid ${active ? color : GRAY.border}`,
                }}>
                {tab.label}
                {active && pages.length > 0 && (
                  <span style={{ marginLeft: 6, background: 'rgba(255,255,255,0.25)', borderRadius: 10, padding: '0px 6px', fontSize: 11 }}>
                    {pages.length}
                  </span>
                )}
              </Link>
            )
          })}
        </div>

        {/* Empty state */}
        {pages.length === 0 && (
          <div style={{ textAlign: 'center', padding: '60px 0', color: GRAY.text }}>
            <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
            <div style={{ fontWeight: 600, fontSize: 18, marginBottom: 4 }}>Queue is empty</div>
            <div style={{ fontSize: 14 }}>No {categoryFilter !== 'all' ? categoryFilter + ' ' : ''}pages with status "{statusFilter}"</div>
          </div>
        )}

        {/* Page list */}
        {pages.map(page => {
          const sc = STATUS_COLORS[page.status] || STATUS_COLORS.draft
          const categoryColor = page.category === 'irmaa' ? IRMAA.dark : NSSA.dark
          const citationCount = (page.primary_sources || []).length

          return (
            <Link key={page.id} href={`/admin/kb-review/${page.id}`} style={{ textDecoration: 'none' }}>
              <div
                style={{ background: '#fff', border: `1px solid ${GRAY.border}`, borderRadius: 8, padding: '16px 20px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 16, cursor: 'pointer' }}
                onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'}
                onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
              >
                <span style={{ flex: 'none', background: categoryColor, color: '#fff', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 4, minWidth: 80, textAlign: 'center' }}>
                  {page.category === 'irmaa' ? 'IRMAA' : 'Soc. Sec.'}
                </span>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, color: '#111', fontSize: 15, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {page.title}
                  </div>
                  <div style={{ fontSize: 13, color: GRAY.text }}>
                    <code style={{ background: GRAY.bg, padding: '1px 5px', borderRadius: 3, marginRight: 8 }}>{page.slug}</code>
                    {citationCount} citation{citationCount !== 1 ? 's' : ''}
                    {page.approved_by
                      ? <span style={{ marginLeft: 8, color: '#059669' }}>· ✓ {page.approved_by}</span>
                      : page.reviewer
                      ? <span style={{ marginLeft: 8 }}>· for {page.reviewer}</span>
                      : null}
                  </div>
                </div>

                <div style={{ flex: 'none', textAlign: 'right' }}>
                  <span style={{ background: sc.bg, color: sc.text, fontSize: 12, fontWeight: 600, padding: '3px 10px', borderRadius: 10, display: 'inline-block', marginBottom: 4 }}>
                    {sc.label}
                  </span>
                  <div style={{ fontSize: 12, color: GRAY.text }}>
                    {page.approved_at
                      ? new Date(page.approved_at).toLocaleDateString()
                      : new Date(page.updated_at).toLocaleDateString()}
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
