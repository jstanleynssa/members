import { createClient } from '@supabase/supabase-js'

// The image arrives as base64 in the JSON body. The client resizes before
// sending (long edge ≤1200px), so payloads are normally small — but raise the
// default 4MB API-route limit as a safety margin for edge cases.
export const config = {
  api: {
    bodyParser: { sizeLimit: '10mb' },
  },
}

// Base instruction — emphasizes a LIGHT touch on the face (keep the person
// looking like themselves; only ~5-8% retouching), while still producing a
// polished professional headshot with a generated background and attire.
const HEADSHOT_BASE = `Convert the uploaded photo into a professional executive headshot suitable for LinkedIn profiles, corporate websites, speaker biographies, advisor directories, and professional marketing materials.
CRITICAL — preserve the person's exact identity: keep their real facial features, face shape, age, ethnicity, hairstyle, skin tone, and natural expression. This must clearly look like the same person. Apply only very light, natural retouching to the FACE — roughly 5-8%: gently even skin tone and softly reduce temporary blemishes and harsh shadows, but KEEP natural skin texture, real wrinkles, pores, and character. Do NOT smooth the face into a plastic or airbrushed look, do not slim or reshape the face, do not change the eyes, nose, mouth, or apparent age.
Recompose the image into a square (1:1) format. Center the subject naturally with comfortable negative space around the head and shoulders — a professionally photographed corporate portrait, not a tightly cropped selfie. If the original is tightly cropped, intelligently and realistically extend the missing shoulders, clothing, and background with accurate proportions.
Create professional studio-quality lighting with natural skin tones, sharp focus on the eyes, realistic skin texture, and balanced contrast. Remove image noise, glare, and low-quality artifacts while keeping a natural, authentic appearance.
Frame subject from mid-chest to top of head, occupying approximately 60-70% of the image height, with 15-20% negative space above the head and balanced side margins.
Final result: a professionally commissioned corporate headshot captured by an experienced portrait photographer with a high-end camera — photorealistic, authentic, polished, trustworthy, approachable, and unmistakably the same person.`

// Rotating ATTIRE options — a different one is chosen per attempt so the three
// generations differ visibly. Still always professional business attire.
const ATTIRE_OPTIONS = [
  'Dress the subject in a tailored charcoal or navy business suit with a crisp dress shirt (no tie or a subtle tie), realistic and well-fitted.',
  'Dress the subject in a smart business-casual blazer over an open-collar dress shirt, polished and professional.',
  'Dress the subject in a classic dark suit jacket with a light dress shirt and a tasteful tie, executive style.',
  'Dress the subject in a modern slim-fit suit in a medium blue or gray tone with a clean dress shirt, contemporary professional look.',
]

// Rotating BACKGROUND options — a different one per attempt.
const BACKGROUND_OPTIONS = [
  'Place the subject against a softly blurred modern corporate office background.',
  'Place the subject against a softly blurred neutral gray-to-blue studio gradient backdrop.',
  'Place the subject against a softly blurred contemporary city skyline / upscale business district.',
  'Place the subject against a softly blurred bright professional workspace with warm natural light.',
]

// Build the full prompt for a given attempt (0-indexed). Rotating the attire
// and background by attempt guarantees visible variation between tries.
function buildPrompt(attempt = 0) {
  const attire = ATTIRE_OPTIONS[attempt % ATTIRE_OPTIONS.length]
  const background = BACKGROUND_OPTIONS[attempt % BACKGROUND_OPTIONS.length]
  return `${HEADSHOT_BASE}
${attire}
${background} Keep the background softly blurred so it never distracts from the subject.`
}

