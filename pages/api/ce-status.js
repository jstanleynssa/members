import { createClient } from '@supabase/supabase-js'

const KAJABI_API   = 'https://api.kajabi.com/v1'
const KAJABI_TOKEN = 'https://api.kajabi.com/v1/oauth/token'

// Membership offer IDs whose active_until = annual dues renewal
const MEMBERSHIP_OFFER_IDS = new Set([2149702553, 2150711684, 2150754803])

// Returns { duesRenewalDate: 'YYYY-MM-DD' | null, isLifetime: bool }
// fetch with a hard timeout so Kajabi API slowness never hangs the endpoint
async function fetchWithTimeout(url, options, ms) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    const res = await fetch(url, { ...options, signal: ctrl.signal })
    clearTimeout(timer)
    return res
  } catch (e) {
    clearTimeout(timer)
    throw e
  }
}

// Returns { duesRenewalDate: 'YYYY-MM-DD' | null, isLifetime: bool }
async function getKajabiMemberData(email) {
  try {
    // 1. OAuth token — 4s timeout
    const params = new URLSearchParams()
    params.append('grant_type',    'client_credentials')
    params.append('client_id',     process.env.KAJABI_CLIENT_ID)
    params.append('client_secret', process.env.KAJABI_CLIENT_SECRET)
    const tokenRes = await fetchWithTimeout(KAJABI_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    }, 4000)
    if (!tokenRes.ok) return { duesRenewalDate: null, isLifetime: false }
    const { access_token } = await tokenRes.json()
    const headers = {
      'Authorization': `Bearer ***}`,
      'Accept': 'application/vnd.api+json',
    }

    // 2. Find contact by email — 4s timeout
    const contactRes = await fetchWithTimeout(
      `${KAJABI_API}/contacts?filter[email]=${encodeURIComponent(email)}`,
      { headers }, 4000
    )
    if (!contactRes.ok) return { duesRenewalDate: null, isLifetime: false }
    const contactData = await contactRes.json()
    const contact = contactData?.data?.[0]
    if (!contact) return { duesRenewalDate: null, isLifetime: false }

    // 3. Lifetime check — any tag containing 'lifetime' (case-insensitive)
    const tags = contact.attributes?.tags || []
    const isLifetime = tags.some(t => /lifetime/i.test(String(t)))
    if (isLifetime) return { duesRenewalDate: null, isLifetime: true }

    // 4. Purchases — 4s timeout, filter client-side (Kajabi filter bug)
    const purchasesRes = await fetchWithTimeout(
      `${KAJABI_API}/purchases?filter[contact_id]=${contact.id}`,
      { headers }, 4000
    )
    if (!purchasesRes.ok) return { duesRenewalDate: null, isLifetime: false }
    const purchasesData = await purchasesRes.json()

    const today = new Date()
    let best = null
    for (const p of purchasesData?.data || []) {
      const offerId = Number(p.attributes?.offer_id || p.relationships?.offer?.data?.id)
      const until = p.attributes?.active_until
      if (!until) continue
      const d = new Date(until)
      if (d <= today) continue
      if (MEMBERSHIP_OFFER_IDS.has(offerId) && (!best || d > best)) best = d
    }
    if (!best) {
      for (const p of purchasesData?.data || []) {
        const until = p.attributes?.active_until
        if (!until) continue
        const d = new Date(until)
        if (d > today && (!best || d > best)) best = d
      }
    }
    return { duesRenewalDate: best ? best.toISOString().slice(0, 10) : null, isLifetime: false }
  } catch (e) {
    return { duesRenewalDate: null, isLifetime: false }
  }
}

export default async function handler(req, res) {
  // Allow CORS from Kajabi / nssapros.com only
  const origin = req.headers.origin || ''
  const allowed = origin.includes('nssapros.com') || origin.includes('arpinstitute.com') || origin.includes('kajabi.com') || origin.includes('kajabipages.com')
  if (allowed) res.setHeader('Access-Control-Allow-Origin', origin)
  else res.setHeader('Access-Control-Allow-Origin', 'https://arpinstitute.com')
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'GET') return res.status(405).end()

  const email = (req.query.email || '').trim().toLowerCase()
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Valid email required' })
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const currentYear = new Date().getFullYear()

  // Get member cert flags
  const { data: member } = await supabase
    .from('members')
    .select('nssa_certified, irmaa_certified, nssa_cert_date, irmaa_cert_date, first_name, last_name')
    .eq('email', email)
    .single()

  if (!member) {
    // found: false signals the Kajabi block to hide itself entirely
    return res.status(200).json({
      found: false,
      email,
      nssaCertified: false,
      irmaaCertified: false,
      nssaHours: 0,
      irmaaHours: 0,
      nssaRequired: 4,
      irmaaRequired: 4,
      nssaMet: false,
      irmaaMet: false,
      year: currentYear
    })
  }

  // Designation year exemption
  const certYear = (d) => d ? new Date(d).getFullYear() : null
  const nssaExempt = certYear(member.nssa_cert_date) === currentYear
  const irmaaExempt = certYear(member.irmaa_cert_date) === currentYear

  // Get approved CE hours for current year
  const { data: subs } = await supabase
    .from('ce_submissions')
    .select('designation, hours_earned')
    .eq('email', email)
    .eq('status', 'approved')
    .eq('year', currentYear)

  const nssaHours = (subs || [])
    .filter(s => s.designation === 'NSSA' || s.designation === 'both')
    .reduce((sum, s) => sum + Number(s.hours_earned), 0)

  const irmaaHours = (subs || [])
    .filter(s => s.designation === 'IRMAA' || s.designation === 'both')
    .reduce((sum, s) => sum + Number(s.hours_earned), 0)

  const nssaMet = !member.nssa_certified ? true : (nssaExempt || nssaHours >= 4)
  const irmaaMet = !member.irmaa_certified ? true : (irmaaExempt || irmaaHours >= 4)

  // Fetch dues/lifetime data from Kajabi — non-blocking
  const kajabiData = await getKajabiMemberData(email).catch(() => ({ duesRenewalDate: null, isLifetime: false }))
  const { duesRenewalDate, isLifetime } = kajabiData

  // Cache for 5 minutes
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')

  return res.status(200).json({
    found: true,
    email,
    firstName:  member.first_name  || '',
    lastName:   member.last_name   || '',
    duesRenewalDate: duesRenewalDate || null,
    isLifetime: isLifetime || false,
    nssaCertified: !!member.nssa_certified,
    irmaaCertified: !!member.irmaa_certified,
    nssaHours: nssaExempt ? 4 : nssaHours,
    irmaaHours: irmaaExempt ? 4 : irmaaHours,
    nssaRequired: 4,
    irmaaRequired: 4,
    nssaMet,
    irmaaMet,
    nssaExempt,
    irmaaExempt,
    year: currentYear
  })
}
