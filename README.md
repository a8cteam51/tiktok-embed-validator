# TikTok Embed Validator

A WordPress mu-plugin that validates TikTok video embeds in the Gutenberg editor, detecting when videos are blocked or unavailable before publishing.

## Problem

TikTok videos can become inaccessible (returning 403 Forbidden) even when the embed block appears to work. This happens because:

- The video was removed or made private
- Geographic restrictions block the video
- TikTok's CDN blocks the video source file

Without validation, editors unknowingly publish posts with broken video embeds.

## Solution

This plugin validates TikTok embeds **server-side** in the editor by:

1. Detecting TikTok embed blocks in the editor
2. Fetching TikTok's embed page (`/embed/v2/{videoId}`) from your server
3. Extracting the actual video CDN URL from the embed page
4. Checking if the video source returns 403 Forbidden
5. Displaying validation status directly in the editor

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Gutenberg Editor                         │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  TikTok Embed Block                                 │   │
│  │  ┌───────────────────────────────────────────────┐  │   │
│  │  │  ✅ Video is accessible                       │  │   │
│  │  │  or                                           │  │   │
│  │  │  ❌ Video blocked (403 Forbidden)             │  │   │
│  │  └───────────────────────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   REST API Endpoint                         │
│            /wp-json/tiktok-embed-validator/v1/check         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Server-Side Validation                    │
│  1. Extract video ID from TikTok URL                        │
│  2. Fetch https://www.tiktok.com/embed/v2/{videoId}         │
│  3. Parse HTML for video CDN URL                            │
│  4. HEAD request to video URL → check for 403               │
└─────────────────────────────────────────────────────────────┘
```

### Why Server-Side?

TikTok embeds load inside **cross-origin iframes**, making client-side detection impossible due to browser security policies. The plugin fetches TikTok's embed page server-side to bypass these restrictions.

### Validation Logic

| Scenario | Status | Meaning |
|----------|--------|---------|
| Video URL returns 200 | ✅ Success | Video is playable |
| Video URL returns 403 | ❌ Error | Video is **blocked** - won't play |
| Video URL times out (504, etc.) | ✅ Success | Server network issue, but video works for visitors |
| Embed page has error indicators | ❌ Error | Video unavailable on TikTok |
| Can't extract video URL | ⚠️ Warning | Unable to verify |

**Note:** Timeouts (504, 502, etc.) are treated as success because TikTok video URLs contain IP-bound or time-limited tokens. If the embed page loads successfully, the video will work for visitors whose browsers get fresh tokens.

## Files

```
tiktok-embed-validator/
├── tiktok-embed-validator.php   # Main plugin file, REST API
├── assets/
│   ├── js/
│   │   └── editor.js            # Gutenberg editor integration
│   └── css/
│       └── editor.css           # Editor notice styles
└── README.md                    # This file
```

## REST API

### Endpoint

```
POST /wp-json/tiktok-embed-validator/v1/check
```

### Request

```json
{
  "url": "https://www.tiktok.com/@username/video/1234567890"
}
```

### Response (Success)

```json
{
  "success": true,
  "message": "Video is accessible and should play correctly.",
  "video_url": "https://v16m.tiktokcdn.com/..."
}
```

### Response (Error)

```json
{
  "success": false,
  "error": "video_403",
  "message": "Video source returned 403 Forbidden. The video file is blocked and will not play."
}
```

## Requirements

- WordPress 5.0+
- PHP 7.4+
- Editor access (validates only in Gutenberg editor)

## Installation

1. Copy the `tiktok-embed-validator` folder to `/wp-content/mu-plugins/`
2. Create a loader file at `/wp-content/mu-plugins/tiktok-embed-validator.php`:

```php
<?php
require_once __DIR__ . '/tiktok-embed-validator/tiktok-embed-validator.php';
```

Or simply move the main plugin file directly to `/wp-content/mu-plugins/`.

## Hooks & Filters

### Filter: `tiktok_embed_validator_timeout`

Customize the HTTP request timeout (default: 15 seconds).

```php
add_filter( 'tiktok_embed_validator_timeout', function( $timeout ) {
    return 30; // 30 seconds
} );
```

## Troubleshooting

### "Could not extract video source URL"

The plugin couldn't find the video URL in TikTok's embed page. This may happen if:
- TikTok changed their embed page structure
- The video ID is invalid

### Slow validation

Server-side requests to TikTok may be slow depending on your hosting. The plugin uses a 15-second timeout by default.

### False positives on staging

If your staging server has restricted network access or IP blocks, the video check may fail even for valid videos. The plugin treats timeouts as success to minimize false positives.

## License

GPL v2 or later
