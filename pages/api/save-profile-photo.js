import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'

// Target dimensions for profile photos
const TARGET_WIDTH = 676
const TARGET_HEIGHT = 696
const TARGET_DPI = 144

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { email, photoUrl } = req.body
  if (!email || !photoUrl) {
    return res.status(400).json({ error: 'Missing email or photoUrl' })
  }

  const imagineKey = process.env.IMAGINE_ART_API_KEY

  try {
    // ── Step 1: Download from signed S3 URL ──────────────────────────────────
    console.log(`[photo] Downloading for ${email}`)
    const s3Res = await fetch(photoUrl)
    if (!s3Res.ok) return res.status(400).json({ error: `S3 fetch failed: ${s3Res.status}` })
    let imgBuffer = Buffer.from(await s3Res.arrayBuffer())
    let mimeType = s3Res.headers.get('content-type') || 'image/jpeg'

    // ── Step 2: Remove background ─────────────────────────────────────────────
    if (imagineKey) {
      try {
        console.log(`[photo] Removing background...`)
        const form = new FormData()
        form.append('image', new Blob([imgBuffer], { type: mimeType }), 'photo.jpg')
        const bgRes = await fetch('https://api.vyro.ai/v2/image/background/remover', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${imagineKey}` },
          body: form
        })
        if (bgRes.ok) {
          imgBuffer = Buffer.from(await bgRes.arrayBuffer())
          mimeType = 'image/png' // background remover returns PNG
          console.log(`[photo] Background removed ✓`)
        } else {
          console.warn(`[photo] BG removal failed (${bgRes.status}) — continuing`)
        }
      } catch (e) {
        console.warn(`[photo] BG removal error: ${e.message} — continuing`)
      }

      // ── Step 3: Upgrade clothing to business attire via Generative Fill ───
      // Generate a body mask: white in the lower ~60% (body/clothing area),
      // black in the upper ~40% (face/head area — preserved untouched)
      try {
        console.log(`[photo] Generating clothing upgrade mask...`)
        const meta = await sharp(imgBuffer).metadata()
        const imgW = meta.width || TARGET_WIDTH
        const imgH = meta.height || TARGET_HEIGHT
        const faceZone = Math.floor(imgH * 0.42) // protect top 42% (face/hair)

        // Create mask: black (protected) on top, white (fill) on bottom
        const maskBuffer = await sharp({
          create: {
            width: imgW,
            height: imgH,
            channels: 3,
            background: { r: 0, g: 0, b: 0 }
          }
        })
          .composite([{
            input: {
              create: {
                width: imgW,
                height: imgH - faceZone,
                channels: 3,
                background: { r: 255, g: 255, b: 255 }
              }
            },
            top: faceZone,
            left: 0
          }])
          .jpeg()
          .toBuffer()

        const clothingForm = new FormData()
        clothingForm.append('image', new Blob([imgBuffer], { type: mimeType }), 'photo.jpg')
        clothingForm.append('mask', new Blob([maskBuffer], { type: 'image/jpeg' }), 'mask.jpg')
        clothingForm.append('prompt',
          'professional business attire, formal suit jacket, collared shirt, ' +
          'corporate professional headshot style, high quality, photorealistic'
        )

        const fillRes = await fetch('https://api.vyro.ai/v2/image/edits/generative-fill', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${imagineKey}` },
          body: clothingForm
        })

        if (fillRes.ok) {
          imgBuffer = Buffer.from(await fillRes.arrayBuffer())
          mimeType = fillRes.headers.get('content-type') || 'image/jpeg'
          console.log(`[photo] Clothing upgraded ✓`)
        } else {
          const errText = await fillRes.text()
          console.warn(`[photo] Clothing upgrade failed (${fillRes.status}): ${errText} — continuing`)
        }
      } catch (e) {
        console.warn(`[photo] Clothing upgrade error: ${e.message} — continuing`)
      }

      // ── Step 4: Enhance / upscale ─────────────────────────────────────────
      try {
        console.log(`[photo] Enhancing...`)
        const enhForm = new FormData()
        enhForm.append('image', new Blob([imgBuffer], { type: mimeType }), 'photo.jpg')
        const enhRes = await fetch('https://api.vyro.ai/v2/image/enhance', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${imagineKey}` },
          body: enhForm
        })
        if (enhRes.ok) {
          imgBuffer = Buffer.from(await enhRes.arrayBuffer())
          mimeType = enhRes.headers.get('content-type') || 'image/jpeg'
          console.log(`[photo] Enhanced ✓`)
        } else {
          console.warn(`[photo] Enhancement failed — continuing`)
        }
      } catch (e) {
        console.warn(`[photo] Enhancement error: ${e.message} — continuing`)
      }
    }

    // ── Step 5: Face-centered crop + resize to 676×696 at 144ppi ─────────────
    // After BG removal the subject is centered. We use Sharp's 'cover' with
    // 'top' gravity which naturally keeps the head/face in frame for portraits.
    console.log(`[photo] Resizing to ${TARGET_WIDTH}x${TARGET_HEIGHT} at ${TARGET_DPI}ppi...`)
    imgBuffer = await sharp(imgBuffer)
      .resize(TARGET_WIDTH, TARGET_HEIGHT, {
        fit: 'cover',
        position: 'top'  // anchors to top so face stays in frame
      })
      .withMetadata({ density: TARGET_DPI }) // sets 144ppi
      .jpeg({ quality: 92 })
      .toBuffer()
    mimeType = 'image/jpeg'
    console.log(`[photo] Resized ✓`)

    // ── Step 6: Upload to Supabase Storage ────────────────────────────────────
    const safeEmail = email.toLowerCase().replace(/[^a-z0-9]/g, '-')
    const filename = `${safeEmail}-${Date.now()}.jpg`
    // Simplfiy storage path
    const storagePath = filename

    


    const { error: uploadError } = await supabase.storage
      .from('profile-photos')
      .upload(storagePath, imgBuffer, { contentType: 'image/jpeg', upsert: true })

    if (uploadError) {
      return res.status(500).json({ error: `Upload failed: ${uploadError.message}` })
    }

    const { data: urlData } = supabase.storage
      .from('profile-photos')
      .getPublicUrl(storagePath)

    const permanentUrl = urlData.publicUrl

    // ── Step 7: Update member record ─────────────────────────────────────────
    const { error: updateError } = await supabase
      .from('members')
      .update({ profile_photo: permanentUrl })
      .eq('email', email)

    if (updateError) {
      return res.status(500).json({ error: `Member update failed: ${updateError.message}` })
    }

    console.log(`[photo] ✓ Complete for ${email} → ${permanentUrl}`)
    return res.status(200).json({ ok: true, email, profile_photo: permanentUrl })

  } catch (err) {
    console.error('[photo] Unexpected error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
