/**
 * /admin/kb-review/[id] — Side-by-side SME review screen
 *
 * Left panel: drafted content (read-only view, or full edit modal via "Make Changes")
 * Right panel: actual SSA POMS source text for each cited section
 *
 * Actions: Make Changes (edit modal) | Approve | Mark Superseded
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
  const { data: page, error } = await supabaseAdmin
    .from('reference_pages')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !page) return { notFound: true }

  const sectionNumbers = (page.primary_sources || []).map(s => s.section_number).filter(Boolean)
  let sourceDocs = []
  if (sectionNumbers.length > 0) {
    const { data: docs } = await supabaseAdmin
      .from('source_documents')
      .select('section_number, title, full_text, source_url, last_updated')
      .in('section_number', sectionNumbers)
    sourceDocs = docs || []
  }

  const sourceMap = {}
  for (const doc of sourceDocs) sourceMap[doc.section_number] = doc

  return { props: { page, sourceMap } }
}

// ─── Edit modal ───────────────────────────────────────────────────────────────

function EditModal({ page, onSave, onCancel, saving }) {
  const [fields, setFields] = useState({
    title: page.title || '',
    seo_title: page.seo_title || '',
    meta_description: page.meta_description || '',
    eyebrow: page.eyebrow || '',
    quick_answer: page.quick_answer || '',
    reviewer: page.reviewer || '',
    body_sections: page.body_sections || [],
    worked_example: page.worked_example || null,
    faq: page.faq || [],
    primary_sources: page.primary_sources || [],
    deprecation_note: page.deprecation_note || '',
  })

  const set = (key, val) => setFields(f => ({ ...f, [key]: val }))

  // Body sections
  const setSection = (i, key, val) => {
    const updated = fields.body_sections.map((s, idx) => idx === i ? { ...s, [key]: val } : s)
    set('body_sections', updated)
  }
  const addSection = () => set('body_sections', [...fields.body_sections, { heading: '', prose: '', citation_ref: '' }])
  const removeSection = i => set('body_sections', fields.body_sections.filter((_, idx) => idx !== i))

  // FAQ
  const setFaq = (i, key, val) => {
    const updated = fields.faq.map((f, idx) => idx === i ? { ...f, [key]: val } : f)
    set('faq', updated)
  }
  const addFaq = () => set('faq', [...fields.faq, { q: '', a: '' }])
  const removeFaq = i => set('faq', fields.faq.filter((_, idx) => idx !== i))

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 200,
      background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      paddingTop: 24, paddingBottom: 24, overflowY: 'auto',
    }}>
      <div style={{
        background: '#fff', borderRadius: 12, width: '100%', maxWidth: 820,
        margin: '0 16px', boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Modal header */}
        <div style={{
          padding: '18px 24px', borderBottom: `1px solid ${GRAY.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'sticky', top: 0, background: '#fff', borderRadius: '12px 12px 0 0', zIndex: 1,
        }}>
          <span style={{ fontWeight: 700, fontSize: 17, color: NSSA.dark }}>Edit Page — {page.title}</span>
          <button onClick={onCancel} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: GRAY.text, lineHeight: 1 }}>×</button>
        </div>

        {/* Form body */}
        <div style={{ padding: '24px', overflowY: 'auto', maxHeight: '75vh' }}>

          <FormRow label="Title (H1)">
            <Input value={fields.title} onChange={v => set('title', v)} />
          </FormRow>

          <FormRow label={`SEO Title (${fields.seo_title.length}/60)`} warn={fields.seo_title.length > 60}>
            <Input value={fields.seo_title} onChange={v => set('seo_title', v)} />
          </FormRow>

          <FormRow label={`Meta Description (${fields.meta_description.length}/160)`} warn={fields.meta_description.length > 160}>
            <Textarea value={fields.meta_description} onChange={v => set('meta_description', v)} rows={2} />
          </FormRow>

          <FormRow label="Eyebrow (e.g. 'Claiming Rules')">
            <Input value={fields.eyebrow} onChange={v => set('eyebrow', v)} />
          </FormRow>

          <FormRow label="Quick Answer (HTML OK)">
            <Textarea value={fields.quick_answer} onChange={v => set('quick_answer', v)} rows={4} />
          </FormRow>

          <Divider label="Body Sections" />
          {fields.body_sections.filter(s => !s._review_note).map((section, i) => (
            <div key={i} style={{ background: GRAY.bg, borderRadius: 8, padding: 16, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: GRAY.text }}>Section {i + 1}</span>
                <button onClick={() => removeSection(i)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 13 }}>Remove</button>
              </div>
              <FormRow label="Heading">
                <Input value={section.heading} onChange={v => setSection(i, 'heading', v)} />
              </FormRow>
              <FormRow label="Prose (HTML OK)">
                <Textarea value={section.prose} onChange={v => setSection(i, 'prose', v)} rows={4} />
              </FormRow>
              <FormRow label="Citation (section number)">
                <Input value={section.citation_ref || ''} onChange={v => setSection(i, 'citation_ref', v)} placeholder="e.g. GN 00204.020" mono />
              </FormRow>
            </div>
          ))}
          <button onClick={addSection} style={addBtnStyle}>+ Add Section</button>

          <Divider label="FAQ" />
          {fields.faq.map((item, i) => (
            <div key={i} style={{ background: GRAY.bg, borderRadius: 8, padding: 16, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontWeight: 600, fontSize: 13, color: GRAY.text }}>FAQ {i + 1}</span>
                <button onClick={() => removeFaq(i)} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer', fontSize: 13 }}>Remove</button>
              </div>
              <FormRow label="Question">
                <Input value={item.q} onChange={v => setFaq(i, 'q', v)} />
              </FormRow>
              <FormRow label="Answer">
                <Textarea value={item.a} onChange={v => setFaq(i, 'a', v)} rows={3} />
              </FormRow>
            </div>
          ))}
          <button onClick={addFaq} style={addBtnStyle}>+ Add FAQ</button>

          <Divider label="Reviewer" />
          <FormRow label="Reviewer name">
            <Input value={fields.reviewer} onChange={v => set('reviewer', v)} placeholder="Cindi Hill" />
          </FormRow>

          <Divider label="Superseded note (only if marking superseded)" />
          <FormRow label="Deprecation note">
            <Textarea
              value={fields.deprecation_note}
              onChange={v => set('deprecation_note', v)}
              rows={2}
              placeholder="e.g. This rule was repealed by the Social Security Fairness Act of 2023, effective January 2024."
            />
          </FormRow>

        </div>

        {/* Modal footer */}
        <div style={{
          padding: '16px 24px', borderTop: `1px solid ${GRAY.border}`,
          display: 'flex', justifyContent: 'flex-end', gap: 10,
          position: 'sticky', bottom: 0, background: '#fff', borderRadius: '0 0 12px 12px',
        }}>
          <button onClick={onCancel} style={secondaryBtnStyle}>Cancel</button>
          <button onClick={() => onSave(fields, false)} disabled={saving} style={primaryBtnStyle(NSSA.dark)}>
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          <button onClick={() => onSave(fields, true)} disabled={saving} style={primaryBtnStyle('#16a34a')}>
            {saving ? 'Saving…' : 'Save & Approve'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function KBReviewDetail({ page, sourceMap }) {
  const router = useRouter()
  const [showEdit, setShowEdit] = useState(false)
  const [showSuperseded, setShowSuperseded] = useState(false)
  const [supersededNote, setSupersededNote] = useState(page.deprecation_note || '')
  const [submitting, setSubmitting] = useState(false)
  const [activeSource, setActiveSource] = useState((page.primary_sources || [])[0]?.section_number || null)
  const [currentPage, setCurrentPage] = useState(page)

  const categoryColor = currentPage.category === 'irmaa' ? IRMAA.dark : NSSA.dark

  async function handleDecision(action, extra = {}) {
    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/kb-decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentPage.id, action, ...extra }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Unknown error')
      router.push('/admin/kb-review')
    } catch (err) {
      alert('Error: ' + err.message)
      setSubmitting(false)
    }
  }

  async function handleSave(fields, andApprove) {
    setSubmitting(true)
    try {
      const res = await fetch('/api/admin/kb-update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentPage.id, fields, approve: andApprove }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Unknown error')
      if (andApprove) {
        router.push('/admin/kb-review')
      } else {
        setCurrentPage(p => ({ ...p, ...fields }))
        setShowEdit(false)
        setSubmitting(false)
      }
    } catch (err) {
      alert('Error: ' + err.message)
      setSubmitting(false)
    }
  }

  const activeDoc = activeSource ? sourceMap[activeSource] : null

  return (
    <div style={{ minHeight: '100vh', background: GRAY.bg, fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>

      {/* Edit modal */}
      {showEdit && (
        <EditModal
          page={currentPage}
          onSave={handleSave}
          onCancel={() => setShowEdit(false)}
          saving={submitting}
        />
      )}

      {/* Superseded confirmation panel */}
      {showSuperseded && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 200,
          background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 520, margin: '0 16px', padding: 28, boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <div style={{ fontWeight: 700, fontSize: 17, color: '#7F1D1D', marginBottom: 8 }}>⚠️ Mark as Superseded</div>
            <p style={{ fontSize: 14, color: GRAY.text, marginBottom: 16 }}>
              This will add a prominent banner to the public page stating this rule is no longer in effect.
              The page remains published for reference. Add a note explaining why (e.g. legislation, policy change).
            </p>
            <label style={{ display: 'block', fontSize: 13, fontWeight: 600, color: GRAY.text, marginBottom: 6 }}>
              Deprecation note (shown publicly on the page)
            </label>
            <textarea
              value={supersededNote}
              onChange={e => setSupersededNote(e.target.value)}
              rows={3}
              placeholder="e.g. This rule was repealed by the Social Security Fairness Act of 2023, effective January 2024."
              style={{ width: '100%', padding: '10px 12px', borderRadius: 6, border: `1px solid ${GRAY.border}`, fontFamily: 'inherit', fontSize: 14, resize: 'vertical', boxSizing: 'border-box', marginBottom: 16 }}
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={() => setShowSuperseded(false)} style={secondaryBtnStyle}>Cancel</button>
              <button
                onClick={() => handleDecision('superseded', { deprecation_note: supersededNote })}
                disabled={submitting}
                style={primaryBtnStyle('#7F1D1D')}
              >
                {submitting ? 'Saving…' : 'Mark Superseded'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{
        background: NSSA.dark, color: '#fff',
        padding: '14px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16,
        position: 'sticky', top: 0, zIndex: 100,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link href="/admin/kb-review" style={{ color: '#8ECAEE', textDecoration: 'none', fontSize: 14 }}>← Queue</Link>
          <span style={{ color: '#4a7fa0' }}>·</span>
          <span style={{ fontWeight: 600 }}>{currentPage.title}</span>
          <span style={{ background: categoryColor, color: '#fff', fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '2px 8px', borderRadius: 4 }}>
            {currentPage.category === 'irmaa' ? 'IRMAA' : 'Soc. Sec.'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <a href={`https://knowledge.nssapros.com/preview/${currentPage.id}`} target="_blank" rel="noopener"
            style={{ color: '#8ECAEE', fontSize: 13, textDecoration: 'none' }}>Preview ↗</a>
          <button onClick={() => setShowSuperseded(true)} disabled={submitting}
            style={{ background: 'transparent', border: '1px solid #F87171', color: '#F87171', borderRadius: 6, padding: '7px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            Superseded
          </button>
          <button onClick={() => setShowEdit(true)} disabled={submitting}
            style={{ background: 'transparent', border: '1px solid #8ECAEE', color: '#8ECAEE', borderRadius: 6, padding: '7px 16px', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
            ✏ Make Changes
          </button>
          <button onClick={() => handleDecision('approve')} disabled={submitting}
            style={{ background: '#16a34a', border: 'none', color: '#fff', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>
            {submitting ? 'Saving…' : '✓ Approve'}
          </button>
        </div>
      </div>

      {/* Body — two-column */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', height: 'calc(100vh - 56px)' }}>

        {/* LEFT — Content view */}
        <div style={{ overflowY: 'auto', padding: 28, borderRight: `1px solid ${GRAY.border}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <h2 style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: GRAY.text, margin: 0 }}>DRAFTED CONTENT</h2>
            <button onClick={() => setShowEdit(true)} style={{ fontSize: 13, color: NSSA.medium, background: 'none', border: `1px solid ${NSSA.light}`, borderRadius: 5, padding: '4px 12px', cursor: 'pointer' }}>✏ Edit all fields</button>
          </div>

          <Section label="SEO Title"><span style={{ fontSize: 14 }}>{currentPage.seo_title}</span><CharCount n={currentPage.seo_title?.length} max={60} /></Section>
          <Section label="Meta Description"><span style={{ fontSize: 14 }}>{currentPage.meta_description}</span><CharCount n={currentPage.meta_description?.length} max={160} /></Section>
          {currentPage.eyebrow && <Section label="Eyebrow"><span style={{ fontSize: 14 }}>{currentPage.eyebrow}</span></Section>}

          <Section label="Quick Answer">
            <div style={{ fontSize: 15, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: currentPage.quick_answer }} />
          </Section>

          {(currentPage.body_sections || []).filter(s => !s._review_note).map((section, i) => (
            <Section key={i} label={`Section ${i + 1}: ${section.heading}`}>
              <div style={{ fontSize: 14, lineHeight: 1.6 }} dangerouslySetInnerHTML={{ __html: section.prose }} />
              {section.citation_ref && (
                <button onClick={() => setActiveSource(section.citation_ref)}
                  style={{ marginTop: 8, padding: '3px 10px', borderRadius: 4, cursor: 'pointer', background: activeSource === section.citation_ref ? '#EFF6FF' : GRAY.bg, border: `1px solid ${activeSource === section.citation_ref ? NSSA.medium : GRAY.border}`, fontFamily: 'ui-monospace, monospace', fontSize: 12, fontWeight: 600, color: NSSA.dark }}>
                  {section.citation_ref} {activeSource === section.citation_ref ? '← viewing' : '→ view source'}
                </button>
              )}
            </Section>
          ))}

          {currentPage.worked_example && (
            <Section label="Worked Example">
              <div style={{ fontWeight: 700, marginBottom: 6 }}>{currentPage.worked_example.label}</div>
              {(currentPage.worked_example.paragraphs || []).map((p, i) => (
                <div key={i} style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 8 }} dangerouslySetInnerHTML={{ __html: p }} />
              ))}
            </Section>
          )}

          {(currentPage.faq || []).map((item, i) => (
            <Section key={i} label={`FAQ ${i + 1}`}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{item.q}</div>
              <div style={{ fontSize: 14, lineHeight: 1.6 }}>{item.a}</div>
            </Section>
          ))}

          <Section label="Cited Sources">
            {(currentPage.primary_sources || []).map((src, i) => (
              <button key={i} onClick={() => setActiveSource(src.section_number)}
                style={{ display: 'block', width: '100%', textAlign: 'left', marginBottom: 8, background: activeSource === src.section_number ? '#EFF6FF' : '#fff', border: `1px solid ${activeSource === src.section_number ? NSSA.medium : GRAY.border}`, borderRadius: 6, padding: '10px 14px', cursor: 'pointer', fontFamily: 'inherit' }}>
                <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600, fontSize: 13, color: NSSA.dark }}>{src.section_number}</span>
                {' '}<a href={src.url} target="_blank" rel="noopener" onClick={e => e.stopPropagation()} style={{ fontSize: 12, color: GRAY.text }}>View on SSA ↗</a>
                {!sourceMap[src.section_number] && <span style={{ marginLeft: 8, fontSize: 12, color: '#dc2626', fontWeight: 600 }}>⚠ Not in DB yet</span>}
              </button>
            ))}
          </Section>

          {currentPage.reviewer && (
            <Section label="Reviewer">
              <span style={{ fontSize: 14 }}>{currentPage.reviewer}</span>
            </Section>
          )}

          {/* Review notes (from prior "Request Changes" cycles) */}
          {(currentPage.body_sections || []).filter(s => s._review_note).map((note, i) => (
            <div key={i} style={{ background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: 6, padding: '12px 14px', marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#92400E', marginBottom: 4 }}>{note.heading}</div>
              <div style={{ fontSize: 14, color: '#78350F' }}>{note.prose}</div>
            </div>
          ))}
        </div>

        {/* RIGHT — Source text */}
        <div style={{ overflowY: 'auto', padding: 28, background: '#FFFDF5' }}>
          <h2 style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: GRAY.text, marginBottom: 20 }}>
            SSA SOURCE TEXT
            {activeSource && <span style={{ marginLeft: 8, fontFamily: 'ui-monospace, monospace', fontSize: 12, background: '#FEF3C7', color: '#92400E', padding: '2px 8px', borderRadius: 4, fontWeight: 600, letterSpacing: 0 }}>{activeSource}</span>}
          </h2>

          {(currentPage.primary_sources || []).length > 1 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
              {(currentPage.primary_sources || []).map(src => (
                <button key={src.section_number} onClick={() => setActiveSource(src.section_number)}
                  style={{ padding: '5px 12px', borderRadius: 4, fontSize: 13, cursor: 'pointer', fontFamily: 'ui-monospace, monospace', fontWeight: 600, background: activeSource === src.section_number ? NSSA.dark : '#fff', color: activeSource === src.section_number ? '#fff' : NSSA.dark, border: `1px solid ${activeSource === src.section_number ? NSSA.dark : GRAY.border}` }}>
                  {src.section_number}
                </button>
              ))}
            </div>
          )}

          {!activeSource && <div style={{ color: GRAY.text, fontSize: 14 }}>Click a cited source on the left to view its SSA source text here.</div>}

          {activeSource && !activeDoc && (
            <div style={{ background: '#FEF2F2', border: '1px solid #FECACA', borderRadius: 8, padding: '16px 20px', color: '#991B1B' }}>
              <strong>⚠ Not yet in database</strong>
              <p style={{ margin: '8px 0 0', fontSize: 14 }}>The ingest is still running. <a href={currentPage.primary_sources?.find(s => s.section_number === activeSource)?.url} target="_blank" rel="noopener" style={{ color: '#991B1B', fontWeight: 600 }}>View on policy.ssa.gov ↗</a></p>
            </div>
          )}

          {activeDoc && (
            <>
              <div style={{ background: '#FEF3C7', border: '1px solid #F59E0B', borderRadius: 6, padding: '12px 16px', marginBottom: 16, fontSize: 13 }}>
                <div style={{ fontWeight: 700, color: '#92400E', marginBottom: 4 }}>{activeDoc.title}</div>
                <div style={{ color: '#78350F' }}>
                  Last updated: <strong>{activeDoc.last_updated || 'unknown'}</strong> ·{' '}
                  <a href={activeDoc.source_url} target="_blank" rel="noopener" style={{ color: '#92400E', fontWeight: 600 }}>View on policy.ssa.gov ↗</a>
                </div>
              </div>
              <div style={{ fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 13, lineHeight: 1.7, color: '#1f2937', background: '#fff', border: `1px solid ${GRAY.border}`, borderRadius: 6, padding: '16px 20px', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {activeDoc.full_text}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Shared sub-components ────────────────────────────────────────────────────

function Section({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: GRAY.text, marginBottom: 5 }}>{label}</div>
      <div style={{ background: '#fff', border: `1px solid ${GRAY.border}`, borderRadius: 6, padding: '12px 14px' }}>{children}</div>
    </div>
  )
}

function FormRow({ label, children, warn }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: warn ? '#dc2626' : GRAY.text, marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  )
}

function Input({ value, onChange, placeholder, mono }) {
  return (
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder || ''}
      style={{ width: '100%', padding: '8px 10px', borderRadius: 5, border: `1px solid ${GRAY.border}`, fontFamily: mono ? 'ui-monospace, monospace' : 'inherit', fontSize: 14, boxSizing: 'border-box' }} />
  )
}

function Textarea({ value, onChange, rows, placeholder }) {
  return (
    <textarea value={value} onChange={e => onChange(e.target.value)} rows={rows || 3} placeholder={placeholder || ''}
      style={{ width: '100%', padding: '8px 10px', borderRadius: 5, border: `1px solid ${GRAY.border}`, fontFamily: 'inherit', fontSize: 14, resize: 'vertical', boxSizing: 'border-box' }} />
  )
}

function CharCount({ n, max }) {
  const over = n > max
  return <div style={{ fontSize: 11, color: over ? '#dc2626' : GRAY.text, textAlign: 'right', marginTop: 3 }}>{n}/{max}{over ? ' — too long' : ''}</div>
}

function Divider({ label }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0 16px' }}>
      <div style={{ flex: 1, height: 1, background: GRAY.border }} />
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: GRAY.text }}>{label}</span>
      <div style={{ flex: 1, height: 1, background: GRAY.border }} />
    </div>
  )
}

const addBtnStyle = { background: '#fff', border: `1px dashed ${GRAY.border}`, color: GRAY.text, borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontSize: 13, width: '100%', marginBottom: 8, fontFamily: 'inherit' }
const secondaryBtnStyle = { background: '#fff', border: `1px solid ${GRAY.border}`, color: GRAY.text, borderRadius: 6, padding: '8px 16px', cursor: 'pointer', fontSize: 14, fontFamily: 'inherit' }
const primaryBtnStyle = (bg) => ({ background: bg, border: 'none', color: '#fff', borderRadius: 6, padding: '8px 20px', cursor: 'pointer', fontSize: 14, fontWeight: 700, fontFamily: 'inherit' })
