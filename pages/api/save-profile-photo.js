import { createClient } from '@supabase/supabase-js'
import { slugForMember, revalidateDirectorySlugs } from '../../lib/revalidateDirectory'

const HEADSHOT_PROMPT = `Convert the uploaded photo into a professional executive headshot suitable for LinkedIn profiles, corporate websites, speaker biographies, advisor directories, and professional marketing materials.
Preserve the person's exact identity, facial features, age, ethnicity, hairstyle, expression, and distinguishing characteristics. Do not materially alter the person's appearance or create a different face.
Recompose the image into a square (1:1) format. Center the subject naturally within the frame and ensure there is comfortable negative space around the head and shoulders. The composition should resemble a professionally photographed corporate portrait rather than a tightly cropped selfie.
If the original image is tightly cropped, intelligently zoom out and realistically generate the missing areas of the image, including shoulders, clothing, background, and surrounding space. Maintain accurate proportions and a natural appearance.
Replace casual clothing with polished professional business attire appropriate for an executive, financial advisor, attorney, consultant, or business professional. Clothing should appear realistic, tailored, and professional.
Create professional studio-quality lighting with natural skin tones, sharp focus on the eyes, realistic skin texture, balanced contrast, and subtle retouching. Remove distractions, harsh shadows, glare, image noise, and low-quality artifacts while maintaining a natural, authentic appearance.
Randomly select and generate one professional background style that complements the subject: modern corporate office, executive office environment, soft professional studio backdrop, neutral gray or blue gradient background, premium bokeh background, contemporary city skyline, upscale business district, or bright professional workspace. Ensure the background remains softly blurred and does not distract from the subject.
Final result should appear as a professionally commissioned corporate headshot captured by an experienced portrait photographer using a high-end camera and professional lighting. High resolution, photorealistic, authentic, polished, trustworthy, and approachable.
Frame subject from mid-chest to top of head, occupying approximately 60-70% of the image height. Maintain 15-20% negative space above the head and balanced side margins.`

const HEADSHOT_NEGATIVE = `face swap, altered identity, different person, beauty filter, glamour photography, fashion model pose, cartoon, illustration, painting, anime, unrealistic skin, plastic skin, excessive retouching, distorted facial features, asymmetrical eyes, exaggerated smile, extreme sharpening, low resolution, pixelation, artifacts, text, watermark, logo, cropped forehead, cropped chin, tight crop, selfie framing, dramatic cinematic lighting, fantasy background`

