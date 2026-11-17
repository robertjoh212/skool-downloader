# MrMime archive fixes

This branch extends balmasi/skool-downloader. Upstream license and attribution remain in LICENSE and README.md.

## Changes
- Adds resumable local GPU transcription, offline keyword/phrase search, and timestamp jumps.
- Numbers lessons in a single-column course menu, with a Start course button and Previous/Next navigation.
- Reports lessons with video, image, attachment or linked-resource errors as incomplete, and displays a warning on the saved lesson page.
- Returns a failing CLI exit status for incomplete courses.
- Decodes videos with FFmpeg before accepting them. Stores a SHA-256 verification receipt; later runs check the hash and repeat decoding if it changes. Damaged files are preserved with an .invalid timestamp suffix before downloading again.
- Stops if streaming fragments are unavailable, instead of silently skipping them.
- Keeps TLS certificate verification enabled.
- Sanitizes lesson HTML and generated documents; adds a restrictive Content Security Policy.
- Uses hashed image filenames and rewrites image references only after successful downloads.
- Finds document URLs pasted as plain text as well as clickable links.
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
Ten automated tests cover HTML filtering, corrupt video detection, image-download failures, local link rewriting, actual yt-dlp downloads from a local fixture server, failure/retry through the course pipeline, safe search output, timestamp links, and linked-video player generation. The course structure is synthetic; these tests do not establish compatibility with any particular live Skool classroom. A one-second generated test video is used; no course content or credentials are committed.

## Limits
A decoded video is not proof that the publisher's original video was complete; an already-valid shortened source cannot be detected without authoritative source metadata. Video recognition still depends on the upstream scraper. Cross-course links and external services may require internet access. Watch-progress tracking is not included. Automatic transcripts can mishear names and jargon; search matches words and phrases, not semantic meaning.

The .auth directory contains reusable login sessions in plaintext and must never be shared or committed. Downloaded course material remains local. This public source repository must contain code and synthetic tests only.

## GPU transcripts and offline search

Create a Python 3.12 virtual environment, activate it, then run `python -m pip install -r requirements-transcription.txt`. Set `SKOOL_PYTHON` to that environment's Python executable when running from another shell. On Windows, the transcriber locates the NVIDIA wheel DLL folders automatically. A compatible NVIDIA driver is required.

```sh
# Download and transcribe in one command
npm run skool -- "YOUR_COURSE_URL" --course --output "COURSE_FOLDER" --transcribe
# Add transcripts to an existing archive, or resume
npm run skool -- transcribe "COURSE_FOLDER"
# Rebuild offline search without running the model
npm run skool -- search-index "COURSE_FOLDER"
# Serve the archive on this computer only
npm run preview -- "COURSE_FOLDER" 8766
```

Open http://127.0.0.1:8766/search.html. Search by keyword, multiple words, or a phrase in quotation marks. Results link to the matching video timestamp. Full readable transcripts and TXT/SRT/VTT files remain beside each lesson; linked resource videos receive their own transcript/player folder. The course includes a combined `all-transcripts.md`.

Defaults: faster-whisper large-v3-turbo, CUDA with int8_float16, English. Override `SKOOL_WHISPER_MODEL`, `SKOOL_WHISPER_DEVICE` (cuda or cpu), and `SKOOL_TRANSCRIPTION_CACHE` as needed. The first run downloads model weights; transcription then runs locally, with no media sent to a transcription API. Re-running skips transcripts only when the video SHA-256, model and language match and all output files exist. A failed run exits nonzero and still indexes completed transcripts. Keep the entire archive together.
