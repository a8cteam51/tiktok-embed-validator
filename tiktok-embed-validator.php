<?php
/**
 * Plugin Name: TikTok Embed Validator
 * Description: Validates TikTok embed blocks in the editor and shows errors if the video source is inaccessible (403).
 * Version: 1.0.1
 * Author: WordPress Special Projects
 * Author URI: https://wpspecialprojects.wordpress.com
 * License: GPLv2 or later
 * Requires at least: 6.7
 * Tested up to: 6.7
 * Requires PHP: 8.1
 * Text Domain: tiktok-embed-validator
 */

defined( 'ABSPATH' ) || exit;

/**
 * Main class for TikTok Embed Validator.
 */
class TikTok_Embed_Validator {

	/**
	 * Plugin instance.
	 *
	 * @var TikTok_Embed_Validator
	 */
	private static $instance = null;

	/**
	 * Get the singleton instance.
	 *
	 * @return TikTok_Embed_Validator
	 */
	public static function get_instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Constructor.
	 */
	private function __construct() {
		add_action( 'enqueue_block_editor_assets', array( $this, 'enqueue_editor_assets' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_frontend_assets' ) );
		add_action( 'rest_api_init', array( $this, 'register_rest_routes' ) );
		add_filter( 'oembed_ttl', array( $this, 'shorten_tiktok_oembed_ttl' ), 10, 4 );
	}

	/**
	 * Enqueue editor assets.
	 *
	 * @return void
	 */
	public function enqueue_editor_assets() {
		$plugin_url = plugin_dir_url( __FILE__ );
		$plugin_dir = plugin_dir_path( __FILE__ );

		wp_enqueue_script(
			'tiktok-embed-validator',
			$plugin_url . 'assets/js/editor.js',
			array( 'wp-blocks', 'wp-element', 'wp-editor', 'wp-components', 'wp-data', 'wp-hooks', 'wp-api-fetch', 'wp-i18n' ),
			filemtime( $plugin_dir . 'assets/js/editor.js' ),
			true
		);

		wp_enqueue_style(
			'tiktok-embed-validator',
			$plugin_url . 'assets/css/editor.css',
			array(),
			filemtime( $plugin_dir . 'assets/css/editor.css' )
		);
	}

	/**
	 * Enqueue front-end script that re-initialises TikTok embed.js when embeds fail to hydrate.
	 *
	 * @return void
	 */
	public function enqueue_frontend_assets() {
		if ( ! has_block( 'core/embed' ) ) {
			return;
		}

		$plugin_url = plugin_dir_url( __FILE__ );
		$plugin_dir = plugin_dir_path( __FILE__ );

		wp_enqueue_script(
			'tiktok-embed-validator-frontend',
			$plugin_url . 'assets/js/frontend.js',
			array(),
			filemtime( $plugin_dir . 'assets/js/frontend.js' ),
			true
		);
	}

	/**
	 * Reduce the oEmbed cache TTL for TikTok URLs so WordPress fetches fresh embed HTML more often.
	 *
	 * @param int    $ttl      Default TTL in seconds.
	 * @param string $url      The oEmbed URL.
	 * @param array  $attr     Embed attributes.
	 * @param int    $post_id  Post ID.
	 *
	 * @return int
	 */
	public function shorten_tiktok_oembed_ttl( $ttl, $url, $attr, $post_id ) {
		if ( false !== strpos( $url, 'tiktok.com' ) ) {
			return 6 * HOUR_IN_SECONDS;
		}
		return $ttl;
	}

	/**
	 * Register REST API routes.
	 *
	 * @return void
	 */
	public function register_rest_routes() {
		register_rest_route(
			'tiktok-embed-validator/v1',
			'/check',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'check_tiktok_video' ),
				'permission_callback' => function () {
					return current_user_can( 'edit_posts' );
				},
				'args'                => array(
					'url'        => array(
						'required'          => true,
						'type'              => 'string',
						'sanitize_callback' => 'esc_url_raw',
					),
					'skip_cache' => array(
						'required' => false,
						'type'     => 'boolean',
						'default'  => false,
					),
				),
			)
		);
	}

	/**
	 * Transient cache duration in seconds (6 hours).
	 *
	 * @var int
	 */
	const CACHE_DURATION = 6 * HOUR_IN_SECONDS;

