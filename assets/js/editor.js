( function( wp ) {
	'use strict';

	var createElement = wp.element.createElement;
	var Fragment = wp.element.Fragment;
	var useState = wp.element.useState;
	var useEffect = wp.element.useEffect;
	var useRef = wp.element.useRef;
	var useCallback = wp.element.useCallback;
	var addFilter = wp.hooks.addFilter;
	var createHigherOrderComponent = wp.compose.createHigherOrderComponent;
	var Notice = wp.components.Notice;
	var Button = wp.components.Button;
	var Spinner = wp.components.Spinner;
	var apiFetch = wp.apiFetch;
	var __ = wp.i18n.__;

	// Cache validation results per video ID.
	var validationCache = {};

	/**
	 * Check if a URL is a TikTok URL.
	 */
	function isTikTokUrl( url ) {
		return url && /tiktok\.com/i.test( url );
	}

	/**
	 * Extract video ID from TikTok URL.
	 */
	function extractVideoId( url ) {
		if ( ! url ) {
			return null;
		}
		var match = url.match( /video\/(\d+)/ );
		return match ? match[ 1 ] : null;
	}

	/**
	 * Validate a TikTok video via REST API.
	 */
	function validateTikTokVideo( url ) {
		var videoId = extractVideoId( url );
		var cacheKey = videoId || url;

		// Check cache.
		if ( validationCache[ cacheKey ] ) {
			return Promise.resolve( validationCache[ cacheKey ] );
		}

		return apiFetch( {
			path: '/tiktok-embed-validator/v1/check',
			method: 'POST',
			data: { url: url }
		} ).then( function( response ) {
			validationCache[ cacheKey ] = response;
			return response;
		} ).catch( function( error ) {
			var errorResponse = {
				success: false,
				error: 'request_failed',
				message: error.message || __( 'Failed to validate video.', 'tiktok-embed-validator' )
			};
			validationCache[ cacheKey ] = errorResponse;
			return errorResponse;
		} );
	}

	/**
	 * Clear cache for a video.
	 */
	function clearCache( url ) {
		var videoId = extractVideoId( url );
		var cacheKey = videoId || url;
		delete validationCache[ cacheKey ];
	}

	/**
	 * Truncate URL for display.
	 */
	function truncateUrl( url, maxLen ) {
		maxLen = maxLen || 60;
		if ( ! url || url.length <= maxLen ) {
			return url;
		}
		return url.substring( 0, maxLen ) + '...';
	}

	/**
	 * Higher-order component for TikTok validation.
	 */
	var withTikTokValidation = createHigherOrderComponent( function( BlockEdit ) {
		return function( props ) {
			var attributes = props.attributes;
			var name = props.name;

			var stateHook = useState( {
				isChecking: false,
				hasChecked: false,
				result: null
			} );
			var currentState = stateHook[ 0 ];
			var setState = stateHook[ 1 ];

			var lastCheckedUrl = useRef( null );

			var url = attributes.url;
			var providerNameSlug = attributes.providerNameSlug;
			var isTikTokEmbed = name === 'core/embed' && ( providerNameSlug === 'tiktok' || isTikTokUrl( url ) );

			var runValidation = useCallback( function() {
				if ( ! url ) {
					return;
				}

				setState( {
					isChecking: true,
					hasChecked: false,
					result: null
				} );

				validateTikTokVideo( url ).then( function( result ) {
					setState( {
						isChecking: false,
						hasChecked: true,
						result: result
					} );
				} );
			}, [ url ] );

			var handleRecheck = useCallback( function() {
				clearCache( url );
				lastCheckedUrl.current = null;
				runValidation();
			}, [ url, runValidation ] );

			// Run validation when URL changes.
			useEffect( function() {
				if ( ! isTikTokEmbed || ! url ) {
					return;
				}

				if ( lastCheckedUrl.current === url ) {
					return;
				}

				lastCheckedUrl.current = url;
				runValidation();
			}, [ isTikTokEmbed, url, runValidation ] );

			// Not a TikTok embed - render normally.
			if ( ! isTikTokEmbed ) {
				return createElement( BlockEdit, props );
			}

			var result = currentState.result;
			var hasError = currentState.hasChecked && result && result.success === false;
			var hasSuccess = currentState.hasChecked && result && result.success === true;
			var hasWarning = currentState.hasChecked && result && result.warning;

			return createElement(
				Fragment,
				null,
				// Checking indicator.
				currentState.isChecking && createElement(
					'div',
					{ className: 'tiktok-embed-validator-checking' },
					createElement( Spinner, null ),
					createElement( 'span', null, __( 'Checking TikTok video...', 'tiktok-embed-validator' ) )
				),
				// Error notice.
				hasError && createElement(
					Notice,
					{ status: 'error', isDismissible: false, className: 'tiktok-embed-validator-error' },
					createElement( 'strong', null,
						currentState.result.error === 'video_403'
							? __( 'TikTok Video Blocked (403)', 'tiktok-embed-validator' )
							: __( 'TikTok Video Error', 'tiktok-embed-validator' )
					),
					createElement( 'p', { className: 'tiktok-embed-validator-message' }, currentState.result.message ),
					currentState.result.video_url && createElement(
						'p',
						{ className: 'tiktok-embed-validator-detail' },
						createElement( 'strong', null, __( 'Video URL: ', 'tiktok-embed-validator' ) ),
						createElement( 'code', { title: currentState.result.video_url }, truncateUrl( currentState.result.video_url ) )
					),
					currentState.result.error === 'video_403' && createElement(
						'div',
						{ className: 'tiktok-embed-validator-help' },
						createElement( 'p', null, __( 'The video embed will appear but won\'t play. Causes:', 'tiktok-embed-validator' ) ),
						createElement( 'ul', null,
							createElement( 'li', null, __( 'Region-locked content', 'tiktok-embed-validator' ) ),
							createElement( 'li', null, __( 'Expired playback tokens', 'tiktok-embed-validator' ) ),
							createElement( 'li', null, __( 'Creator restricted embedding', 'tiktok-embed-validator' ) ),
							createElement( 'li', null, __( 'Video removed or made private', 'tiktok-embed-validator' ) )
						)
					),
					createElement(
						Button,
						{ variant: 'secondary', onClick: handleRecheck, className: 'tiktok-embed-validator-recheck' },
						__( 'Re-check', 'tiktok-embed-validator' )
					)
				),
				// Warning notice.
				hasWarning && createElement(
					Notice,
					{ status: 'warning', isDismissible: false, className: 'tiktok-embed-validator-warning' },
					result.message,
					createElement(
						Button,
						{ variant: 'secondary', onClick: handleRecheck, style: { marginLeft: '10px' } },
						__( 'Re-check', 'tiktok-embed-validator' )
					)
				),
				// Success notice.
				hasSuccess && createElement(
					Notice,
					{ status: 'success', isDismissible: false, className: 'tiktok-embed-validator-success' },
					__( 'TikTok video is accessible.', 'tiktok-embed-validator' )
				),
				// Render the block.
				createElement( BlockEdit, props )
			);
		};
	}, 'withTikTokValidation' );

	addFilter( 'editor.BlockEdit', 'tiktok-embed-validator/with-validation', withTikTokValidation );

} )( window.wp );
