// pages/[slug].js
// Statically generated public advisor profile for directory.nssapros.com.
// One pre-built HTML page per certified advisor who has a bio.

import Head from 'next/head'
import React, { useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { buildSlugIndex, stateToken } from '../lib/slug'
import { STATE_NAMES, stateNameToSlug } from '../lib/geo'

const NSSA  = { light: '#8ECAEE', medium: '#1C80BC', dark: '#13405E' }
const IRMAA = { light: '#ED8E8E', medium: '#DE5B63', dark: '#AF2A35' }
const GRAY  = { text: '#6b7280', bg: '#f3f4f6', border: '#e5e7eb', dark: '#1f2937' }
const TAN    = '#b3a584'
const SITE   = 'https://directory.nssapros.com'
const ROOT   = 'https://nssapros.com'

// Product/training pages we want to pass internal link equity to.
const NSSA_COURSE  = 'https://www.nssapros.com/social-security-training'
const IRMAA_COURSE = 'https://www.nssapros.com/irmaa-medicare-training-course'

// Varied anchor phrasings per cert (avoids identical anchors across ~700 pages).
const NSSA_ANCHORS = [
  'National Social Security Advisor (NSSA®) certification',
  'NSSA® Social Security certification',
  'National Social Security Advisor program',
  'NSSA® designation in Social Security planning',
]
const IRMAA_ANCHORS = [
  'IRMAA Certified Planner (IRMAACP™) program',
  'IRMAACP™ Medicare & IRMAA certification',
  'IRMAA Certified Planner designation',
  'IRMAACP™ training in Medicare planning',
]
// Sentence frames; {NSSA} / {IRMAA} are replaced with the linked anchors.
// {NAME} with the advisor's name. Picked deterministically per advisor.
const BOTH_FRAMES = [
  'As a certified professional, {NAME} has completed the {NSSA} and the {IRMAA}, bringing specialized expertise in Social Security and Medicare planning to clients.',
  '{NAME} holds both the {NSSA} and the {IRMAA}, reflecting advanced training in retirement income and Medicare cost planning.',
  'Having earned the {NSSA} and the {IRMAA}, {NAME} is equipped to guide clients through complex Social Security and Medicare decisions.',
]
const NSSA_FRAMES = [
  '{NAME} has earned the {NSSA}, demonstrating advanced expertise in Social Security claiming strategies.',
  'As a holder of the {NSSA}, {NAME} brings specialized knowledge of Social Security planning to every client relationship.',
]
const IRMAA_FRAMES = [
  '{NAME} has completed the {IRMAA}, with focused expertise in Medicare and income-related premium planning.',
  'As an {IRMAA} holder, {NAME} helps clients navigate Medicare costs and IRMAA surcharges with confidence.',
]

// ── H1 role phrasing ────────────────────────────────────────────────────────
// Short, varied, cert-adaptive role lines for the H1. Lead with the advisor's
// name elsewhere; these are the role half. Deliberately AVOID "expert" (legal/
// compliance); use specialist / consultant / advisor / professional / planner.
// {TOPIC} is replaced with the cert-adaptive subject.
const ROLE_NOUNS = ['Specialist', 'Consultant', 'Advisor', 'Professional', 'Planner']
// Cert-adaptive subject phrase.
function topicForCerts(hasNssa, hasIrmaa) {
  if (hasNssa && hasIrmaa) return 'Social Security & Medicare'
  if (hasNssa) return 'Social Security'
  if (hasIrmaa) return 'Medicare & IRMAA'
  return 'Retirement'
}
// Role-line frames. {TOPIC} = subject, {NOUN} = role noun, {TITLE} = job title.
// Frames without {TITLE} are always safe; {TITLE} frames are used only when a
// job title exists.
const ROLE_FRAMES_NOTITLE = [
  '{TOPIC} {NOUN}',
  '{TOPIC} Planning {NOUN}',
  'Certified {TOPIC} {NOUN}',
]
const ROLE_FRAMES_TITLE = [
  '{TITLE} & {TOPIC} {NOUN}',
  '{TITLE} Specializing in {TOPIC}',
]

// Stable per-advisor index from a string (email), so phrasing is varied across
// advisors but constant for a given advisor across rebuilds.
function stableIndex(seed, mod) {
  let h = 0
  const s = String(seed || '')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % mod
}

// Generic gray silhouette for advisors with no headshot (or a broken image URL).
function HeadshotSilhouette() {
  return (
    <div style={{ width: '100%', aspectRatio: '280 / 294', background: '#e2e5ea', borderRadius: '4px', overflow: 'hidden', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }} aria-hidden="true">
      <svg viewBox="0 0 64 64" width="70%" height="70%" style={{ display: 'block' }}>
        <circle cx="32" cy="23" r="13" fill="#b9bec7" />
        <path d="M8 64c0-14 11-23 24-23s24 9 24 23z" fill="#b9bec7" />
      </svg>
    </div>
  )
}


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

  // ── FULL DIRECTORY BUILD ────────────────────────────────────────────────
  // Pre-build a page for every advisor who passes the inclusion gate
  // (active + certified + non-empty bio), enforced in fetchDirectoryMembers().
  const paths = [...byEmail.values()].map(slug => ({ params: { slug } }))
  // ──────────────────────────────────────────────────────────────────────────

  // fallback:'blocking' still renders any not-yet-built slug on demand (e.g. a
  // newly-certified advisor before the next rebuild), then caches it.
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

// Truncate to a max length on a word boundary, adding an ellipsis if cut.
function truncateAtWord(str, max) {
  const s = (str || '').trim()
  if (s.length <= max) return s
  const cut = s.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[,;:.\s]+$/, '') + '…'
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

  // ── SEO title / H1 / meta ───────────────────────────────────────────────
  // Stored directory_* fields are AI-generated bulk defaults, so the template
  // cleans them and enforces length limits. (When a `seo_reviewed` flag is
  // later added, wrap this cleanup in `if (!member.seo_reviewed)` and honor
  // the stored values verbatim when true.)

  // Deterministic per-advisor seed (stable across rebuilds, varied across advisors).
  const seed = member.email || slug

  // Build a SHORT, VARIED role line for the H1. Leads with the advisor name
  // (added below). Cert-adaptive subject; rotates role nouns; weaves in the job
  // title when one exists and the result stays reasonably short. Avoids "expert".
  const topic = topicForCerts(hasNssa, hasIrmaa)
  const roleNoun = ROLE_NOUNS[stableIndex(seed + 'rn', ROLE_NOUNS.length)]
  const jobTitle = (member.job_title || '').trim()
  function buildRoleLine() {
    const fill = (f) => f
      .replace('{TOPIC}', topic)
      .replace('{NOUN}', roleNoun)
      .replace('{TITLE}', jobTitle)
    // Prefer a title-based frame when a concise job title exists (keeps H1 short).
    if (jobTitle && jobTitle.length <= 26) {
      const f = ROLE_FRAMES_TITLE[stableIndex(seed + 'rf', ROLE_FRAMES_TITLE.length)]
      const line = fill(f)
      if (`${name}, ${line}`.length <= 58) return line
    }
    const nf = ROLE_FRAMES_NOTITLE[stableIndex(seed + 'rn2', ROLE_FRAMES_NOTITLE.length)]
    return fill(nf)
  }
  const roleLine = buildRoleLine()

  // H1 — e.g. "Joy Cheney, Social Security Planning Specialist"
  const h1 = `${name}, ${roleLine}`

  // ── Breadcrumb: United States > State > Advisor ─────────────────────────
  // State links to the (future) state landing page /advisors/<state-slug>.
  const stCode = stateToken(member.state).toUpperCase()
  const stName = STATE_NAMES[stCode] || member.state || ''
  const stSlug = stName ? stateNameToSlug(stName) : ''
  const breadcrumbs = [
    { label: 'United States', href: SITE + '/' },
    ...(stName && stSlug ? [{ label: stName, href: `${SITE}/advisors/${stSlug}` }] : []),
    { label: name, href: null }, // current page
  ]

  // Page title ≤ 60 chars. Prefer name + role + location; trim gracefully.
  function buildTitle() {
    const loc = (member.city && member.state) ? ` in ${member.city}, ${stateToken(member.state).toUpperCase()}` : ''
    const full = `${name}, ${roleLine}${loc}`
    if (full.length <= 60) return full
    const noLoc = `${name}, ${roleLine}`
    if (noLoc.length <= 60) return noLoc
    return truncateAtWord(noLoc, 60)
  }
  const pageTitle = buildTitle()

  // Meta description ≤ 155 chars, word-boundary truncated.
  const metaDesc = paragraphs[0]
    ? truncateAtWord(paragraphs[0], 155)
    : truncateAtWord(`${name} is a ${roleLine.toLowerCase()}${member.city ? ` based in ${member.city}, ${stateToken(member.state).toUpperCase()}` : ''}, helping clients with Social Security and Medicare planning.`, 155)

  // ── Credibility line: contextual, followed links to the training pages ──
  // Deterministic per advisor (stable across rebuilds), varied across advisors.
  const nssaAnchor = NSSA_ANCHORS[stableIndex(seed + 'n', NSSA_ANCHORS.length)]
  const irmaaAnchor = IRMAA_ANCHORS[stableIndex(seed + 'i', IRMAA_ANCHORS.length)]
  const linkStyle = { color: NSSA.medium, textDecoration: 'underline' }
  const nssaLink = <a key="nl" href={NSSA_COURSE} style={linkStyle}>{nssaAnchor}</a>
  const irmaaLink = <a key="il" href={IRMAA_COURSE} style={{ ...linkStyle, color: IRMAA.medium }}>{irmaaAnchor}</a>

  let credFrame = null
  if (hasNssa && hasIrmaa) credFrame = BOTH_FRAMES[stableIndex(seed, BOTH_FRAMES.length)]
  else if (hasNssa)        credFrame = NSSA_FRAMES[stableIndex(seed, NSSA_FRAMES.length)]
  else if (hasIrmaa)       credFrame = IRMAA_FRAMES[stableIndex(seed, IRMAA_FRAMES.length)]

  // Split the chosen frame on tokens and interleave the linked anchors.
  const credLine = credFrame ? (
    <p key="credline" style={{ fontSize: '16px', color: '#374151', lineHeight: 1.75, marginBottom: '1.1rem' }}>
      {credFrame.split(/(\{NAME\}|\{NSSA\}|\{IRMAA\})/).map((part, i) => {
        if (part === '{NAME}') return <span key={i}>{name}</span>
        if (part === '{NSSA}') return <span key={i}>{nssaLink}</span>
        if (part === '{IRMAA}') return <span key={i}>{irmaaLink}</span>
        return <span key={i}>{part}</span>
      })}
    </p>
  ) : null

  // Vary WHERE the credibility line lands among the bio paragraphs.
  // Google weights links in the opening/middle higher than trailing ones, so
  // we bias toward early slots. "Insert after paragraph N" where N is chosen
  // deterministically per advisor. Slot 0 = after the 1st paragraph.
  // Pool is weighted toward 0/1 (early) so most links sit high in the content.
  const nPara = paragraphs.length
  let credInsertAfter = 0
  if (nPara >= 2) {
    // candidate positions, weighted toward the front (after para 1 or 2)
    const slots = nPara >= 4 ? [0, 0, 1, 1, 2] : nPara === 3 ? [0, 0, 1] : [0]
    credInsertAfter = slots[stableIndex(seed + 'pos', slots.length)]
  }


  // Descriptive alt for the headshot — frames it as a photo description
  // (accessibility best practice) while keeping name/role/company/location
  // for image-search discoverability.
  const photoAlt = [
    `A professional headshot of ${name}`,
    member.job_title ? `, ${member.job_title}` : '',
    member.company ? ` of ${member.company}` : '',
    (member.city && member.state) ? ` in ${member.city}, ${stateToken(member.state).toUpperCase()}` : '',
  ].join('')

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
    sameAs: [member.linkedin_url ? websiteHref(member.linkedin_url) : null, web].filter(Boolean),
  }

  // LocalBusiness (FinancialService) schema — only when we have a real address.
  // Pairs with Person to support local "advisor near me" rich results.
  const hasAddress = !!(member.address && (member.city || member.state))
  const localBusinessSchema = hasAddress ? {
    '@context': 'https://schema.org',
    '@type': 'FinancialService',
    name: member.company || name,
    image: member.profile_photo || undefined,
    url: canonical,
    telephone: phone || undefined,
    address: {
      '@type': 'PostalAddress',
      streetAddress: member.address,
      addressLocality: member.city || undefined,
      addressRegion: member.state || undefined,
      postalCode: member.zip || undefined,
      addressCountry: 'US',
    },
    employee: { '@type': 'Person', name, jobTitle: member.job_title || undefined },
    sameAs: [member.linkedin_url ? websiteHref(member.linkedin_url) : null, web].filter(Boolean),
  } : null

  // BreadcrumbList schema (United States > State > Advisor) for rich results.
  const breadcrumbSchema = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: breadcrumbs.map((b, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: b.label,
      ...(b.href ? { item: b.href } : {}),
    })),
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
        <meta property="og:site_name" content="NSSA® Advisor Directory" />
        <meta property="og:title" content={pageTitle} />
        <meta property="og:description" content={metaDesc} />
        <meta property="og:url" content={canonical} />
        {member.profile_photo && <meta property="og:image" content={member.profile_photo} />}
        {member.profile_photo && <meta property="og:image:alt" content={photoAlt} />}
        <meta name="twitter:card" content="summary_large_image" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(personSchema) }}
        />
        {localBusinessSchema && (
          <script
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessSchema) }}
          />
        )}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
        />
      </Head>

      <style>{`
        @media (max-width: 860px) {
          .hero-grid { grid-template-columns: 1fr !important; gap: 1.5rem !important; }
          .hero-grid .headshot-col { max-width: 280px; margin: 0 auto; }
          .body-grid { grid-template-columns: 1fr !important; gap: 2rem !important; }
          .valueprop-grid { grid-template-columns: 1fr !important; gap: 1.75rem !important; }
          .site-nav { display: none !important; }
          .page-h1 { font-size: 1.6rem !important; }
          .section-pad { padding: 2rem 1.25rem !important; }
        }
        @media (min-width: 861px) and (max-width: 1024px) {
          .hero-grid { grid-template-columns: 220px 1fr !important; }
          .hero-grid .actions-col { grid-column: 1 / -1; display: flex; gap: 12px; flex-wrap: wrap; }
          .hero-grid .actions-col a { flex: 1 1 auto; }
          .body-grid { grid-template-columns: 1fr 340px !important; }
          .valueprop-grid { grid-template-columns: 1fr 1fr !important; }
        }
      `}</style>

      <div style={{ fontFamily: '"Open Sans", system-ui, -apple-system, sans-serif', color: GRAY.dark }}>

        {/* Top nav — mirrors the Kajabi site so the page feels continuous */}
        <header style={{ background: 'white', borderBottom: `1px solid ${GRAY.border}`, padding: '1rem 2rem' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <a href={ROOT}><img src="/nssa-logo.png" alt="National Social Security Advisors" style={{ height: '44px', width: 'auto' }} /></a>
            <nav className="site-nav" style={{ display: 'flex', gap: '26px', alignItems: 'center', fontSize: '15px' }}>
              {[
                ['About Us', `${ROOT}/about`],
                ['Social Security Training', NSSA_COURSE],
                ['IRMAA Medicare Training', IRMAA_COURSE],
                ['Find an Advisor', `${SITE}/`],
                ['Contact Us', `${ROOT}/contact`],
              ].map(([label, href]) => (
                <a key={label} href={href} style={{ color: GRAY.dark, textDecoration: 'none' }}>{label}</a>
              ))}
            </nav>
          </div>
        </header>

        {/* Hero */}
        <section className="section-pad" style={{ background: GRAY.bg, padding: '3rem 2rem' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
            <h1 className="page-h1" style={{ fontSize: '2.4rem', fontWeight: 700, color: IRMAA.dark, marginBottom: '2rem' }}>{h1}</h1>
            <div className="hero-grid" style={{ display: 'grid', gridTemplateColumns: '280px 1fr 280px', gap: '2.5rem', alignItems: 'start' }}>

              {/* Photo */}
              <div className="headshot-col">
                {member.profile_photo
                  ? <>
                      <img
                        src={member.profile_photo}
                        alt={photoAlt}
                        width="280" height="294"
                        loading="eager" fetchpriority="high"
                        style={{ width: '100%', height: 'auto', aspectRatio: '280 / 294', objectFit: 'cover', objectPosition: 'top', borderRadius: '4px', display: 'block' }}
                        onError={(e) => {
                          const fb = e.currentTarget.nextElementSibling
                          e.currentTarget.style.display = 'none'
                          if (fb) fb.style.display = 'flex'
                        }}
                      />
                      <div style={{ display: 'none', width: '100%', aspectRatio: '280 / 294', background: '#e2e5ea', borderRadius: '4px', overflow: 'hidden', alignItems: 'flex-end', justifyContent: 'center' }} aria-hidden="true">
                        <svg viewBox="0 0 64 64" width="70%" height="70%" style={{ display: 'block' }}>
                          <circle cx="32" cy="23" r="13" fill="#b9bec7" />
                          <path d="M8 64c0-14 11-23 24-23s24 9 24 23z" fill="#b9bec7" />
                        </svg>
                      </div>
                    </>
                  : <HeadshotSilhouette />}
              </div>

              {/* Details */}
              <div>
                <h2 style={{ fontSize: '1.7rem', fontWeight: 700, marginTop: 0, marginBottom: '2px', lineHeight: 1.2 }}>{name}</h2>
                {(member.job_title || member.company) && (
                  <p style={{ fontFamily: '"Poppins", system-ui, sans-serif', fontWeight: 400, fontSize: '16px', color: GRAY.dark, marginTop: 0, marginBottom: '18px' }}>
                    {[member.job_title, member.company].filter(Boolean).join(', ')}
                  </p>
                )}
                <div style={{ fontSize: '15px', color: GRAY.dark, lineHeight: 1.7, marginBottom: '10px' }}>
                  {member.address && <div>{member.address}</div>}
                  {(member.city || member.state) && <div>{[member.city, member.state].filter(Boolean).join(', ')}{member.zip ? ` ${member.zip}` : ''}</div>}
                </div>
                {phone && <p style={{ fontSize: '16px', marginTop: 0, marginBottom: '4px' }}><a href={`tel:${phone.replace(/[^0-9+]/g, '')}`} style={{ color: NSSA.medium, textDecoration: 'none' }}>{phone}</a></p>}
                {web && <p style={{ fontSize: '15px', marginTop: 0, marginBottom: '16px' }}><a href={web} target="_blank" rel="nofollow noopener noreferrer" style={{ color: NSSA.medium, textDecoration: 'none' }}>{cleanWebsite(member.website)}</a></p>}

                {/* Cert badges — linked to the relevant training pages */}
                <div style={{ display: 'flex', gap: '14px', marginLeft: '-4px' }}>
                  {hasNssa && <a href={NSSA_COURSE} aria-label="NSSA® Social Security training"><img src="/nssa-certificate-badge.png" alt={`NSSA® Certified${member.nssa_number ? ` #${member.nssa_number}` : ''}`} width="92" height="92" loading="lazy" style={{ height: '92px', width: 'auto', display: 'block' }} /></a>}
                  {hasIrmaa && <a href={IRMAA_COURSE} aria-label="IRMAACP™ Medicare training"><img src="/irmaa-certificate-badge.png" alt={`IRMAACP™ Certified${member.irmaa_number ? ` #${member.irmaa_number}` : ''}`} width="92" height="92" loading="lazy" style={{ height: '92px', width: 'auto', display: 'block' }} /></a>}
                </div>
              </div>

              {/* Action buttons */}
              <div className="actions-col">
                {web && <a href={web} target="_blank" rel="nofollow noopener noreferrer" style={pillBtn}>Visit Website</a>}
                {phone && <a href={`tel:${phone.replace(/[^0-9+]/g, '')}`} style={pillBtn}>Call {fname}</a>}
                {member.email && <a href={`mailto:${member.email}`} style={pillBtn}>Email {fname}</a>}
                {member.linkedin_url && <a href={websiteHref(member.linkedin_url)} target="_blank" rel="nofollow noopener noreferrer" style={pillBtn}>Connect on LinkedIn</a>}
              </div>
            </div>
          </div>
        </section>

        {/* Body: Professional Profile + Contact form */}
        <section className="section-pad" style={{ background: 'white', padding: '3.5rem 2rem' }}>
          <div className="body-grid" style={{ maxWidth: '1200px', margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 420px', gap: '3rem', alignItems: 'start' }}>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '1.5rem' }}>
                <span style={{ display: 'inline-block', width: '5px', height: '34px', background: GRAY.dark, borderRadius: '2px' }} />
                <h2 style={{ fontSize: '1.9rem', fontWeight: 800, color: GRAY.dark }}>Professional Profile</h2>
              </div>
              <nav aria-label="Breadcrumb" style={{ marginBottom: '1.75rem' }}>
                <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px', fontSize: '14px', color: GRAY.text }}>
                  {breadcrumbs.map((b, i) => (
                    <li key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '10px' }}>
                      {b.href
                        ? <a href={b.href} style={{ color: NSSA.medium, textDecoration: 'none', fontWeight: 600 }}>{b.label}</a>
                        : <span aria-current="page" style={{ color: GRAY.text }}>{b.label}</span>}
                      {i < breadcrumbs.length - 1 && <span style={{ color: GRAY.text, userSelect: 'none', fontWeight: 600 }}>&gt;</span>}
                    </li>
                  ))}
                </ol>
              </nav>
              {paragraphs.map((p, i) => (
                <React.Fragment key={i}>
                  <p style={{ fontSize: '16px', color: '#374151', lineHeight: 1.75, marginBottom: '1.1rem' }}>{p}</p>
                  {credLine && i === credInsertAfter ? credLine : null}
                </React.Fragment>
              ))}
              {/* Fallback: if there were no paragraphs, still show the credibility line */}
              {credLine && paragraphs.length === 0 ? credLine : null}
            </div>

            <ContactForm advisorName={name} advisorEmail={member.email} slug={slug} />
          </div>
        </section>

        {/* Value-prop band — matches the Kajabi "How an NSSA Advisor Will Help You" */}
        <section className="section-pad" style={{ background: '#e7e2d6', padding: '4rem 2rem' }}>
          <div style={{ maxWidth: '1100px', margin: '0 auto', textAlign: 'center' }}>
            <h2 style={{ fontSize: '2rem', fontWeight: 800, color: GRAY.dark, marginBottom: '1rem' }}>How an NSSA® Certified Advisor Will Help You</h2>
            <p style={{ fontSize: '16px', color: GRAY.text, maxWidth: '720px', margin: '0 auto 3rem', lineHeight: 1.6 }}>
              An NSSA® Certified Advisor provides the knowledge and expertise needed to maximize your Social Security benefits and help you achieve a secure retirement.
            </p>
            <div className="valueprop-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '2.5rem' }}>
              {[
                ['/social-security-mistakes.png', 'Avoid Costly Social Security Claiming Mistakes', 'Navigating Social Security rules can be complex, and even small mistakes can cost you thousands of dollars in lost benefits. An NSSA® Certified Advisor ensures you make informed decisions and avoid costly errors.'],
                ['/holistic-financial-planning.png', 'Holistic Retirement Planning', 'An NSSA® Advisor integrates your Social Security strategy with your overall retirement plan, ensuring your assets work together to meet your financial goals and a clearer path to a secure future.'],
                ['/social-security-guidance.png', 'Guidance You Won\u2019t Get from the Social Security Office', 'The Social Security office provides information but doesn\u2019t offer personalized advice or strategies. An NSSA® Certified Advisor delivers tailored solutions based on your unique circumstances and goals.'],
              ].map(([icon, title, body]) => (
                <div key={title}>
                  <img src={icon} alt="" width="72" height="72" loading="lazy" style={{ width: '72px', height: '72px', objectFit: 'contain', display: 'block', margin: '0 auto 1.25rem' }} />
                  <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: GRAY.dark, marginBottom: '0.9rem', lineHeight: 1.3 }}>{title}</h3>
                  <p style={{ fontSize: '15px', color: GRAY.text, lineHeight: 1.6 }}>{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer style={{ background: '#6b5e3d', borderTop: `10px solid ${TAN}`, padding: '1.75rem 2rem' }}>
          <div style={{ maxWidth: '1200px', margin: '0 auto', display: 'flex', alignItems: 'center', gap: '2rem', flexWrap: 'wrap' }}>
            <a href={ROOT}><img src="/nssa-logo-white.png" alt="NSSA" style={{ height: '40px', width: 'auto' }} /></a>
            <span style={{ color: 'white', fontSize: '14px' }}>
              © {new Date().getFullYear()} Social Security Professionals, LLC · 1763 Columbia Road NW Ste 175 Washington, DC 20009
            </span>
          </div>
        </footer>
      </div>
    </>
  )
}
