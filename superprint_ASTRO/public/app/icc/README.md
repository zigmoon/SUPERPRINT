# ICC Profiles for Super Print CMYK Export (PDF/X-3)

## Bundled profiles (since v062 / 2026-05-02)

The 3 most common professional ICC profiles are now **bundled directly** with Super Print, so PDF/X-3 compliant CMYK exports work out of the box without any setup.

| File | Region | Use case | Size |
|---|---|---|---|
| `CoatedFOGRA39.icc` | Europe | ISO Coated v2 / Fogra39L (offset, coated paper) | ~640 KB |
| `USWebCoatedSWOP.icc` | USA | SWOP web offset, coated #5 paper | ~545 KB |
| `JapanColor2001Coated.icc` | Japan | Japan Color 2001 coated | ~545 KB |

**Source:** [Adobe ICC Profiles end-user bundle](https://www.adobe.com/support/downloads/iccprofiles/iccprofiles_win.html) — redistributed under the **Adobe ICC Profiles End-User License Agreement** which permits free use and redistribution as part of software (including offline / PWA contexts).

The service worker pre-caches them on first load (see `service-worker.js` `ASSETS` array) so they remain available offline.

## Adding your own custom profile

The export modal also includes a **file upload field** (Bug 16, v059) that lets you drop any `.icc` / `.icm` file at runtime. The uploaded profile is embedded into the exported PDF as `/ICCBased` and referenced from a PDF/X-3 `OutputIntent`.

Useful when:
- Your printer requires a specific paper / ink profile not bundled here (e.g. PSO Uncoated v3, GRACoL 2013, Fogra51, Fogra52)
- You have a custom proofing condition

## Adding more bundled profiles (developer only)

To bundle additional redistributable profiles:

1. Drop the `.icc` file in this folder. Name it exactly like the dropdown option in the export modal expects (case-sensitive on Linux servers).
2. Add the path in `service-worker.js` `ASSETS` array so it gets pre-cached.
3. Bump the cache version (`CACHE_NAME`) and the `index.html` version badges so users get the new files on next reload.
4. Verify the file is a real ICC profile: bytes 36..39 must spell `acsp` (ASCII).

## Verifying a file is a real ICC profile

A valid ICC profile starts with a 4-byte big-endian size, then the magic word `acsp` at offset 36. Super Print validates this on load — invalid files are silently rejected and a warning is logged in the console.

## Behavior when an ICC profile is missing

- Image and content stream colors are still converted to CMYK (naive RGB→CMYK), and the PDF declares `/DeviceCMYK` directly (no ICC wrapper).
- The PDF is **NOT PDF/X-3 compliant** in that case — print shops may reject it.
- A status message appears in the export modal so the user is aware.

## File size considerations

- Fogra39 ≈ 600 KB (raw); compressed in the PDF it becomes ~150 KB.
- The profile is embedded **once per exported PDF** (not per image), so the overhead is constant.

## Service worker caching

If the service worker is active, run `Ctrl+Shift+R` once after dropping new ICC files so the cache picks them up.
