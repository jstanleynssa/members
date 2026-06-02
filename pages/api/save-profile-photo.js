import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'

const TARGET_WIDTH  = 676
const TARGET_HEIGHT = 696
const TARGET_DPI    = 144

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

  const { email, photoUrl } = req.body
  if (!email || !photoUrl) {
    return res.status(400).json({ error: 'Missing email or photoUrl' })
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
    let imageUrl = photoUrl

    // ── Step 1: Transform with FLUX.1 Kontext [pro] via fal.ai ───────────────
    if (falKey) {
      try {
        console.log(`[photo] Submitting to FLUX.1 Kontext [pro] for ${email}...`)

        const falRes = await fetch('https://fal.run/fal-ai/flux-pro/kontext', {
          method: 'POST',
          headers: {
            'Authorization': `Key ${falKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            image_url: photoUrl,
            prompt: HEADSHOT_PROMPT,
            negative_prompt: HEADSHOT_NEGATIVE,
            aspect_ratio: '1:1',
            guidance_scale: 3.5,
            num_inference_steps: 28,
            output_format: 'jpeg'
          })
        })

        if (falRes.ok) {
          const falData = await falRes.json()
          const outputUrl = falData?.images?.[0]?.url
          if (outputUrl) {
            imageUrl = outputUrl
            console.log(`[photo] FLUX.1 Kontext complete ✓`)
          } else {
            console.warn(`[photo] Kontext returned no image URL — using original`)
          }
        } else {
          const errText = await falRes.text()
          console.warn(`[photo] Kontext failed (${falRes.status}): ${errText} — using original`)
        }
      } catch (e) {
        console.warn(`[photo] Kontext error: ${e.message} — using original`)
      }
    } else {
      console.warn('[photo] FAL_API_KEY not set — skipping AI transformation')
    }

    // ── Step 2: Download final image ──────────────────────────────────────────
    console.log(`[photo] Downloading processed image...`)
    const imgRes = await fetch(imageUrl)
    if (!imgRes.ok) return res.status(400).json({ error: `Image download failed: ${imgRes.status}` })
    let imgBuffer = Buffer.from(await imgRes.arrayBuffer())
    console.log(`[photo] Downloaded ✓`)

    // ── Step 3: Resize to 676×696 at 144ppi, face-top crop ───────────────────
    console.log(`[photo] Resizing to ${TARGET_WIDTH}×${TARGET_HEIGHT} at ${TARGET_DPI}ppi...`)
    imgBuffer = await sharp(imgBuffer)
      .resize(TARGET_WIDTH, TARGET_HEIGHT, {
        fit: 'cover',
        position: 'top'
      })
      .withMetadata({ density: TARGET_DPI })
      .jpeg({ quality: 92 })
      .toBuffer()
    console.log(`[photo] Resized ✓`)

    // ── Step 4: Upload to Supabase Storage ────────────────────────────────────
    console.log(`[photo] Uploading as ${filename}...`)
    const { error: uploadError } = await supabase.storage
      .from('profile-photos')
      .upload(filename, imgBuffer, { contentType: 'image/jpeg', upsert: true })

    if (uploadError) {
      return res.status(500).json({ error: `Upload failed: ${uploadError.message}` })
    }

    const { data: urlData } = supabase.storage
      .from('profile-photos')
      .getPublicUrl(filename)

    const permanentUrl = urlData.publicUrl

    // ── Step 5: Update member record ──────────────────────────────────────────
    const { error: updateError } = await supabase
      .from('members')
      .update({ profile_photo: permanentUrl })
      .eq('email', email)

    if (updateError) {
      return res.status(500).json({ error: `Member update failed: ${updateError.message}` })
    }

    console.log(`[photo] ✓ Complete for ${email} → ${permanentUrl}`)
    return res.status(200).json({
      ok: true,
      email,
      filename,
      profile_photo: permanentUrl,
      alt_text: altText
    })

  } catch (err) {
    console.error('[photo] Unexpected error:', err.message)
    return res.status(500).json({ error: err.message })
  }
}
