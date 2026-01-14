# TikTok Embed Validator

A WordPress plugin that validates TikTok videos **before** they are embedded in the Gutenberg editor, preventing broken embeds from being published.

## Problem

TikTok videos can become inaccessible (returning 403 Forbidden) even when the embed appears to work. This happens because:

- The video was removed or made private
- Geographic restrictions block the video
- TikTok's CDN blocks the video source file

Without validation, editors unknowingly publish posts with broken video embeds.

## Solution

This plugin **intercepts the embed process** and validates TikTok videos before allowing them to be embedded:

1. User pastes a TikTok URL and clicks "Embed"
2. Plugin validates the video server-side before embedding
3. If blocked (403), shows error and **prevents** the embed
4. User can "Re-check" or "Embed anyway" to override
5. If valid, allows the embed to proceed normally

## How It Works

### User Flow

```
┌────────────────────────────────────────────────────────────┐
│                     Embed Block                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │  [Enter URL to embed here...        ] [  Embed  ]    │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                            │
│  User pastes TikTok URL → Clicks "Embed"                  │
│                         ↓                                  │
│              ┌──────────────────┐                         │
│              │ Checking TikTok  │                         │
│              │     video...     │                         │
│              └──────────────────┘                         │
│                         ↓                                  │
│         ┌───────────────┴───────────────┐                 │
│         ↓                               ↓                 │
│    ✅ Valid                        ❌ Blocked             │
│    Embed proceeds                  Shows error below form │
│                                    [Re-check] [Embed anyway]│
└────────────────────────────────────────────────────────────┘
```

### Technical Flow

1. **Intercept**: Plugin wraps the embed block's `setAttributes` function
2. **Detect**: When URL is submitted, checks if it's a TikTok URL
3. **Validate**: For TikTok URLs, calls REST API before embedding
4. **Server-side check**:
   - Fetches `https://www.tiktok.com/embed/v2/{videoId}`
   - Extracts actual video CDN URL from the page
   - Performs HEAD request to check for 403
5. **Result**: Either allows embed or shows error with options

### Why Server-Side?

TikTok embeds load inside **cross-origin iframes**, making client-side detection impossible due to browser security policies. The plugin fetches TikTok's embed page server-side to bypass these restrictions.

### Validation Logic

| Video URL Response | Result | User Action |
|-------------------|--------|-------------|
| 200 OK | ✅ Embed proceeds | None needed |
| 403 Forbidden | ❌ Error shown | Re-check or Embed anyway |
| Timeout (504, etc.) | ✅ Embed proceeds | None (treated as OK*) |
| Can't extract URL | ❌ Error shown | Re-check or Embed anyway |

*Timeouts are treated as success because TikTok video URLs have IP-bound tokens. If the embed page loads, the video will work for visitors.

## Features

- **Pre-embed validation**: Catches issues before publishing
- **Non-blocking**: "Embed anyway" option for edge cases
- **Smart detection**: Only validates TikTok URLs, others embed normally
- **Works for new & existing blocks**: Validates when adding new embeds or editing existing ones
- **Caching**: Results cached to avoid repeated checks
- **User-friendly**: Clear error messages with actionable options

## Files

```
tiktok-embed-validator/
├── tiktok-embed-validator.php   # Main plugin file, REST API
├── assets/
│   ├── js/
│   │   └── editor.js            # Gutenberg embed interception
│   └── css/
│       └── editor.css           # Editor styles
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
  "message": "Video source is accessible.",
  "video_id": "1234567890",
  "video_url": "https://v16m.tiktokcdn.com/..."
}
```

### Response (Error - 403)

```json
{
  "success": false,
  "error": "video_403",
  "message": "The video file is blocked and will not play.",
  "video_id": "1234567890",
  "video_url": "https://v16m.tiktokcdn.com/..."
}
```

### Response (Error - Can't extract URL)

```json
{
  "success": false,
  "error": "video_url_not_found",
  "message": "Could not extract video URL. Unable to verify playback.",
  "video_id": "1234567890",
  "video_url": null
}
```

## Requirements

- WordPress 6.7+
- PHP 8.1+
- Editor access (validates only in Gutenberg editor)

## Installation

1. Copy the `tiktok-embed-validator` folder to `/wp-content/plugins/`
2. Activate the plugin in WordPress admin

Or for mu-plugin installation:
1. Copy to `/wp-content/mu-plugins/tiktok-embed-validator/`
2. Create loader at `/wp-content/mu-plugins/tiktok-embed-validator.php`:

```php
<?php
require_once __DIR__ . '/tiktok-embed-validator/tiktok-embed-validator.php';
```

## Limitations

- **Server-dependent**: Relies on parsing TikTok's embed page structure
- **May need updates**: If TikTok changes their embed implementation
- **Not 100% coverage**: Some edge cases may pass validation but still fail
- **Network-dependent**: Server must be able to reach TikTok's servers

## Troubleshooting

### "Could not extract video source URL"

The plugin couldn't find the video URL in TikTok's embed page. This may indicate the video is unavailable. You can still click "Embed anyway" to embed it.

### Slow validation

Server-side requests to TikTok may be slow depending on your hosting. Default timeout is 15-20 seconds.

### False negatives on staging

If your staging server has restricted network access, validation may fail for valid videos. The plugin treats timeouts as success to minimize false positives.

## License

GPL v2 or later
