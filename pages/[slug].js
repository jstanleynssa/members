// pages/[slug].js
// Statically generated public advisor profile for directory.nssapros.com.
// One pre-built HTML page per certified advisor who has a bio.

import Head from 'next/head'
import { useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { buildSlugIndex } from '../lib/slug'

const NSSA  = { light: '#8ECAEE', medium: '#1C80BC', dark: '#13405E' }
const IRMAA = { light: '#ED8E8E', medium: '#DE5B63', dark: '#AF2A35' }
const GRAY  = { text: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb', dark: '#1f2937' }
const TAN    = '#b3a584'
const SITE   = 'https://directory.nssapros.com'
const ROOT   = 'https://nssapros.com'

// ── Build-time data ─────────────────────────────────────────────────────────
function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

// Fetch all certified members WITH a bio (the directory inclusion gate).
async function fetchDirectoryMembers() {
  const supabase = admin()
  let all = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('members')
      .select('id, email, first_name, last_name, job_title, company, address, city, state, zip, phone, mobile_phone, website, linkedin_url, bio, profile_photo, nssa_certified, irmaa_certified, nssa_number, irmaa_number, directory_page_title, directory_h1, is_active')
      .or('nssa_certified.eq.true,irmaa_certified.eq.true')
      .order('last_name', { ascending: true })
      .range(from, from + 999)
    if (error) { console.error('Directory fetch error:', error.message); break }
    if (!data || data.length === 0) break
    all = all.concat(data)
    if (data.length < 1000) break
    from += 1000
  }
  // Inclusion gate: must be active and have real bio content.
  return all.filter(m => {
    if (m.is_active === false) return false
    const bioText = (m.bio || '').replace(/<[^>]*>/g, '').trim()
    return bioText.length > 0
  })
}

export async function getStaticPaths() {
  const members = await fetchDirectoryMembers()
  const { byEmail } = buildSlugIndex(members)

  // ── POC SCOPE ─────────────────────────────────────────────────────────────
  // Only pre-build a small hardcoded test set so we can validate the template
  // across edge cases (messy title, single vs dual badge, missing website)
  // without generating all ~1,700 pages. To go full directory later, delete
  // this block and use: const paths = [...byEmail.values()].map(...)
  const POC_EMAILS = [
    'jason@dancing-tree.org',     // your test profile (dual cert)
    'jstanley@nssapros.com',      // admin / dual cert
    // add a few more real test advisors here as needed, e.g.:
    // 'joy@jkinginsurance.com',  // single-cert + messy title example
  ]
  const paths = POC_EMAILS
    .filter(email => byEmail.has(email))
    .map(email => ({ params: { slug: byEmail.get(email) } }))
  // ──────────────────────────────────────────────────────────────────────────

  // fallback:'blocking' means any other advisor URL still renders on-demand
  // (and gets cached) if visited directly — but only the POC set is prebuilt.
  return { paths, fallback: 'blocking' }
}

export async function getStaticProps({ params }) {
  const members = await fetchDirectoryMembers()
  const { bySlug } = buildSlugIndex(members)
  const member = bySlug.get(params.slug)
  if (!member) return { notFound: true }

  return {
    props: { member: JSON.parse(JSON.stringify(member)), slug: params.slug },
    revalidate: 86400, // rebuild at most once/day if using ISR
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────
function bioToParagraphs(bio) {
  if (!bio) return []
  // Bios may be HTML (<p>...</p>) or plain text with newlines. Normalize to
  // an array of paragraph strings.
  const stripped = bio
    .replace(/<\/(p|div)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
  return stripped.split(/\n{2,}/).map(s => s.trim()).filter(Boolean)
}

function firstName(m) { return (m.first_name || '').trim() }
function fullName(m)  { return `${m.first_name || ''} ${m.last_name || ''}`.trim() }
function cleanWebsite(url) { return (url || '').replace(/^https?:\/\//, '').replace(/\/$/, '') }
function websiteHref(url) {
  if (!url) return null
  return /^https?:\/\//.test(url) ? url : `https://${url}`
}

// ── Contact form (client) ───────────────────────────────────────────────────
function ContactForm({ advisorName, advisorEmail, slug }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' })
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(null)

  function change(e) {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }))
  }

  async function submit() {
    if (!form.name || !form.email || !form.message) {
      setError('Please fill in your name, email, and a message.')
      return
    }
    setSending(true); setError(null)
    try {
      const res = await fetch('/api/contact-advisor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, advisorEmail, advisorName, slug }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Could not send your message.')
      setSent(true)
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  const input = {
    width: '100%', padding: '12px 14px', fontSize: '15px', marginBottom: '14px',
    border: `1px solid ${GRAY.border}`, borderRadius: '6px', boxSizing: 'border-box',
    fontFamily: 'inherit', background: 'white', outline: 'none',
  }

  if (sent) {
    return (
      <div style={{ background: GRAY.bg, borderRadius: '10px', padding: '2rem' }}>
        <h2 style={{ fontSize: '22px', fontWeight: 700, color: GRAY.dark, marginBottom: '12px' }}>Message sent</h2>
        <p style={{ fontSize: '15px', color: GRAY.text, lineHeight: 1.6 }}>
          Thanks — your message has been sent to {advisorName}. They'll be in touch soon.
        </p>
      </div>
    )
  }

  return (
    <div style={{ background: GRAY.bg, borderRadius: '10px', padding: '2rem' }}>
      <h2 style={{ fontSize: '22px', fontWeight: 700, color: GRAY.dark, marginBottom: '1.25rem', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
        Contact {firstName({ first_name: advisorName.split(' ')[0] })}
      </h2>
      <input name="name" value={form.name} onChange={change} placeholder="Name" style={input} />
      <input name="email" type="email" value={form.email} onChange={change} placeholder="Your Email" style={input} />
      <input name="phone" type="tel" value={form.phone} onChange={change} placeholder="Mobile Phone" style={input} />
      <textarea name="message" value={form.message} onChange={change} placeholder="Message" rows={4} style={{ ...input, resize: 'vertical', minHeight: '110px' }} />
      {error && <p style={{ fontSize: '13px', color: IRMAA.dark, marginBottom: '12px' }}>{error}</p>}
      <button
        onClick={submit}
        disabled={sending}
        style={{
          background: IRMAA.dark, color: 'white', border: 'none', borderRadius: '999px',
          padding: '12px 32px', fontSize: '15px', fontWeight: 600,
          cursor: sending ? 'not-allowed' : 'pointer', opacity: sending ? 0.7 : 1,
        }}
      >
        {sending ? 'Sending…' : 'Send message'}
      </button>
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────
export default function AdvisorProfile({ member, slug }) {
  const name = fullName(member)
  const fname = firstName(member)
  const paragraphs = bioToParagraphs(member.bio)
  const canonical = `${SITE}/${slug}`

  const hasNssa = !!member.nssa_certified
  const hasIrmaa = !!member.irmaa_certified
  const phone = member.phone || member.mobile_phone || ''
  const web = websiteHref(member.website)

  // SEO title/H1 — use stored directory fields when present, else sensible defaults.
  const pageTitle = member.directory_page_title
    || `${name}${member.city ? `, ${member.city}` : ''}${member.state ? `, ${member.state}` : ''} — NSSA® & IRMAACP™ Certified Advisor`
  const h1 = member.directory_h1 || 'NSSA® and IRMAA Certified Planner™'
  const metaDesc = paragraphs[0]
    ? paragraphs[0].slice(0, 155)
    : `${name} is an NSSA® and IRMAACP™ certified advisor${member.city ? ` in ${member.city}, ${member.state}` : ''}.`

  // Schema.org Person structured data
  const certs = []
  if (hasNssa) certs.push('NSSA® — National Social Security Advisor')
  if (hasIrmaa) certs.push('IRMAACP™ — IRMAA Certified Planner')
  const personSchema = {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name,
    jobTitle: member.job_title || undefined,
    worksFor: member.company ? { '@type': 'Organization', name: member.company } : undefined,
    image: member.profile_photo || undefined,
    url: canonical,
    telephone: phone || undefined,
    address: (member.city || member.state) ? {
      '@type': 'PostalAddress',
      streetAddress: member.address || undefined,
      addressLocality: member.city || undefined,
      addressRegion: member.state || undefined,
      postalCode: member.zip || undefined,
      addressCountry: 'US',
    } : undefined,
    hasCredential: certs.map(c => ({ '@type': 'EducationalOccupationalCredential', name: c })),
    sameAs: [member.linkedin_url, web].filter(Boolean),
  }

  const pillBtn = {
    display: 'block', textAlign: 'center', padding: '14px 24px', marginBottom: '12px',
    border: `2px solid ${GRAY.dark}`, borderRadius: '999px', background: 'white',
    color: GRAY.dark, fontWeight: 700, fontSize: '14px', textDecoration: 'none',
    letterSpacing: '0.03em', textTransform: 'uppercase',
  }

  return (
    <>
      <Head>
        <title>{pageTitle}</title>
        <meta name="description" content={metaDesc} />
        <link rel="canonical" href={canonical} />
        <meta property="og:type" content="profile" />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={metaDesc} />
        <meta property="og:url" content={canonical} />
        {member.profile_photo && <meta property="og:image" content={member.profile_photo} />}
        <meta name="twitter:card" content="summary_large_image" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(personSchema) }}
        />
      </Head>

      <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', color: GRAY.dark }}>

        {/* Top nav — mirrors the Kajabi site so the page feels continuous */}
        <header style={{ background: 'white', borderBottom: `1px solid ${GRAY.border}`, padding: '1rem 2rem' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <a href={ROOT}><img src="/nssa-logo.png" alt="National Social Security Advisors" style={{ height: '44px', width: 'auto' }} /></a>
            <nav style={{ display: 'flex', gap: '26px', alignItems: 'center', fontSize: '15px' }}>
              {[
                ['About Us', `${ROOT}/about`],
                ['Social Security Training', `${ROOT}/nssa-course`],
                ['IRMAA Medicare Training', `${ROOT}/irmaa-course`],
                ['Find an Advisor', `${ROOT}/find-an-advisor`],
                ['Contact Us', `${ROOT}/contact`],
                ['Ask a Question', `${ROOT}/ask`],
              ].map(([label, href]) => (
                <a key={label} href={href} style={{ color: GRAY.dark, textDecoration: 'none' }}>{label}</a>
              ))}
            </nav>
          </div>
        </header>

        {/* Hero */}
        <section style={{ background: GRAY.bg, padding: '3rem 2rem' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            <h1 style={{ fontSize: '2.4rem', fontWeight: 800, color: IRMAA.dark, marginBottom: '2rem' }}>{h1}</h1>
            <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr 280px', gap: '2.5rem', alignItems: 'start' }}>

              {/* Photo */}
              <div>
                {member.profile_photo
                  ? <img src={member.profile_photo} alt={`${name} — ${member.job_title || 'Certified Advisor'}`} style={{ width: '100%', borderRadius: '4px', display: 'block' }} />
                  : <div style={{ width: '100%', aspectRatio: '1 / 1.15', background: NSSA.dark, borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '64px', fontWeight: 700 }}>{(fname[0] || '?')}</div>}
              </div>

              {/* Details */}
              <div>
                <h2 style={{ fontSize: '1.7rem', fontWeight: 700, marginBottom: '8px' }}>{name}</h2>
                {member.job_title && <p style={{ fontSize: '17px', color: GRAY.dark, marginBottom: '4px' }}>{member.job_title}</p>}
                {member.company && <p style={{ fontSize: '15px', color: GRAY.dark, marginBottom: '14px' }}>{member.company}</p>}
                <div style={{ fontSize: '15px', color: GRAY.dark, lineHeight: 1.7, marginBottom: '14px' }}>
                  {member.address && <div>{member.address}</div>}
                  {(member.city || member.state) && <div>{[member.city, member.state].filter(Boolean).join(', ')}{member.zip ? ` ${member.zip}` : ''}</div>}
                </div>
                {phone && <p style={{ fontSize: '16px', fontWeight: 700, color: NSSA.medium, marginBottom: '16px' }}>{phone}</p>}

                {/* Cert badges */}
                <div style={{ display: 'flex', gap: '14px' }}>
                  {hasNssa && <img src="/nssa-certificate-badge.png" alt={`NSSA® Certified${member.nssa_number ? ` #${member.nssa_number}` : ''}`} style={{ height: '92px', width: 'auto' }} />}
                  {hasIrmaa && <img src="/irmaa-certificate-badge.png" alt={`IRMAACP™ Certified${member.irmaa_number ? ` #${member.irmaa_number}` : ''}`} style={{ height: '92px', width: 'auto' }} />}
                </div>
              </div>

              {/* Action buttons */}
              <div>
                {web && <a href={web} target="_blank" rel="noopener noreferrer" style={pillBtn}>Visit Website</a>}
                {phone && <a href={`tel:${phone.replace(/[^0-9+]/g, '')}`} style={pillBtn}>Call {fname}</a>}
                {member.email && <a href={`mailto:${member.email}`} style={pillBtn}>Email {fname}</a>}
              </div>
            </div>
          </div>
        </section>

        {/* Body: Professional Profile + Contact form */}
        <section style={{ background: 'white', padding: '3.5rem 2rem' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 420px', gap: '3rem', alignItems: 'start' }}>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '1.5rem' }}>
                <span style={{ display: 'inline-block', width: '5px', height: '34px', background: GRAY.dark, borderRadius: '2px' }} />
                <h2 style={{ fontSize: '1.9rem', fontWeight: 800, color: GRAY.dark }}>Professional Profile</h2>
              </div>
              {paragraphs.map((p, i) => (
                <p key={i} style={{ fontSize: '16px', color: '#374151', lineHeight: 1.75, marginBottom: '1.1rem' }}>{p}</p>
              ))}
            </div>

            <ContactForm advisorName={name} advisorEmail={member.email} slug={slug} />
          </div>
        </section>

        {/* Value-prop band — matches the Kajabi "How an NSSA Advisor Will Help You" */}
        <section style={{ background: '#e7e2d6', padding: '4rem 2rem' }}>
          <div style={{ maxWidth: '1100px', margin: '0 auto', textAlign: 'center' }}>
            <h2 style={{ fontSize: '2rem', fontWeight: 800, color: GRAY.dark, marginBottom: '1rem' }}>How an NSSA® Certified Advisor Will Help You</h2>
            <p style={{ fontSize: '16px', color: GRAY.text, maxWidth: '720px', margin: '0 auto 3rem', lineHeight: 1.6 }}>
              An NSSA® Certified Advisor provides the knowledge and expertise needed to maximize your Social Security benefits and help you achieve a secure retirement.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '2.5rem' }}>
              {[
                ['Avoid Costly Social Security Claiming Mistakes', 'Navigating Social Security rules can be complex, and even small mistakes can cost you thousands of dollars in lost benefits. An NSSA® Certified Advisor ensures you make informed decisions and avoid costly errors.'],
                ['Holistic Retirement Planning', 'An NSSA® Advisor integrates your Social Security strategy with your overall retirement plan, ensuring your assets work together to meet your financial goals and a clearer path to a secure future.'],
                ['Guidance You Won\u2019t Get from the Social Security Office', 'The Social Security office provides information but doesn\u2019t offer personalized advice or strategies. An NSSA® Certified Advisor delivers tailored solutions based on your unique circumstances and goals.'],
              ].map(([title, body]) => (
                <div key={title}>
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: GRAY.dark, marginBottom: '0.9rem', lineHeight: 1.3 }}>{title}</h3>
                  <p style={{ fontSize: '15px', color: GRAY.text, lineHeight: 1.6 }}>{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer style={{ background: TAN, padding: '1.75rem 2rem' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', alignItems: 'center', gap: '2rem', flexWrap: 'wrap' }}>
            <a href={ROOT}><img src="/nssa-logo-white.png" alt="NSSA" style={{ height: '40px', width: 'auto' }} /></a>
            <span style={{ color: 'white', fontSize: '14px' }}>
              © {new Date().getFullYear()} Social Security Professionals, LLC · 1201 Connecticut Ave NW Ste 531 Washington, DC 20036
            </span>
          </div>
        </footer>
      </div>
    </>
  )
}
