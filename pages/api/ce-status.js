import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  // Allow CORS from Kajabi / nssapros.com only
  const origin = req.headers.origin || ''
  const allowed = origin.includes('nssapros.com') || origin.includes('kajabi.com') || origin.includes('kajabipages.com')
  if (allowed) res.setHeader('Access-Control-Allow-Origin', origin)
  else res.setHeader('Access-Control-Allow-Origin', 'https://www.nssapros.com')
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
    return res.status(200).json({
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

  // Cache for 5 minutes
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60')

  return res.status(200).json({
    email,
    firstName: member.first_name || '',
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
