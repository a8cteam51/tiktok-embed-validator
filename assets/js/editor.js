( function( wp ) {
	'use strict';

	var createElement = wp.element.createElement;
	var createPortal = wp.element.createPortal;
	var useState = wp.element.useState;
	var useEffect = wp.element.useEffect;
	var useLayoutEffect = wp.element.useLayoutEffect;
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
	function validateTikTokVideo( url, skipCache ) {
		var videoId = extractVideoId( url );
		var cacheKey = videoId || url;

		// Check cache unless skipping.
		if ( ! skipCache && validationCache[ cacheKey ] ) {
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
	 * Higher-order component for TikTok embed validation.
	 * Validates whenever a TikTok URL is set (embed button clicked).
	 */
	var withTikTokValidation = createHigherOrderComponent( function( BlockEdit ) {
		return function( props ) {
			var name = props.name;
			var attributes = props.attributes;
			var originalSetAttributes = props.setAttributes;
			var isSelected = props.isSelected;
			var url = attributes.url;

			// State for validation.
			var stateHook = useState( {
				isValidating: false,
				validationResult: null,
				dismissed: false
			} );
			var state = stateHook[ 0 ];
			var setState = stateHook[ 1 ];

			// State for figure element (for portal).
			var figureStateHook = useState( null );
			var figureElement = figureStateHook[ 0 ];
			var setFigureElement = figureStateHook[ 1 ];

			// Ref for wrapper to find figure.
			var wrapperRef = useRef( null );

			// Only process embed blocks.
			if ( name !== 'core/embed' ) {
				return createElement( BlockEdit, props );
			}

			var isTikTokEmbed = isTikTokUrl( url );

			// Wrapped setAttributes - validates TikTok URLs when set.
			var wrappedSetAttributes = useCallback( function( newAttributes ) {
				// Always pass through to original setAttributes first (non-blocking).
				originalSetAttributes( newAttributes );

				// If setting a TikTok URL, validate it.
				if ( newAttributes.url && isTikTokUrl( newAttributes.url ) ) {
					// Clear cache to force fresh check when re-embedding.
					clearCache( newAttributes.url );
					
					setState( {
						isValidating: true,
						validationResult: null,
						dismissed: false
					} );

					validateTikTokVideo( newAttributes.url, true ).then( function( result ) {
						// Only show errors, not success.
						if ( result.success === false ) {
							setState( {
								isValidating: false,
								validationResult: result,
								dismissed: false
							} );
						} else {
							setState( {
								isValidating: false,
								validationResult: null,
								dismissed: false
							} );
						}
					} );
				}
			}, [ originalSetAttributes ] );

		// Find figure element when block is selected (useLayoutEffect to avoid flicker).
		useLayoutEffect( function() {
			if ( ! isSelected ) {
				if ( figureElement ) {
					setFigureElement( null );
				}
				return;
			}

			if ( ! wrapperRef.current || ! isTikTokEmbed ) {
				return;
			}

			var figure = wrapperRef.current.querySelector( 'figure.wp-block-embed' );
			if ( figure && figure !== figureElement ) {
				setFigureElement( figure );
			}
		}, [ isSelected, isTikTokEmbed, figureElement ] );

		// Retry finding figure after validation completes (in case embed just rendered).
		useEffect( function() {
			if ( isSelected && wrapperRef.current && isTikTokEmbed && ! figureElement ) {
				var timer = setTimeout( function() {
					var figure = wrapperRef.current && wrapperRef.current.querySelector( 'figure.wp-block-embed' );
					if ( figure ) {
						setFigureElement( figure );
					}
				}, 100 );
				return function() {
					clearTimeout( timer );
				};
			}
		}, [ isSelected, isTikTokEmbed, figureElement, state.validationResult ] );

		// Validate on page load for existing TikTok embeds (only show errors).
		useEffect( function() {
			if ( isTikTokEmbed && url && ! state.validationResult && ! state.isValidating ) {
				setState( function( prev ) {
					return Object.assign( {}, prev, {
						isValidating: true,
						validationResult: null,
						dismissed: false
					} );
				} );

				validateTikTokVideo( url, false ).then( function( result ) {
					// Only show errors, not success.
					if ( result.success === false ) {
						setState( function( prev ) {
							return Object.assign( {}, prev, {
								isValidating: false,
								validationResult: result,
								dismissed: false
							} );
						} );
					} else {
						setState( function( prev ) {
							return Object.assign( {}, prev, {
								isValidating: false,
								validationResult: null,
								dismissed: false
							} );
						} );
					}
				} );
			}
		}, [ url ] );

		// Handle dismiss.
		function handleDismiss() {
			setState( Object.assign( {}, state, { dismissed: true } ) );
		}

			// Handle re-check.
			function handleRecheck() {
				if ( ! url ) {
					return;
				}

				clearCache( url );

				setState( {
					isValidating: true,
					validationResult: null,
					dismissed: false
				} );

			validateTikTokVideo( url, true ).then( function( result ) {
				// Only show errors, not success.
				if ( result.success === false ) {
					setState( {
						isValidating: false,
						validationResult: result,
						dismissed: false
					} );
				} else {
					setState( {
						isValidating: false,
						validationResult: null,
						dismissed: false
					} );
				}
			} );
		}

			// Create new props with wrapped setAttributes.
			var newProps = Object.assign( {}, props, {
				setAttributes: wrappedSetAttributes
			} );

			// If not a TikTok embed, render with wrapped setAttributes.
			if ( ! isTikTokEmbed ) {
				return createElement( BlockEdit, newProps );
			}

			// Determine what to show.
			var showValidating = state.isValidating;
			var showError = ! state.dismissed && state.validationResult && state.validationResult.success === false;

			// Create notice element.
			var noticeElement = null;
			if ( showValidating ) {
				noticeElement = createElement(
					'div',
					{ className: 'tiktok-embed-validator-checking' },
					createElement( Spinner, null ),
					createElement( 'span', null, __( 'Checking TikTok video…', 'tiktok-embed-validator' ) )
				);
			} else if ( showError ) {
				noticeElement = createElement(
					Notice,
					{
						status: 'error',
						isDismissible: true,
						onDismiss: handleDismiss,
						className: 'tiktok-embed-validator-error'
					},
					createElement( 'strong', null,
						state.validationResult.error === 'video_403'
							? __( 'TikTok Video Blocked', 'tiktok-embed-validator' )
							: state.validationResult.error === 'video_url_not_found'
								? __( 'Could Not Verify Video', 'tiktok-embed-validator' )
								: __( 'TikTok Video Error', 'tiktok-embed-validator' )
					),
					createElement( 'p', null, state.validationResult.message ),
					state.validationResult.error === 'video_403' && createElement(
						'p',
						{ className: 'tiktok-embed-validator-help-text' },
						__( 'Possible causes: region lock, embedding disabled, or video removed.', 'tiktok-embed-validator' )
					),
					state.validationResult.error === 'video_url_not_found' && createElement(
						'p',
						{ className: 'tiktok-embed-validator-help-text' },
						__( 'The video source URL could not be extracted for verification. This may indicate the video is unavailable.', 'tiktok-embed-validator' )
					),
					createElement(
						Button,
						{
							variant: 'secondary',
							type: 'button',
							onClick: handleRecheck,
							style: { marginTop: '8px' }
						},
						__( 'Re-check', 'tiktok-embed-validator' )
					)
				);
			}

			// Determine if we should portal inside figure.
			var shouldPortal = isSelected && figureElement;

			return createElement(
				'div',
				{ className: 'tiktok-embed-validator-wrapper', ref: wrapperRef },
				// Show notice outside when not selected or figure not found.
				noticeElement && ! shouldPortal && createElement(
					'div',
					{ className: 'tiktok-embed-validator-notice-outside' },
					noticeElement
				),
				// Render the block.
				createElement( BlockEdit, newProps ),
				// Portal notice inside figure when selected.
				noticeElement && shouldPortal && createPortal(
					createElement(
						'div',
						{ className: 'tiktok-embed-validator-notice-inside' },
						noticeElement
					),
					figureElement
				)
			);
		};
	}, 'withTikTokValidation' );

	addFilter( 'editor.BlockEdit', 'tiktok-embed-validator/with-validation', withTikTokValidation );

} )( window.wp );
