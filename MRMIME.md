# MrMime archive fixes

This branch extends balmasi/skool-downloader. Upstream license and attribution remain in LICENSE and README.md.

## Changes
- Reports lessons with video, image, attachment or linked-resource errors as incomplete, and displays a warning on the saved lesson page.
- Returns a failing CLI exit status for incomplete courses.
- Decodes videos with FFmpeg before accepting them. Stores a SHA-256 verification receipt; later runs check the hash and repeat decoding if it changes. Damaged files are preserved with an .invalid timestamp suffix before downloading again.
- Stops if streaming fragments are unavailable, instead of silently skipping them.
- Keeps TLS certificate verification enabled.
- Sanitizes lesson HTML and generated documents; adds a restrictive Content Security Policy.
- Uses hashed image filenames and rewrites image references only after successful downloads.
- Rewrites links to saved lessons within the same course; other web links are marked "online."
- Restricts session-file permissions on platforms supporting POSIX modes. Windows uses the user's existing directory ACLs.

## Install and run
Use a supported Node.js release (Node 24 was used for testing).
```sh
npm ci
npm run typecheck
npm test
npm run login
npm run skool -- "YOUR_SINGLE_LESSON_URL" --concurrency 1
```
Log in yourself in the browser opened by the application. Start with one lesson before downloading a full course. Preserve the whole output folder to keep relative links working. Open the community index.html in a browser.

## Verification
Six automated tests cover HTML filtering, corrupt video detection, image-download failures, local link rewriting, actual yt-dlp downloads from a local fixture server, and failure/retry through the course pipeline. The course structure is synthetic; these tests do not establish compatibility with any particular live Skool classroom. A one-second generated test video is used; no course content or credentials are committed.

## Limits
A decoded video is not proof that the publisher's original video was complete; an already-valid shortened source cannot be detected without authoritative source metadata. Video recognition still depends on the upstream scraper. Cross-course links and external services may require internet access. Transcripts, search and watch-progress tracking are not added by this patch.

The .auth directory contains reusable login sessions in plaintext and must never be shared or committed. Downloaded course material remains local. This public source repository must contain code and synthetic tests only.