const HEADSHOT_NEGATIVE = `face swap, altered identity, different person, beauty filter, glamour photography, fashion model pose, cartoon, illustration, painting, anime, plastic skin, airbrushed skin, over-smoothed skin, excessive retouching, distorted facial features, asymmetrical eyes, exaggerated smile, slimmed face, reshaped face, changed age, extreme sharpening, low resolution, pixelation, artifacts, text, watermark, logo, cropped forehead, cropped chin, tight crop, selfie framing, dramatic cinematic lighting, fantasy background`

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

  // mode: 'preview' → generate AI image, store to temp, return URL (no DB write)
  //       'commit'  → save a chosen image as the permanent profile photo
  // Back-compat: if no mode is given, fall back to the old enhance/saveOriginal
  // behavior (generate-and-save) so any older caller still works.
  const {
    email, imageData, mimeType,
    mode, attempt = 0,
    previewUrl,            // commit: promote this temp AI image
    saveOriginal = false,  // commit: save the original (imageData) directly
    enhance = true,        // legacy fallback only
  } = req.body

  if (!email) return res.status(400).json({ error: 'Missing email' })

  const supabaseAdmin = supabase
  const falKey = process.env.FAL_API_KEY

  // ── Fetch member details for filename and alt text ────────────────────────
  const { data: member } = await supabaseAdmin
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
    member?.first_name, member?.last_name,
    member?.job_title ? `- ${member.job_title}` : null,
    member?.city ? `in ${member.city}` : null,
    '| Professional Headshot',
  ].filter(Boolean).join(' ')

  try {
    // ════════════════════════════════════════════════════════════════════════
    // PREVIEW MODE — generate an AI headshot and return it WITHOUT saving.
    // ════════════════════════════════════════════════════════════════════════
    if (mode === 'preview') {
      if (!imageData) return res.status(400).json({ error: 'Missing image data for preview' })
      if (!falKey) return res.status(500).json({ error: 'AI image service is not configured' })

      const srcBuffer = Buffer.from(imageData, 'base64')

      // Stage the source so fal can fetch it by URL.
      const srcPath = `temp/src-${slugify(email)}-${Date.now()}.jpg`
      await supabaseAdmin.storage.from('profile-photos')
        .upload(srcPath, srcBuffer, { contentType: mimeType || 'image/jpeg', upsert: true })
      const { data: srcUrlData } = supabaseAdmin.storage.from('profile-photos').getPublicUrl(srcPath)

      const seed = Math.floor(Math.random() * 1e9)
      const falRes = await fetch('https://fal.run/fal-ai/flux-pro/kontext', {
        method: 'POST',
        headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: srcUrlData.publicUrl,
          prompt: buildPrompt(attempt),
          negative_prompt: HEADSHOT_NEGATIVE,
          aspect_ratio: '1:1',
          image_size: { width: 676, height: 696 },
          guidance_scale: 3.5,
          num_inference_steps: 28,
          seed,
          output_format: 'jpeg',
        }),
      })
      if (!falRes.ok) {
        const errText = await falRes.text()
        console.warn(`[photo] Kontext failed (${falRes.status}): ${errText}`)
        return res.status(502).json({ error: 'AI generation failed — please try again.' })
      }
      const falData = await falRes.json()
      const outputUrl = falData?.images?.[0]?.url
      if (!outputUrl) return res.status(502).json({ error: 'AI generation returned no image.' })

      // Download the result and store it to a temp preview path we can later
      // promote if the user accepts it.
      const dlRes = await fetch(outputUrl)
      if (!dlRes.ok) return res.status(502).json({ error: 'Could not retrieve AI image.' })
      const aiBuffer = Buffer.from(await dlRes.arrayBuffer())
      const previewPath = `temp/preview-${slugify(email)}-${Date.now()}.jpg`
      await supabaseAdmin.storage.from('profile-photos')
        .upload(previewPath, aiBuffer, { contentType: 'image/jpeg', upsert: true })
      const { data: pvUrl } = supabaseAdmin.storage.from('profile-photos').getPublicUrl(previewPath)

      console.log(`[photo] Preview generated for ${email} (attempt ${attempt}) ✓`)
      return res.status(200).json({ ok: true, previewUrl: pvUrl.publicUrl })
    }

    // ════════════════════════════════════════════════════════════════════════
    // COMMIT MODE — save a chosen image as the permanent profile photo.
    //   • previewUrl present  → promote that AI preview image
    //   • imageData present   → save the user's original directly
    // ════════════════════════════════════════════════════════════════════════
    if (mode === 'commit' || (!mode && (saveOriginal || previewUrl))) {
      let imgBuffer = null
      if (previewUrl) {
        const dlRes = await fetch(previewUrl)
        if (!dlRes.ok) return res.status(400).json({ error: 'Could not fetch the selected image.' })
        imgBuffer = Buffer.from(await dlRes.arrayBuffer())
      } else if (imageData) {
        imgBuffer = Buffer.from(imageData, 'base64')
      }
      if (!imgBuffer) return res.status(400).json({ error: 'No image to save' })

      const { error: uploadError } = await supabaseAdmin.storage.from('profile-photos')
        .upload(filename, imgBuffer, { contentType: 'image/jpeg', upsert: true })
      if (uploadError) return res.status(500).json({ error: `Upload failed: ${uploadError.message}` })

      const { data: urlData } = supabaseAdmin.storage.from('profile-photos').getPublicUrl(filename)
      const permanentUrl = urlData.publicUrl

      const { error: updateError } = await supabaseAdmin
        .from('members').update({ profile_photo: permanentUrl }).eq('email', email)
      if (updateError) return res.status(500).json({ error: `Member update failed: ${updateError.message}` })

      console.log(`[photo] ✓ Committed for ${email} → ${permanentUrl}`)
      return res.status(200).json({ ok: true, email, filename, profile_photo: permanentUrl, alt_text: altText })
    }

    // ════════════════════════════════════════════════════════════════════════
    // LEGACY FALLBACK — old generate-and-save behavior (no mode given).
    // ════════════════════════════════════════════════════════════════════════
    {
      const doEnhance = enhance && !saveOriginal
      let imgBuffer = imageData ? Buffer.from(imageData, 'base64') : null
      let imageUrl = null

      if (imageData && doEnhance && falKey) {
        const tempPath = `temp/${slugify(email)}-${Date.now()}.jpg`
        await supabaseAdmin.storage.from('profile-photos')
          .upload(tempPath, imgBuffer, { contentType: mimeType || 'image/jpeg', upsert: true })
        const { data: t } = supabaseAdmin.storage.from('profile-photos').getPublicUrl(tempPath)
        imageUrl = t.publicUrl

        const falRes = await fetch('https://fal.run/fal-ai/flux-pro/kontext', {
          method: 'POST',
          headers: { 'Authorization': `Key ${falKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_url: imageUrl, prompt: buildPrompt(attempt), negative_prompt: HEADSHOT_NEGATIVE,
            aspect_ratio: '1:1', image_size: { width: 676, height: 696 },
            guidance_scale: 3.5, num_inference_steps: 28, seed: Math.floor(Math.random() * 1e9),
            output_format: 'jpeg',
          }),
        })
        if (falRes.ok) {
          const falData = await falRes.json()
          const outputUrl = falData?.images?.[0]?.url
          if (outputUrl) {
            const dl = await fetch(outputUrl)
            if (dl.ok) imgBuffer = Buffer.from(await dl.arrayBuffer())
          }
        }
      }
      if (!imgBuffer) return res.status(400).json({ error: 'No image data available' })

      const { error: uploadError } = await supabaseAdmin.storage.from('profile-photos')
        .upload(filename, imgBuffer, { contentType: 'image/jpeg', upsert: true })
      if (uploadError) return res.status(500).json({ error: `Upload failed: ${uploadError.message}` })

      const { data: urlData } = supabaseAdmin.storage.from('profile-photos').getPublicUrl(filename)
      const permanentUrl = urlData.publicUrl
      const { error: updateError } = await supabaseAdmin
        .from('members').update({ profile_photo: permanentUrl }).eq('email', email)
      if (updateError) return res.status(500).json({ error: `Member update failed: ${updateError.message}` })

      return res.status(200).json({ ok: true, email, filename, profile_photo: permanentUrl, alt_text: altText })
    }

  } catch (err) {
    console.error('[photo] Unexpected error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
