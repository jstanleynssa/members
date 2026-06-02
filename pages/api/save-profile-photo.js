import { createClient } from '@supabase/supabase-js'

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

  const imagineApiKey = process.env.IMAGINE_ART_API_KEY

  try {
    // Step 1 — Download image from signed S3 URL
    console.log(`[save-profile-photo] Fetching image for ${email}`)
    const imageResponse = await fetch(photoUrl)
    if (!imageResponse.ok) {
      return res.status(400).json({ error: `Failed to fetch image: ${imageResponse.status}` })
    }
    let imageBuffer = Buffer.from(await imageResponse.arrayBuffer())
    let contentType = imageResponse.headers.get('content-type') || 'image/jpeg'

    // Step 2 — Remove background via imagine.art
    if (imagineApiKey) {
      try {
        console.log(`[save-profile-photo] Removing background...`)
        const bgFormData = new FormData()
        bgFormData.append('image', new Blob([imageBuffer], { type: contentType }), 'photo.jpg')

        const bgResponse = await fetch('https://api.vyro.ai/v2/image/background/remover', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${imagineApiKey}` },
          body: bgFormData
        })

        if (bgResponse.ok) {
          imageBuffer = Buffer.from(await bgResponse.arrayBuffer())
          contentType = bgResponse.headers.get('content-type') || 'image/png'
          console.log(`[save-profile-photo] Background removed ✓`)
        } else {
          const errText = await bgResponse.text()
          console.warn(`[save-profile-photo] Background removal failed (${bgResponse.status}): ${errText} — continuing with original`)
        }
      } catch (bgErr) {
        console.warn(`[save-profile-photo] Background removal error: ${bgErr.message} — continuing with original`)
      }

      // Step 3 — Enhance/upscale via imagine.art
      try {
        console.log(`[save-profile-photo] Enhancing image...`)
        const enhFormData = new FormData()
        enhFormData.append('image', new Blob([imageBuffer], { type: contentType }), 'photo.jpg')

        const enhResponse = await fetch('https://api.vyro.ai/v2/image/enhance', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${imagineApiKey}` },
          body: enhFormData
        })

        if (enhResponse.ok) {
          imageBuffer = Buffer.from(await enhResponse.arrayBuffer())
          contentType = enhResponse.headers.get('content-type') || 'image/jpeg'
          console.log(`[save-profile-photo] Image enhanced ✓`)
        } else {
          const errText = await enhResponse.text()
          console.warn(`[save-profile-photo] Enhancement failed (${enhResponse.status}): ${errText} — continuing without enhancement`)
        }
      } catch (enhErr) {
        console.warn(`[save-profile-photo] Enhancement error: ${enhErr.message} — continuing without enhancement`)
      }
    } else {
      console.warn('[save-profile-photo] IMAGINE_ART_API_KEY not set — skipping AI processing')
    }

    // Step 4 — Upload final image to Supabase Storage
    const ext = contentType.includes('png') ? 'png'
      : contentType.includes('webp') ? 'webp'
      : 'jpg'
    const safeEmail = email.toLowerCase().replace(/[^a-z0-9]/g, '-')
    const filename = `${safeEmail}-${Date.now()}.${ext}`
    const storagePath = `profile-photos/${filename}`

    console.log(`[save-profile-photo] Uploading to Supabase Storage...`)
    const { error: uploadError } = await supabase.storage
      .from('profile-photos')
      .upload(storagePath, imageBuffer, { contentType, upsert: true })

    if (uploadError) {
      return res.status(500).json({ error: `Upload failed: ${uploadError.message}` })
    }

    // Step 5 — Get permanent URL and update member record
    const { data: urlData } = supabase.storage
      .from('profile-photos')
      .getPublicUrl(storagePath)

    const permanentUrl = urlData.publicUrl

    const { error: updateError } = await supabase
      .from('members')
      .update({ profile_photo: permanentUrl })
      .eq('email', email)

    if (updateError) {
      return res.status(500).json({ error: `Member update failed: ${updateError.message}` })
    }

    console.log(`[save-profile-photo] ✓ Complete for ${email}`)
    return res.status(200).json({ ok: true, email, profile_photo: permanentUrl })

  } catch (err) {
    console.error('[save-profile-photo] Unexpected error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