function slugify(str) {
  return (str || '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // mode: 'preview'  → run AI, save to temp path, return previewUrl (no member update)
  // mode: 'commit'   → either copy preview to permanent path, or save original as-is
  // (legacy: no mode field → treat as direct commit, old behavior preserved)
  const { email, photoUrl, imageData, mimeType, enhance = true, mode, previewUrl, attempt = 0 } = req.body

  if (!email || (!photoUrl && !imageData && !previewUrl)) {
    return res.status(400).json({ error: 'Missing email and photo source' })
  }

  // ── Fetch member details for filename and alt text ────────────────────────
  const { data: member } = await supabase
    .from('members')
    .select('first_name, last_name, job_title, city')
    .eq('email', email)
    .single()

  const firstName = slugify(member?.first_name)
  const lastName  = slugify(member?.last_name)
  const jobTitle  = slugify(member?.job_title)
  const city      = slugify(member?.city)
  const baseName  = [firstName, lastName, jobTitle, city].filter(Boolean).join('-')
  const filename  = `${baseName || slugify(email)}.jpg`

  const altText = [
    member?.first_name,
    member?.last_name,
    member?.job_title ? `- ${member.job_title}` : null,
    member?.city ? `in ${member.city}` : null,
    '| Professional Headshot'
  ].filter(Boolean).join(' ')

  const falKey = process.env.FAL_API_KEY

  try {
    // ════════════════════════════════════════════════════════════════════════
    // PREVIEW MODE — run AI, save to a temp preview path, return the URL.
    // Nothing is written to the member record; the advisor picks one after.
    // ════════════════════════════════════════════════════════════════════════
    if (mode === 'preview') {
      let imgBuffer = imageData ? Buffer.from(imageData, 'base64') : null
      let finalMime = mimeType || 'image/jpeg'
      let imageUrlForFal = photoUrl || null

      // Step 1: Upload the raw image to a temp path so fal.ai has a URL to read
      if (imageData && falKey) {
        const tempPath = `temp/${slugify(email)}-${Date.now()}.jpg`
        await supabase.storage
          .from('profile-photos')
          .upload(tempPath, imgBuffer, { contentType: finalMime, upsert: true })
        const { data: tempUrlData } = supabase.storage
          .from('profile-photos')
          .getPublicUrl(tempPath)
        imageUrlForFal = tempUrlData.publicUrl
        console.log(`[photo/preview] Temp upload for fal.ai ✓`)
      }

      // Step 2: AI enhancement via FLUX.1 Kontext [pro]
      if (falKey && imageUrlForFal) {
        try {
          console.log(`[photo/preview] Submitting to FLUX.1 Kontext [pro] for ${email} (attempt ${attempt})...`)
          const falRes = await fetch('https://fal.run/fal-ai/flux-pro/kontext', {
            method: 'POST',
            headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image_url: imageUrlForFal,
              prompt: HEADSHOT_PROMPT,
              negative_prompt: HEADSHOT_NEGATIVE,
              aspect_ratio: '1:1',
              image_size: { width: 676, height: 696 },
              guidance_scale: 3.5,
              num_inference_steps: 28,
              output_format: 'jpeg'
            })
          })

          if (falRes.ok) {
            const falData = await falRes.json()
            const outputUrl = falData?.images?.[0]?.url
            if (outputUrl) {
              const dlRes = await fetch(outputUrl)
              if (dlRes.ok) {
                imgBuffer = Buffer.from(await dlRes.arrayBuffer())
                finalMime = 'image/jpeg'
                console.log(`[photo/preview] FLUX.1 Kontext complete ✓`)
              }
            }
          } else {
            const errText = await falRes.text()
            console.warn(`[photo/preview] Kontext failed (${falRes.status}): ${errText} — using original`)
          }
        } catch (e) {
          console.warn(`[photo/preview] Kontext error: ${e.message} — using original`)
        }
      }

      if (!imgBuffer) return res.status(400).json({ error: 'No image data available for preview' })

      // Step 3: Save to a unique preview path (not the permanent member path)
      const previewPath = `previews/${slugify(email)}-preview-${attempt}-${Date.now()}.jpg`
      const { error: previewUploadError } = await supabase.storage
        .from('profile-photos')
        .upload(previewPath, imgBuffer, { contentType: 'image/jpeg', upsert: true })

      if (previewUploadError) {
        return res.status(500).json({ error: `Preview upload failed: ${previewUploadError.message}` })
      }

      const { data: previewUrlData } = supabase.storage
        .from('profile-photos')
        .getPublicUrl(previewPath)

      console.log(`[photo/preview] ✓ Preview ready for ${email} → ${previewUrlData.publicUrl}`)
      return res.status(200).json({ ok: true, previewUrl: previewUrlData.publicUrl })
    }

    // ════════════════════════════════════════════════════════════════════════
    // COMMIT MODE — write the final photo to the permanent path and update
    // the member record. Two sub-cases:
    //   (a) AI commit: previewUrl already has the enhanced image in storage;
    //       just copy/re-upload those bytes to the permanent path.
    //   (b) Original commit: imageData is the raw upload; enhance=false means
    //       skip AI and save as-is.
    // ════════════════════════════════════════════════════════════════════════

    let imgBuffer = null
    let finalMime = 'image/jpeg'

    if (mode === 'commit' && previewUrl) {
      // (a) AI commit — download the already-generated preview from storage
      console.log(`[photo/commit] Fetching AI preview for permanent save...`)
      const dlRes = await fetch(previewUrl.split('?')[0]) // strip any cache-bust param
      if (!dlRes.ok) return res.status(400).json({ error: `Preview fetch failed: ${dlRes.status}` })
      imgBuffer = Buffer.from(await dlRes.arrayBuffer())
      finalMime = 'image/jpeg'
      console.log(`[photo/commit] AI preview fetched ✓`)
    } else {
      // (b) Original or legacy commit — use the uploaded image bytes directly
      let imageUrlForDownload = photoUrl || null

      if (imageData) {
        imgBuffer = Buffer.from(imageData, 'base64')
        finalMime = mimeType || 'image/jpeg'
      }

      // Legacy path: enhance=true with no mode field (old direct-save behavior).
      // Also handles the edge case where photoUrl is provided instead of imageData.
      if (enhance && falKey && (imageUrlForDownload || imageData)) {
        if (imageData && !imageUrlForDownload) {
          // Need a public URL for fal.ai — temp upload first
          const tempPath = `temp/${slugify(email)}-${Date.now()}.jpg`
          await supabase.storage
            .from('profile-photos')
            .upload(tempPath, imgBuffer, { contentType: finalMime, upsert: true })
          const { data: tempUrlData } = supabase.storage
            .from('profile-photos')
            .getPublicUrl(tempPath)
          imageUrlForDownload = tempUrlData.publicUrl
          console.log(`[photo/commit] Temp upload for fal.ai ✓`)
        }

        try {
          console.log(`[photo/commit] Submitting to FLUX.1 Kontext [pro] for ${email}...`)
          const falRes = await fetch('https://fal.run/fal-ai/flux-pro/kontext', {
            method: 'POST',
            headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image_url: imageUrlForDownload,
              prompt: HEADSHOT_PROMPT,
              negative_prompt: HEADSHOT_NEGATIVE,
              aspect_ratio: '1:1',
              image_size: { width: 676, height: 696 },
              guidance_scale: 3.5,
              num_inference_steps: 28,
              output_format: 'jpeg'
            })
          })

          if (falRes.ok) {
            const falData = await falRes.json()
            const outputUrl = falData?.images?.[0]?.url
            if (outputUrl) {
              const dlRes = await fetch(outputUrl)
              if (dlRes.ok) {
                imgBuffer = Buffer.from(await dlRes.arrayBuffer())
                finalMime = 'image/jpeg'
                console.log(`[photo/commit] FLUX.1 Kontext complete ✓`)
              }
            }
          } else {
            const errText = await falRes.text()
            console.warn(`[photo/commit] Kontext failed (${falRes.status}): ${errText} — using original`)
          }
        } catch (e) {
          console.warn(`[photo/commit] Kontext error: ${e.message} — using original`)
        }
      }

      // If still no buffer (photoUrl-only path), download it now
      if (!imgBuffer && imageUrlForDownload) {
        console.log(`[photo/commit] Downloading image...`)
        const dlRes = await fetch(imageUrlForDownload)
        if (!dlRes.ok) return res.status(400).json({ error: `Image download failed: ${dlRes.status}` })
        imgBuffer = Buffer.from(await dlRes.arrayBuffer())
        finalMime = dlRes.headers.get('content-type') || 'image/jpeg'
      }
    }

    if (!imgBuffer) return res.status(400).json({ error: 'No image data available' })

    // ── Upload to permanent Supabase Storage path ─────────────────────────
    console.log(`[photo/commit] Uploading as ${filename}...`)
    const { error: uploadError } = await supabase.storage
      .from('profile-photos')
      .upload(filename, imgBuffer, { contentType: 'image/jpeg', upsert: true })

    if (uploadError) return res.status(500).json({ error: `Upload failed: ${uploadError.message}` })

    const { data: urlData } = supabase.storage.from('profile-photos').getPublicUrl(filename)
    // Append version param so each save yields a distinct URL — prevents browsers
    // and the CDN from serving a stale cached photo after replacement.
    const permanentUrl = `${urlData.publicUrl}?v=${Date.now()}`

    // ── Update member record ───────────────────────────────────────────────
    const { error: updateError } = await supabase
      .from('members')
      .update({ profile_photo: permanentUrl })
      .eq('email', email)

    if (updateError) return res.status(500).json({ error: `Member update failed: ${updateError.message}` })

    // On-demand revalidate the public directory page so the new photo shows
    // within seconds. Best-effort — never fails the save.
    try {
      const { data: m } = await supabase
        .from('members')
        .select('first_name, last_name, city, state')
        .eq('email', email)
        .single()
      if (m) await revalidateDirectorySlugs([slugForMember(m)])
    } catch { /* non-fatal */ }

    console.log(`[photo/commit] ✓ Complete for ${email} → ${permanentUrl}`)
    return res.status(200).json({ ok: true, email, filename, profile_photo: permanentUrl, alt_text: altText })

  } catch (err) {
    console.error('[photo] Unexpected error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
