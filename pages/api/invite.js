// pages/api/invite.js
//
// Sends a freshly-certified advisor a "create your directory listing" email
// containing a SECURE, EXPIRING, SINGLE-USE magic link that logs them straight
// into the dashboard profile form (/dashboard#profile).
//
// This is the endpoint the post-exam Zapier automation will call when a
// certification tag is applied in Kajabi. It can also be called manually for
// testing.
//
// Security note: we deliberately use Supabase's generateLink (a one-time,
// expiring token) rather than a reusable ?email= SSO URL. The link in the
// email expires (default ~1 hour) and works once. If it expires, the advisor
// just uses the normal login page to request a fresh code.
//
// Request body: { email, firstName?, certType?, dryRun? }
//   - email     (required) the advisor's email
//   - firstName (optional) used in the greeting; falls back to the member record
//   - certType  (optional) 'NSSA' | 'IRMAACP' | 'both' — tailors the copy
//   - dryRun     (optional) if true, generates the link and RETURNS it in the
//                response WITHOUT sending an email (safe testing)

import { Resend } from 'resend'
import { createClient } from '@supabase/supabase-js'

const resend = new Resend(process.env.RESEND_API_KEY)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const PORTAL_URL = 'https://members.nssapros.com'
const PROFILE_DESTINATION = `${PORTAL_URL}/dashboard#profile`

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  // ── Shared-secret guard ────────────────────────────────────────────────────
  // This endpoint lives outside the auth middleware (the Zap calls it with no
  // session), so we gate it with a secret token. The Zap must send
  // `x-invite-secret: <INVITE_SECRET>` (or { secret } in the body). Set
  // INVITE_SECRET in the members app's Vercel env. If INVITE_SECRET is not set,
  // the guard is skipped (convenient for first local tests) — but set it before
  // wiring the Zap so the endpoint can't be triggered by anyone who finds the URL.
  const requiredSecret = process.env.INVITE_SECRET
  if (requiredSecret) {
    const provided = req.headers['x-invite-secret'] || req.body.secret
    if (provided !== requiredSecret) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
  }

  const email = (req.body.email || '').trim().toLowerCase()
  const dryRun = req.body.dryRun === true
  const certType = req.body.certType || null
  if (!email) return res.status(400).json({ error: 'Missing email' })

  // ── 1. Confirm this is a real, certified member ────────────────────────────
  const { data: member, error: memberErr } = await supabase
    .from('members')
    .select('email, first_name, last_name, nssa_certified, irmaa_certified')
    .eq('email', email)
    .single()

  if (memberErr || !member) {
    return res.status(404).json({ error: `No member found for ${email}` })
  }
  if (!member.nssa_certified && !member.irmaa_certified) {
    return res.status(403).json({ error: `${email} is not certified — no invite sent.` })
  }

  const firstName = (req.body.firstName || member.first_name || '').trim() || 'there'

  // Tailor the credential wording. Prefer an explicit certType from the caller
  // (the Zap knows which tag fired); otherwise infer from the member record.
  const resolvedType =
    certType ||
    (member.nssa_certified && member.irmaa_certified ? 'both'
      : member.nssa_certified ? 'NSSA'
      : 'IRMAACP')

  const credentialPhrase =
    resolvedType === 'both' ? 'NSSA® and IRMAACP™ certifications'
      : resolvedType === 'IRMAACP' ? 'IRMAACP™ certification'
      : 'NSSA® certification'

  // ── 2. Generate a secure, expiring, single-use magic link ──────────────────
  // type 'magiclink' creates the auth user if needed and produces a one-time
  // action_link. We point its post-login redirect at the profile form.
  const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
    options: { redirectTo: PROFILE_DESTINATION },
  })

  if (linkErr || !linkData?.properties?.action_link) {
    console.error('[invite] generateLink error:', linkErr?.message)
    return res.status(500).json({ error: 'Could not generate sign-in link' })
  }

  const actionLink = linkData.properties.action_link

  // ── 3. Dry run: return the link, don't send ────────────────────────────────
  if (dryRun) {
    return res.status(200).json({
      ok: true,
      dryRun: true,
      email,
      firstName,
      certType: resolvedType,
      action_link: actionLink,
      note: 'No email sent (dryRun). This link is single-use and will expire.',
    })
  }

  // ── 4. Send the invitation email (house style) ─────────────────────────────
  try {
    await resend.emails.send({
      from: 'NSSA Member Portal <noreply@updates.nssapros.com>',
      to: email,
      subject: 'Create your professional directory listing',
      html: `
        <div style="font-family: system-ui, sans-serif; max-width: 520px; margin: 0 auto; padding: 2rem;">
          <div style="background: #13405E; color: white; padding: 1rem 1.5rem; border-radius: 8px 8px 0 0;">
            <p style="margin: 0; font-weight: 700; font-size: 16px;">NSSA Member Portal</p>
          </div>
          <div style="border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; padding: 1.5rem;">
            <p style="font-size: 15px;">Congratulations, ${firstName}!</p>
            <p style="color: #374151; line-height: 1.6;">
              You've earned your ${credentialPhrase}. The next step is to create your
              listing in the public NSSA Advisor Directory, where prospective clients
              search for certified professionals in their area.
            </p>
            <p style="color: #374151; line-height: 1.6;">
              Click below to set up your profile — add your bio, photo, contact details,
              and the areas you serve. You'll be signed in automatically.
            </p>
            <div style="text-align: center; margin: 1.75rem 0;">
              <a href="${actionLink}"
                 style="display: inline-block; background: #1C80BC; color: white; text-decoration: none;
                        font-weight: 600; font-size: 15px; padding: 12px 28px; border-radius: 6px;">
                Create My Directory Listing
              </a>
            </div>
            <p style="font-size: 13px; color: #6b7280; line-height: 1.6;">
              For your security, this link signs you in once and expires after a short time.
              If it stops working, just visit
              <a href="${PORTAL_URL}/login" style="color: #1C80BC;">members.nssapros.com</a>
              and request a new login code.
            </p>
            <p style="color: #374151;">Welcome to the directory,<br>The NSSA Team</p>
          </div>
        </div>
      `,
    })
    return res.status(200).json({ ok: true, email, certType: resolvedType })
  } catch (err) {
    console.error('[invite] Resend error:', err)
    return res.status(500).json({ error: err.message })
  }
}
