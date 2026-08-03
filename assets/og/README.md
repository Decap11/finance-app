# Share-preview (Open Graph) artwork

`public/og-preview.jpg` is the image WhatsApp, Facebook, LinkedIn and X show when
someone pastes a link to the app. It is **generated**, not hand-edited — the
portrait promo slides live here as sources so the card can be rebuilt.

## Why it is generated

Chat clients render the big link card at roughly **1.91:1** (1200×630). The promo
slides are portrait (~1:3), so used directly they get centre-cropped to a thin
strip through the middle of the phone. `scripts/make-og-image.ps1` lifts the
device artwork out of a slide and re-typesets the headline beside it.

## Rebuilding

```powershell
pwsh -File scripts/make-og-image.ps1 `
     -Source assets/og/instant-loans.png `
     -Eyebrow "Instant Loans" `
     -Headline "Empower members to apply, manage, and track loans effortlessly"
```

Useful switches:

| Switch | Purpose |
| --- | --- |
| `-CropTop` / `-CropBottom` | Vertical slice of the source holding the device, as fractions of height. Slides with the headline on top need `-CropTop 0.26`; slides with the headline underneath need `-CropBottom 0.62`. |
| `-BackgroundColor` | Override the auto-sampled background, e.g. `"#141F8C"`. |
| `-Quality` | JPEG quality. Keep the output under ~300 KB; some clients skip large previews. |

## Constraints worth remembering

- Dimensions are declared in `src/utils/siteMetadata.ts`. If you change the
  canvas size, change them there too — crawlers lay the card out from the
  declared numbers, so a mismatch downgrades the preview.
- The image must be reachable **anonymously** over https. Vercel deployment
  protection or any auth wall in front of `/og-preview.jpg` means no preview.
- WhatsApp caches aggressively. After changing the art, test with a fresh query
  string (`?v=2`) or re-scrape via the Facebook Sharing Debugger.
