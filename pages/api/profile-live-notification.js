// pages/api/profile-live-notification.js  (MEMBERS app)
// Sends a one-time "your directory profile is live" confirmation email to an
// advisor right after they finish the build-out wizard. Uses Resend's REST API
// (no SDK), sending from the verified updates.nssapros.com domain — same setup
// as the directory's contact-advisor route.
//
// Design note: this is best-effort. The caller (finish() in profile.js) must
// NOT block the advisor's completion on this email — the profile is already
// saved by the time we get here. If Resend fails, we log and return a soft
// error; the wizard still sends the advisor to their dashboard.

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const FROM = 'NSSA Advisor Directory <directory@updates.nssapros.com>'
const DIRECTORY = 'https://directory.nssapros.com'

function isEmail(str) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(str || '').trim())
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { email, firstName } = req.body || {}
  if (!email || !isEmail(email)) {
    return res.status(400).json({ error: 'Valid email required.' })
  }

  const fname = escapeHtml((firstName || '').trim()) || 'there'

  try {
    const r = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM,
        to: email,
        subject: 'Your NSSA Advisor Directory profile is live',
        html: `
          <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#1f2937">
            <h2 style="color:#13405E;font-size:20px;margin-bottom:8px">You're on the directory, ${fname}!</h2>
            <p style="font-size:15px;line-height:1.6">
              Your profile is now live on the public <strong>NSSA® Advisor Directory</strong>.
              Prospective clients searching for a certified Social Security or Medicare
              planning professional can now find you, view your bio, and contact you directly.
            </p>
            <p style="font-size:15px;line-height:1.6;margin:20px 0">
              <a href="${DIRECTORY}/" style="background:#1C80BC;color:white;text-decoration:none;padding:11px 22px;border-radius:999px;font-weight:600;display:inline-block">
                View the directory
              </a>
            </p>
            <p style="font-size:14px;color:#6b7280;line-height:1.6">
              You'll find your profile by searching your name on the directory. Want to make
              changes? Just log back in to your member dashboard and edit your profile any time —
              updates appear on the directory automatically.
            </p>
            <p style="font-size:13px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:14px;margin-top:20px">
              National Social Security Advisors (NSSA®)
            </p>
          </div>
        `,
      }),
    })

    if (!r.ok) {
      const txt = await r.text()
      console.error('[profile-live-notification] Resend', r.status, txt)
      // Soft failure: the profile is live regardless; don't surface as fatal.
      return res.status(200).json({ ok: false, emailed: false })
    }

    return res.status(200).json({ ok: true, emailed: true })
  } catch (err) {
    console.error('[profile-live-notification]', err.message)
    return res.status(200).json({ ok: false, emailed: false })
  }
}