	/**
	 * Check if a TikTok video is accessible.
	 *
	 * @param WP_REST_Request $request The request object.
	 *
	 * @return WP_REST_Response
	 */
	public function check_tiktok_video( $request ) {
		$url        = $request->get_param( 'url' );
		$skip_cache = $request->get_param( 'skip_cache' );

		// Photo posts have no video file to check.
		if ( preg_match( '/photo\/(\d+)/', $url ) ) {
			return rest_ensure_response(
				array(
					'success'  => true,
					'message'  => __( 'TikTok photo post: there is no video source to check.', 'tiktok-embed-validator' ),
					'video_id' => null,
				)
			);
		}

		// Extract video ID.
		$video_id = $this->extract_video_id( $url );

		if ( ! $video_id ) {
			return rest_ensure_response(
				array(
					'success'  => false,
					'error'    => 'invalid_url',
					'message'  => __( 'Invalid TikTok URL.', 'tiktok-embed-validator' ),
					'video_id' => null,
				)
			);
		}

		// Check transient cache first (unless skip_cache is true).
		if ( ! $skip_cache ) {
			$cached_result = get_transient( 'tiktok_valid_' . $video_id );
			$cached_status = is_array( $cached_result ) ? (int) ( $cached_result['status'] ?? 0 ) : 0;

			// Rate limits and server errors cached by earlier versions aren't failures. Drop them and check again.
			if ( 429 === $cached_status || $cached_status >= 500 ) {
				delete_transient( 'tiktok_valid_' . $video_id );
				$cached_result = false;
			}

			if ( false !== $cached_result ) {
				$cached_result['cached'] = true;
				return rest_ensure_response( $cached_result );
			}
		}

		// Fetch TikTok's embed page to get video data.
		$embed_url = 'https://www.tiktok.com/embed/v2/' . $video_id;

		$response = wp_remote_get(
			$embed_url,
			array(
				'timeout'     => 20,
				'redirection' => 5,
				'user-agent'  => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
				'headers'     => array(
					'Accept'          => 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
					'Accept-Language' => 'en-US,en;q=0.5',
				),
			)
		);

		if ( is_wp_error( $response ) ) {
			// Don't cache network failures - they may be temporary.
			return rest_ensure_response(
				array(
					'success'  => false,
					'error'    => 'request_failed',
					'message'  => __( 'Failed to fetch TikTok embed page.', 'tiktok-embed-validator' ),
					'video_id' => $video_id,
				)
			);
		}

		$status_code = wp_remote_retrieve_response_code( $response );
		$body        = wp_remote_retrieve_body( $response );

		// Rate limits and server errors say nothing about the video. Don't flag or cache them.
		if ( 429 === $status_code || $status_code >= 500 ) {
			return rest_ensure_response(
				array(
					'success'  => true,
					'message'  => sprintf( __( 'TikTok embed page returned HTTP %d, so the video was not checked.', 'tiktok-embed-validator' ), $status_code ),
					'video_id' => $video_id,
					'status'   => $status_code,
				)
			);
		}

		if ( $status_code >= 400 ) {
			$result = array(
				'success'  => false,
				'error'    => 'embed_page_error',
				'message'  => sprintf( __( 'TikTok embed page returned HTTP %d.', 'tiktok-embed-validator' ), $status_code ),
				'video_id' => $video_id,
				'status'   => $status_code,
			);
			// Cache errors for shorter duration (1 hour) - video might become available.
			set_transient( 'tiktok_valid_' . $video_id, $result, HOUR_IN_SECONDS );
			return rest_ensure_response( $result );
		}

		// Extract video URL from the embed page.
		$video_url = $this->extract_video_url_from_embed_page( $body );

		if ( ! $video_url ) {
			// Check for error indicators in the page.
			if ( $this->page_has_error_indicators( $body ) ) {
				$result = array(
					'success'  => false,
					'error'    => 'video_unavailable',
					'message'  => __( 'Video appears to be unavailable or restricted.', 'tiktok-embed-validator' ),
					'video_id' => $video_id,
				);
				// Cache errors for shorter duration (1 hour).
				set_transient( 'tiktok_valid_' . $video_id, $result, HOUR_IN_SECONDS );
				return rest_ensure_response( $result );
			}

			$result = array(
				'success'   => false,
				'error'     => 'video_url_not_found',
				'message'   => __( 'Could not extract video URL. Unable to verify playback.', 'tiktok-embed-validator' ),
				'video_id'  => $video_id,
				'video_url' => null,
			);
			// Cache for shorter duration - might be temporary issue.
			set_transient( 'tiktok_valid_' . $video_id, $result, HOUR_IN_SECONDS );
			return rest_ensure_response( $result );
		}

		// Test the video URL.
		$video_check = $this->check_video_url( $video_url );

		if ( is_wp_error( $video_check ) ) {
			$result = array(
				'success'   => false,
				'error'     => $video_check->get_error_code(),
				'message'   => $video_check->get_error_message(),
				'video_id'  => $video_id,
				'video_url' => $video_url,
			);
			// Cache 403 errors for longer (6 hours) - they're usually permanent.
			$cache_duration = 'video_403' === $video_check->get_error_code() ? self::CACHE_DURATION : HOUR_IN_SECONDS;
			set_transient( 'tiktok_valid_' . $video_id, $result, $cache_duration );
			return rest_ensure_response( $result );
		}

		$result = array(
			'success'   => true,
			'message'   => __( 'Video source is accessible.', 'tiktok-embed-validator' ),
			'video_id'  => $video_id,
			'video_url' => $video_url,
		);
		// Cache successful results for 6 hours.
		set_transient( 'tiktok_valid_' . $video_id, $result, self::CACHE_DURATION );
		return rest_ensure_response( $result );
	}

