/**
 * /admin/kb-review/[id] — Side-by-side SME review screen
 *
 * Shows the drafted reference_page fields alongside the exact
 * source_documents.full_text for each cited section.
 * One-click Approve → status='approved' | Request Changes → status='draft'
 */
import { createServerSupabaseClient } from '@supabase/auth-helpers-nextjs'
import { createClient } from '@supabase/supabase-js'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'

const NSSA = { light: '#8ECAEE', medium: '#1C80BC', dark: '#13405E' }
const IRMAA = { light: '#ED8E8E', medium: '#DE5B63', dark: '#AF2A35' }
const GRAY = { text: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb' }

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

  const { id } = context.params

  // Fetch the reference page
  const { data: page, error: pageError } = await supabaseAdmin
    .from('reference_pages')
    .select('*')
    .eq('id', id)
    .single()

  if (pageError || !page) return { notFound: true }

  // Fetch the source documents for each cited section
  const sectionNumbers = (page.primary_sources || []).map(s => s.section_number).filter(Boolean)
  let sourceDocs = []
  if (sectionNumbers.length > 0) {
    const { data: docs } = await supabaseAdmin
      .from('source_documents')
      .select('section_number, title, full_text, source_url, last_updated, doc_kind')
      .in('section_number', sectionNumbers)
    sourceDocs = docs || []
  }

  // Build lookup: section_number → doc
  const sourceMap = {}
  for (const doc of sourceDocs) {
    sourceMap[doc.section_number] = doc
  }

  return {
    props: { page, sourceMap }
  }
}

