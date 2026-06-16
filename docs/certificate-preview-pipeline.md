# Certificate Preview Pipeline (NSSA & IRMAACP)

How the "framed certificate preview" in the certification emails is built.

> **Important:** None of this logic lives in this repository (or any of the
> `jstanleynssa` repos). The compositing is done entirely in **Zapier +
> Cloudinary**, and the rendered image is served from **Supabase Storage**.
> This file is a written record of that pipeline so it doesn't have to be
> reverse‑engineered each time. Update it whenever the zaps change.

## Accounts / assets involved

| Thing                | Value                                                                 |
| -------------------- | --------------------------------------------------------------------- |
| Cloudinary cloud     | `dw7xoj2bl`                                                           |
| Cloudinary folder    | `NSSA Certificates` (holds the per‑contact cert PNGs)                  |
| NSSA frame asset     | `NSSA_CERT_FRAME.png` (transparent‑window frame, Cloudinary root)     |
| IRMAA frame asset    | `IRMAACP-cert-example_zsgnhx.png` — **CONFIRM** this is the real reusable frame, not a one‑off example |
| Supabase storage     | `https://eqipvrcmugnvkextqmym.supabase.co/storage/v1/object/public/email-assets/` |

## How Cloudinary composites the certificate onto the frame

A single Cloudinary delivery URL overlays the per‑contact certificate onto the
transparent frame and flattens it:

```
https://res.cloudinary.com/dw7xoj2bl/image/upload/
  l_<CERT_PUBLIC_ID>          # overlay: the uploaded certificate
  ,c_fit,w_1200,g_center      # size the cert to fit, centered in the frame window
  /fl_layer_apply             # flatten the overlay onto the base
  /<FRAME_PUBLIC_ID>.png      # base: the transparent frame
```

- The overlay **must** carry the `l_` prefix. Without it Cloudinary treats the
  id as a (invalid) transformation, ignores it, and returns just the empty
  frame.
- The overlay id must **exactly** match the public_id assigned at upload time.
  This account uses Cloudinary **dynamic folders**, so the folder is display
  metadata and the public_id is independent (e.g. `cert-<ContactId>`, not
  `NSSA Certificates/cert-<ContactId>`).

## NSSA pipeline (current, working)

1. **Trigger** — contact earns NSSA certification.
2. **Build certificate** — Google Slides template with merge fields (name, date,
   certificate number).
3. **PDF → PNG** — CloudConvert.
4. **Upload to Cloudinary** — step *"Build Certificate Preview"*:
   - Public ID: `cert-{ContactId}`
   - Folder: `NSSA Certificates`
5. **Generate composite** — request the Cloudinary overlay URL (frame +
   `l_cert-{ContactId}`). This produces the flattened framed PNG.
6. **Save composite to Supabase** — store the flattened PNG at a stable path in
   the `email-assets` bucket. **CONFIRM exact path/filename** (e.g.
   `nssa-cert-{ContactId}.png`).
7. **Send email** — the `<img src>` points at the **Supabase** file (stable,
   always exists by the time the email is opened — this is why NSSA never shows
   a broken image).

## IRMAACP pipeline (to build — mirror of NSSA)

Same shape as NSSA. The differences are called out in **bold**.

1. **Trigger** — contact earns **IRMAACP** certification.
2. **Build certificate** — **IRMAACP** Google Slides template.
3. **PDF → PNG** — CloudConvert.
4. **Upload to Cloudinary** — public ID **`irmaacp-cert-{ContactId}`**.
   - ⚠️ **Do not reuse `cert-{ContactId}`.** A contact can hold *both* NSSA and
     IRMAACP. If both zaps upload to `cert-{ContactId}` the second overwrites
     the first and both emails show whichever cert uploaded last. A distinct
     prefix keeps them separate.
5. **Generate composite** — Cloudinary URL using the IRMAA frame and the IRMAA
   overlay id:
   ```
   https://res.cloudinary.com/dw7xoj2bl/image/upload/l_irmaacp-cert-{ContactId},c_fit,w_1200,g_center/fl_layer_apply/IRMAACP-cert-example_zsgnhx.png
   ```
   - The IRMAA frame's transparent window may differ in aspect ratio from the
     NSSA frame; if the cert doesn't sit cleanly inside the mat, tune
     `c_fit,w_1200` (and add `g_center`/offsets) on one test render.
6. **Save composite to Supabase** — store at a **distinct** path, e.g.
   `email-assets/irmaacp-cert-{ContactId}.png`.
7. **Send email** — point `<img src>` at the **Supabase** file (see snippet
   below), not the live Cloudinary URL.

### Email image markup (IRMAACP)

```html
<!-- Framed certificate preview -->
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;">
  <tr>
    <td align="center">
      <a href="https://res.cloudinary.com/dw7xoj2bl/image/upload/l_irmaacp-cert-{{=gives['368696191']["contact"]["id"]}},c_fit,w_1200,g_center/fl_layer_apply/IRMAACP-cert-example_zsgnhx.png" style="text-decoration:none;">
        <img src="https://eqipvrcmugnvkextqmym.supabase.co/storage/v1/object/public/email-assets/irmaacp-cert-{{=gives['368696191']["contact"]["id"]}}.png"
             alt="Your framed IRMAACP® certificate" width="420"
             style="width:100%; max-width:420px; height:auto; display:block; border-radius:6px; border:1px solid #e5e7eb;">
      </a>
      <p style="margin:8px 0 0; font-size:12px; color:#6b7280; font-style:italic;">A preview of your certificate, printed and framed</p>
    </td>
  </tr>
</table>
```

- `<img src>` → **Supabase** composite (stable, always renders).
- `<a href>` → **live Cloudinary** composite is fine here (a click happens later;
  the asset exists by then). Keeping it live avoids a second Supabase fetch.
- Don't forget the body copy: NSSA® → IRMAACP™.

## Open items to confirm (only you can, in Zapier/Cloudinary)

1. **Step 6 mechanism for NSSA** — exactly how the Cloudinary composite is saved
   to Supabase (which Zapier action, which bucket/path/filename). The IRMAA zap
   must mirror it with an IRMAA‑specific path.
2. **IRMAA frame asset** — is `IRMAACP-cert-example_zsgnhx.png` the real reusable
   transparent frame, or just the example mockup? If it's only an example,
   upload a clean IRMAA frame and use its public_id.
3. **Cert overlay public_id** — confirm the working NSSA overlay reference, then
   apply the same scheme (with the `irmaacp-` prefix) to IRMAA.
