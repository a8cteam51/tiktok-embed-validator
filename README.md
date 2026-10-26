# TikTok Embed Validator

A WordPress plugin that validates TikTok videos **before** they are embedded in the Gutenberg editor, preventing broken embeds from being published.

## Problem

TikTok videos can become inaccessible (returning 403 Forbidden) even when the embed appears to work. This happens because:

- The video was removed or made private
- Geographic restrictions block the video
- TikTok's CDN blocks the video source file

Without validation, editors unknowingly publish posts with broken video embeds.

## Solution

This plugin validates TikTok videos and shows warnings in the editor:

1. User pastes a TikTok URL and clicks "Embed"
2. Plugin validates the video server-side (non-blocking)
3. If blocked (403), shows error notice above the embed
4. User can click "Re-check" to verify again
5. Existing embeds are validated on page load

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
│              │ Checking TikTok  │  (non-blocking)         │
│              │     video...     │                         │
│              └──────────────────┘                         │
│                         ↓                                  │
│         ┌───────────────┴───────────────┐                 │
│         ↓                               ↓                 │
│    ✅ Valid                        ❌ Blocked             │
│    No notice shown                 Error notice shown     │
│                                    above embed [Re-check] │
│                                                            │
│    (Embed proceeds in both cases)                         │
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

Two cases are not checked at all, and show no notice:

- **Photo posts** (`tiktok.com/@user/photo/<id>`) have no video file to check.
- **TikTok rate-limiting or failing the check** (HTTP 429 or 5xx from the embed page) says nothing about the video. The result is not cached, so the next check asks TikTok again. Results cached as errors by 1.0.0 for these codes are dropped and checked again.

## Features

- **Pre-embed validation**: Catches issues before publishing
- **Non-blocking**: Errors are shown but don't prevent embedding
- **Smart detection**: Only validates TikTok URLs, others embed normally
- **Works for new & existing blocks**: Validates when adding new embeds or editing existing ones
- **Server-side caching**: Results cached in WordPress transients (24 hours for success/403, 1 hour for temporary errors)
- **Staggered validation**: Page load validates embeds in batches of 20 to prevent server overload
- **User-friendly**: Clear error messages with Re-check option

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
  "url": "https://www.tiktok.com/@username/video/1234567890",
  "skip_cache": false
}
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| url | string | required | TikTok video URL |
| skip_cache | boolean | false | Bypass server cache for fresh check |

### Response (Success)

```json
{
  "success": true,
  "message": "Video source is accessible.",
  "video_id": "1234567890",
  "video_url": "https://v16m.tiktokcdn.com/...",
  "cached": true
}
```

The `cached` field indicates if the result was served from the server-side transient cache.

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

## Limitations

- **Server-dependent**: Relies on parsing TikTok's embed page structure
- **May need updates**: If TikTok changes their embed implementation
- **Not 100% coverage**: Some edge cases may pass validation but still fail
- **Network-dependent**: Server must be able to reach TikTok's servers
- **Rate limits**: TikTok rate-limits its `/embed/v2/` page per IP. While it does, videos are not checked, so a blocked or deleted video can pass without a notice

## Troubleshooting

### "Could not extract video source URL"

The plugin couldn't find the video URL in TikTok's embed page. This may indicate the video is unavailable. The embed still works - an error notice is shown for awareness.

### Slow validation

Server-side requests to TikTok may be slow depending on your hosting. Default timeout is 15-20 seconds. Results are cached for 24 hours to avoid repeated slow requests.

### Many embeds on one page

The plugin processes page-load validations in batches of 20 with 500ms delays between batches to prevent server overload. Combined with server-side caching, subsequent page loads are instant.

### Clearing cached results

Click the "Re-check" button on any error notice to force a fresh validation, bypassing both client and server caches.

## License

GPL v2 or later
