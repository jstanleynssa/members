// pages/api/contact-advisor.js
// Receives a directory contact-form submission, emails the inquiry to the
// advisor (reply-to the prospect), and sends a confirmation to the prospect.
// Uses Resend (RESEND_API_KEY). No external SDK required — calls the REST API.

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

// From address must be on a Resend-verified domain (e.g. mail.nssapros.com).
const FROM = 'NSSA Advisor Directory <directory@mail.nssapros.com>'
const SITE = 'https://directory.nssapros.com'

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function isEmail(str) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(str || '').trim())
}

async function sendEmail(payload) {
  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, ...payload }),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(`Resend ${res.status}: ${txt}`)
  }
  return res.json()
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { name, email, phone, message, advisorEmail, advisorName, slug } = req.body || {}

  // Validation — server-side, never trust the client.
  if (!name || !email || !message) {
    return res.status(400).json({ error: 'Name, email, and message are required.' })
  }
  if (!isEmail(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' })
  }
  if (!advisorEmail || !isEmail(advisorEmail)) {
    return res.status(400).json({ error: 'Invalid advisor.' })
  }

  // Light honeypot / length guards against spam bots.
  if (String(message).length > 5000 || String(name).length > 200) {
    return res.status(400).json({ error: 'Submission too long.' })
  }

  const safe = {
    name: escapeHtml(name),
    email: escapeHtml(email),
    phone: escapeHtml(phone),
    message: escapeHtml(message).replace(/\n/g, '<br>'),
    advisorName: escapeHtml(advisorName || 'your NSSA advisor'),
  }
  const profileUrl = slug ? `${SITE}/${slug}` : SITE

  try {
    // 1) Inquiry → advisor. Reply-to is the prospect so a reply goes to them.
    await sendEmail({
      to: advisorEmail,
      reply_to: email,
      subject: `New inquiry from ${name} — NSSA Advisor Directory`,
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#1f2937">
          <h2 style="color:#13405E;font-size:18px">New contact-form inquiry</h2>
          <p style="font-size:14px;color:#6b7280">
            Someone reached out through your profile on the NSSA Advisor Directory.
          </p>
          <table style="font-size:14px;border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Name</td><td style="padding:4px 0"><strong>${safe.name}</strong></td></tr>
            <tr><td style="padding:4px 12px 4px 0;color:#6b7280">Email</td><td style="padding:4px 0"><a href="mailto:${safe.email}">${safe.email}</a></td></tr>
            ${safe.phone ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280">Phone</td><td style="padding:4px 0">${safe.phone}</td></tr>` : ''}
          </table>
          <div style="background:#f3f4f6;border-radius:8px;padding:14px 16px;font-size:14px;line-height:1.6">
            ${safe.message}
          </div>
          <p style="font-size:13px;color:#6b7280;margin-top:16px">
            Reply directly to this email to respond to ${safe.name}.<br>
            Profile: <a href="${profileUrl}">${profileUrl}</a>
          </p>
        </div>
      `,
    })

    // 2) Confirmation → prospect.
    await sendEmail({
      to: email,
      reply_to: advisorEmail,
      subject: `Your message to ${advisorName || 'your NSSA advisor'} has been sent`,
      html: `
        <div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#1f2937">
          <h2 style="color:#13405E;font-size:18px">Message sent</h2>
          <p style="font-size:14px;line-height:1.6">
            Hi ${safe.name},<br><br>
            Thanks for reaching out to <strong>${safe.advisorName}</strong> through the NSSA Advisor Directory.
            Your message has been delivered, and they'll be in touch with you soon.
          </p>
          <div style="background:#f3f4f6;border-radius:8px;padding:14px 16px;font-size:14px;line-height:1.6;margin:16px 0">
            <p style="color:#6b7280;margin:0 0 6px;font-size:12px">Your message:</p>
            ${safe.message}
          </div>
          <p style="font-size:13px;color:#6b7280">
            This is an automated confirmation — you can reply to this email to reach ${safe.advisorName} directly.
          </p>
        </div>
      `,
    })

    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('[contact-advisor]', err.message)
    return res.status(500).json({ error: 'Could not send your message. Please try again.' })
  }
}