export default function KBReviewDetail({ page, sourceMap }) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [notes, setNotes] = useState('')
  const [activeSource, setActiveSource] = useState(
    (page.primary_sources || [])[0]?.section_number || null
  )

  const categoryColor = page.category === 'irmaa' ? IRMAA.dark : NSSA.dark

  async function handleDecision(action) {
    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/kb-decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: page.id, action, notes }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Unknown error')
      router.push('/admin/kb-review')
    } catch (err) {
      alert('Error: ' + err.message)
      setSubmitting(false)
    }
  }

  const activeDoc = activeSource ? sourceMap[activeSource] : null

  return (
    <div style={{ minHeight: '100vh', background: GRAY.bg, fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>

      {/* Header */}
      <div style={{
        background: NSSA.dark, color: '#fff',
        padding: '14px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/admin/kb-review" style={{ color: '#8ECAEE', textDecoration: 'none', fontSize: 14 }}>
            ← Review Queue
          </Link>
          <span style={{ color: '#4a7fa0' }}>·</span>
          <span style={{ fontWeight: 600 }}>{page.title}</span>
          <span style={{
            background: categoryColor, color: '#fff',
            fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
            padding: '2px 8px', borderRadius: 4,
          }}>
            {page.category === 'irmaa' ? 'IRMAA' : 'Soc. Sec.'}
          </span>
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <a
            href={`https://knowledge.nssapros.com/${page.category}/${page.slug}`}
            target="_blank"
            rel="noopener"
            style={{ color: '#8ECAEE', fontSize: 13, textDecoration: 'none' }}
          >
            Preview ↗
          </a>
          <button
            onClick={() => handleDecision('changes')}
            disabled={submitting}
            style={{
              background: 'transparent', border: '1px solid #8ECAEE', color: '#8ECAEE',
              borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontSize: 14, fontWeight: 600,
            }}
          >
            Request Changes
          </button>
          <button
            onClick={() => handleDecision('approve')}
            disabled={submitting}
            style={{
              background: '#16a34a', border: 'none', color: '#fff',
              borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontSize: 14, fontWeight: 700,
            }}
          >
            {submitting ? 'Saving…' : '✓ Approve'}
          </button>
        </div>
      </div>

      {/* Body — two-column layout */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', height: 'calc(100vh - 56px)' }}>

        {/* LEFT — Drafted page content */}
        <div style={{ overflowY: 'auto', padding: 28, borderRight: `1px solid ${GRAY.border}` }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: GRAY.text, marginBottom: 20 }}>
            DRAFTED CONTENT
          </h2>

          {/* Meta */}
          <Section label="SEO title">
            <span style={{ fontSize: 14 }}>{page.seo_title}</span>
            <CharCount n={page.seo_title?.length} max={60} />
          </Section>
          <Section label="Meta description">
            <span style={{ fontSize: 14 }}>{page.meta_description}</span>
            <CharCount n={page.meta_description?.length} max={160} />
          </Section>

          {/* Quick answer */}
          <Section label="Quick answer">
            <div style={{ fontSize: 15, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: page.quick_answer }} />
          </Section>

          {/* Body sections */}
          {(page.body_sections || []).map((section, i) => (
            <Section key={i} label={`Section ${i + 1}`}>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{section.heading}</div>
              <div style={{ fontSize: 14, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: section.prose }} />
              {section.citation_ref && (
                <CitationPill
                  sectionNumber={section.citation_ref}
                  active={activeSource === section.citation_ref}
                  onClick={() => setActiveSource(section.citation_ref)}
                />
              )}
            </Section>
          ))}

          {/* Worked example */}
          {page.worked_example && (
            <Section label="Worked example">
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{page.worked_example.label}</div>
              {(page.worked_example.paragraphs || []).map((p, i) => (
                <div key={i} style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 8 }} dangerouslySetInnerHTML={{ __html: p }} />
              ))}
            </Section>
          )}

          {/* FAQ */}
          {(page.faq || []).map((item, i) => (
            <Section key={i} label={`FAQ ${i + 1}`}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{item.q}</div>
              <div style={{ fontSize: 14, lineHeight: 1.6 }}>{item.a}</div>
            </Section>
          ))}

          {/* Primary sources list */}
          <Section label="Cited sources">
            {(page.primary_sources || []).map((src, i) => (
              <button
                key={i}
                onClick={() => setActiveSource(src.section_number)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', marginBottom: 8,
                  background: activeSource === src.section_number ? '#EFF6FF' : '#fff',
                  border: `1px solid ${activeSource === src.section_number ? NSSA.medium : GRAY.border}`,
                  borderRadius: 6, padding: '10px 14px', cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600, fontSize: 13, color: NSSA.dark }}>
                  {src.section_number}
                </span>
                {' '}
                <a
                  href={src.url}
                  target="_blank"
                  rel="noopener"
                  onClick={e => e.stopPropagation()}
                  style={{ fontSize: 12, color: GRAY.text }}
                >
                  View on SSA ↗
                </a>
                {!sourceMap[src.section_number] && (
                  <span style={{ marginLeft: 8, fontSize: 12, color: '#dc2626', fontWeight: 600 }}>
                    ⚠ Not in DB
                  </span>
                )}
              </button>
            ))}
          </Section>

          {/* Notes for changes */}
          <Section label="Notes (for Request Changes)">
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Describe what needs to change…"
              rows={4}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 6,
                border: `1px solid ${GRAY.border}`, fontFamily: 'inherit', fontSize: 14,
                resize: 'vertical', boxSizing: 'border-box',
              }}
            />
          </Section>
        </div>

        {/* RIGHT — Source document text */}
        <div style={{ overflowY: 'auto', padding: 28, background: '#FFFDF5' }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: GRAY.text, marginBottom: 20 }}>
            SSA SOURCE TEXT
            {activeSource && (
              <span style={{ marginLeft: 8, fontFamily: 'ui-monospace, monospace', fontSize: 12, background: '#FEF3C7', color: '#92400E', padding: '2px 8px', borderRadius: 4, fontWeight: 600, letterSpacing: 0 }}>
                {activeSource}
              </span>
            )}
          </h2>

          {/* Source selector tabs */}
          {(page.primary_sources || []).length > 1 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
              {(page.primary_sources || []).map(src => (
                <button
                  key={src.section_number}
                  onClick={() => setActiveSource(src.section_number)}
                  style={{
                    padding: '5px 12px', borderRadius: 4, fontSize: 13, cursor: 'pointer',
                    fontFamily: 'ui-monospace, monospace', fontWeight: 600,
                    background: activeSource === src.section_number ? NSSA.dark : '#fff',
                    color: activeSource === src.section_number ? '#fff' : NSSA.dark,
                    border: `1px solid ${activeSource === src.section_number ? NSSA.dark : GRAY.border}`,
                  }}
                >
                  {src.section_number}
                </button>
              ))}
            </div>
          )}

          {!activeSource && (
            <div style={{ color: GRAY.text, fontSize: 14 }}>
              Click a cited source on the left to view its SSA source text here.
            </div>
          )}

          {activeSource && !activeDoc && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '16px 20px', color: '#991B1B' }}>
              <strong>⚠ Source not found in database</strong>
              <p style={{ margin: '8px 0 0', fontSize: 14 }}>
                Section <code>{activeSource}</code> hasn&apos;t been ingested yet. The ingest is still running — check back once it completes.
                You can still view it directly on SSA:
              </p>
              {(page.primary_sources.find(s => s.section_number === activeSource)?.url) && (
                <a
                  href={page.primary_sources.find(s => s.section_number === activeSource).url}
                  target="_blank"
                  rel="noopener"
                  style={{ color: '#991B1B', fontWeight: 600 }}
                >
                  View on policy.ssa.gov ↗
                </a>
              )}
            </div>
          )}

          {activeDoc && (
            <>
              {/* Source metadata */}
              <div style={{ background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: 6, padding: '12px 16px', marginBottom: 16, fontSize: 13 }}>
                <div style={{ fontWeight: 700, color: '#92400E', marginBottom: 4 }}>{activeDoc.title}</div>
                <div style={{ color: '#78350F' }}>
                  Last updated: <strong>{activeDoc.last_updated || 'unknown'}</strong>
                  &nbsp;&middot;&nbsp;
                  <a href={activeDoc.source_url} target="_blank" rel="noopener" style={{ color: '#92400E', fontWeight: 600 }}>
                    View on policy.ssa.gov ↗
                  </a>
                </div>
              </div>

              {/* Full source text */}
              <div style={{
                fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
                fontSize: 13, lineHeight: 1.7, color: '#1f2937',
                background: '#fff', border: `1px solid ${GRAY.border}`,
                borderRadius: 6, padding: '16px 20px',
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {activeDoc.full_text}
              </div>
            </>
          )}
        </div>

      </div>
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function Section({ label, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: GRAY.text, marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ background: '#fff', border: `1px solid ${GRAY.border}`, borderRadius: 6, padding: '12px 14px' }}>
        {children}
      </div>
    </div>
  )
}

function CharCount({ n, max }) {
  const over = n > max
  return (
    <div style={{ fontSize: 11, color: over ? '#dc2626' : GRAY.text, textAlign: 'right', marginTop: 4 }}>
      {n}/{max} chars{over ? ' — too long' : ''}
    </div>
  )
}

function CitationPill({ sectionNumber, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        marginTop: 8, padding: '3px 10px', borderRadius: 4, cursor: 'pointer',
        background: active ? '#EFF6FF' : GRAY.bg,
        border: `1px solid ${active ? NSSA.medium : GRAY.border}`,
        fontFamily: 'ui-monospace, monospace', fontSize: 12, fontWeight: 600, color: NSSA.dark,
        fontFamily: 'inherit',
      }}
    >
      Source: {sectionNumber} {active ? '← viewing' : '→ view source'}
    </button>
  )
}
