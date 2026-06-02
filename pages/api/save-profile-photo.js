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

  try {
    // Download image from signed S3 URL
    const imageResponse = await fetch(photoUrl)
    if (!imageResponse.ok) {
      return res.status(400).json({ error: `Failed to fetch image: ${imageResponse.status}` })
    }

    // Determine file type
    const contentType = imageResponse.headers.get('content-type') || 'image/jpeg'
    const ext = contentType.includes('png') ? 'png'
      : contentType.includes('gif') ? 'gif'
      : contentType.includes('webp') ? 'webp'
      : 'jpg'

    // Convert to buffer
    const arrayBuffer = await imageResponse.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // Build clean filename
    const safeEmail = email.toLowerCase().replace(/[^a-z0-9]/g, '-')
    const filename = `${safeEmail}-${Date.now()}.${ext}`
    const storagePath = `profile-photos/${filename}`

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('profile-photos')
      .upload(storagePath, buffer, { contentType, upsert: true })

    if (uploadError) {
      return res.status(500).json({ error: `Upload failed: ${uploadError.message}` })
    }

    // Get permanent public URL
    const { data: urlData } = supabase.storage
      .from('profile-photos')
      .getPublicUrl(storagePath)

    const permanentUrl = urlData.publicUrl

    // Update member record
    const { error: updateError } = await supabase
      .from('members')
      .update({ profile_photo: permanentUrl })
      .eq('email', email)

    if (updateError) {
      return res.status(500).json({ error: `Member update failed: ${updateError.message}` })
    }

    return res.status(200).json({ ok: true, email, profile_photo: permanentUrl })

  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