	/**
	 * Extract video ID from TikTok URL.
	 *
	 * @param string $url The TikTok URL.
	 *
	 * @return string|null
	 */
	private function extract_video_id( $url ) {
		if ( preg_match( '/video\/(\d+)/', $url, $matches ) ) {
			return $matches[1];
		}
		return null;
	}

	/**
	 * Extract video URL from TikTok embed page HTML.
	 *
	 * @param string $html The embed page HTML.
	 *
	 * @return string|null
	 */
	private function extract_video_url_from_embed_page( $html ) {
		// TikTok embed page contains video data in various formats.
		// Look for playAddr or video URLs in the page.
		$patterns = array(
			// Direct video URL patterns.
			'/https?:\/\/[a-z0-9\-]+\.tiktokcdn[a-z\-]*\.com\/[^"\'<>\s]+\.mp4[^"\'<>\s]*/i',
			'/https?:\/\/v\d+[a-z\-]*\.tiktokcdn[a-z\-]*\.com\/[^"\'<>\s]+/i',
			// JSON encoded URLs.
			'/"playAddr"\s*:\s*"([^"]+)"/i',
			'/"downloadAddr"\s*:\s*"([^"]+)"/i',
			// URL list patterns.
			'/"url_list"\s*:\s*\[\s*"([^"]+)"/i',
			'/"UrlList"\s*:\s*\[\s*"([^"]+)"/i',
		);

		foreach ( $patterns as $pattern ) {
			if ( preg_match( $pattern, $html, $matches ) ) {
				$url = isset( $matches[1] ) ? $matches[1] : $matches[0];

				// Decode unicode escapes.
				if ( strpos( $url, '\\u' ) !== false ) {
					$url = json_decode( '"' . $url . '"' );
				}

				// Decode HTML entities.
				$url = html_entity_decode( $url );

				// Clean up.
				$url = preg_replace( '/["\'\s<>].*$/', '', $url );

				if ( filter_var( $url, FILTER_VALIDATE_URL ) && strpos( $url, 'tiktok' ) !== false ) {
					return $url;
				}
			}
		}

		return null;
	}

	/**
	 * Check if the page has error indicators.
	 *
	 * @param string $html The page HTML.
	 *
	 * @return bool
	 */
	private function page_has_error_indicators( $html ) {
		$error_patterns = array(
			'/video.*unavailable/i',
			'/video.*removed/i',
			'/video.*private/i',
			'/content.*unavailable/i',
			'/page.*not.*found/i',
			'/"statusCode"\s*:\s*(\d+)/i',
			'/"error"/i',
		);

		foreach ( $error_patterns as $pattern ) {
			if ( preg_match( $pattern, $html, $matches ) ) {
				// Check status code if present.
				if ( isset( $matches[1] ) && intval( $matches[1] ) >= 400 ) {
					return true;
				}
				// For other patterns, just return true.
				if ( ! isset( $matches[1] ) ) {
					return true;
				}
			}
		}

		return false;
	}

	/**
	 * Check if a video URL is accessible.
	 *
	 * @param string $video_url The video URL.
	 *
	 * @return true|WP_Error
	 */
	private function check_video_url( $video_url ) {
		$response = wp_remote_head(
			$video_url,
			array(
				'timeout'     => 15,
				'redirection' => 3,
				'user-agent'  => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
				'headers'     => array(
					'Accept'  => 'video/mp4,video/*;q=0.9,*/*;q=0.5',
					'Referer' => 'https://www.tiktok.com/',
				),
			)
		);

		// Connection failures or timeouts - these are server network issues.
		// The video likely works for visitors since their browsers get fresh tokens.
		if ( is_wp_error( $response ) ) {
			// Treat as success - if embed page loaded, video should work for visitors.
			return true;
		}

		$status_code = wp_remote_retrieve_response_code( $response );

		// Gateway/timeout errors (502, 503, 504, etc.) - server network issues.
		// TikTok video URLs have IP-bound or time-limited tokens, so server checks may fail
		// even when the video works fine for visitors.
		if ( in_array( $status_code, array( 0, 502, 503, 504, 522, 524 ), true ) ) {
			// Treat as success - the embed page loaded, so video should work for visitors.
			return true;
		}

		// 403 is a definitive block - the video won't play.
		if ( 403 === $status_code ) {
			return new WP_Error(
				'video_403',
				__( 'The video file is blocked and will not play for visitors.', 'tiktok-embed-validator' )
			);
		}

		// Other 4xx errors might indicate actual issues.
		if ( $status_code >= 400 && $status_code < 500 ) {
			return new WP_Error(
				'video_error_' . $status_code,
				sprintf( __( 'Video source returned HTTP %d.', 'tiktok-embed-validator' ), $status_code )
			);
		}

		return true;
	}
}

// Initialize the plugin.
TikTok_Embed_Validator::get_instance();
