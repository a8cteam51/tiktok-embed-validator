( function( wp ) {
	'use strict';

	var createElement = wp.element.createElement;
	var Fragment = wp.element.Fragment;
	var useState = wp.element.useState;
	var useRef = wp.element.useRef;
	var addFilter = wp.hooks.addFilter;
	var createHigherOrderComponent = wp.compose.createHigherOrderComponent;
	var Notice = wp.components.Notice;
	var Button = wp.components.Button;
	var Spinner = wp.components.Spinner;
	var Placeholder = wp.components.Placeholder;
	var TextControl = wp.components.TextControl;
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
	 */
	var withTikTokValidation = createHigherOrderComponent( function( BlockEdit ) {
		return function( props ) {
			var name = props.name;
			var originalSetAttributes = props.setAttributes;

			// State for validation.
			var stateHook = useState( {
				isValidating: false,
				pendingUrl: null,
				inputUrl: '',
				validationResult: null
			} );
			var state = stateHook[ 0 ];
			var setState = stateHook[ 1 ];

			// Ref to store current URL (always up to date, avoids closure issues).
			var currentUrlRef = useRef( '' );
			// Keep ref in sync with state.
			currentUrlRef.current = state.inputUrl || state.pendingUrl || '';
			
			// Flag to skip validation (used when forcing embed).
			var skipValidationRef = useRef( false );

			// Only process embed blocks.
			if ( name !== 'core/embed' ) {
				return createElement( BlockEdit, props );
			}

			// Handle URL input change.
			function handleInputChange( value ) {
				setState( Object.assign( {}, state, { inputUrl: value } ) );
			}

			// Handle form submit.
			function handleSubmit( e ) {
				if ( e ) {
					e.preventDefault();
				}
				
				var urlToCheck = state.inputUrl;
				if ( ! urlToCheck ) {
					return;
				}

				// If not TikTok, just embed directly.
				if ( ! isTikTokUrl( urlToCheck ) ) {
					originalSetAttributes( { url: urlToCheck } );
					setState( {
						isValidating: false,
						pendingUrl: null,
						inputUrl: '',
						validationResult: null
					} );
					return;
				}

				// TikTok URL - validate first.
				setState( {
					isValidating: true,
					pendingUrl: urlToCheck,
					inputUrl: urlToCheck,
					validationResult: null
				} );

				validateTikTokVideo( urlToCheck ).then( function( result ) {
					if ( result.success === true ) {
						// Video OK - embed it.
						currentUrlRef.current = '';
						setState( {
							isValidating: false,
							pendingUrl: null,
							inputUrl: '',
							validationResult: null
						} );
						originalSetAttributes( { url: urlToCheck } );
					} else {
						// Video has issues.
						setState( {
							isValidating: false,
							pendingUrl: urlToCheck,
							inputUrl: urlToCheck,
							validationResult: result
						} );
					}
				} );
			}

			// Wrapped setAttributes - intercept TikTok URLs.
			function handleSetAttributes( newAttributes ) {
				// If skip validation flag is set, pass through without validation.
				if ( skipValidationRef.current ) {
					skipValidationRef.current = false;
					originalSetAttributes( newAttributes );
					return;
				}
				
				// If not setting a URL or not TikTok, pass through.
				if ( ! newAttributes.url || ! isTikTokUrl( newAttributes.url ) ) {
					originalSetAttributes( newAttributes );
					return;
				}

				// TikTok URL - validate via our form handler.
				var urlToCheck = newAttributes.url;
				
				setState( {
					isValidating: true,
					pendingUrl: urlToCheck,
					inputUrl: urlToCheck,
					validationResult: null
				} );

				validateTikTokVideo( urlToCheck ).then( function( result ) {
					if ( result.success === true ) {
						currentUrlRef.current = '';
						setState( {
							isValidating: false,
							pendingUrl: null,
							inputUrl: '',
							validationResult: null
						} );
						originalSetAttributes( { url: urlToCheck } );
					} else {
						setState( {
							isValidating: false,
							pendingUrl: urlToCheck,
							inputUrl: urlToCheck,
							validationResult: result
						} );
					}
				} );
			}

			// Force embed button handler.
			function handleForceEmbed( e ) {
				e.preventDefault();
				e.stopPropagation();
				
				var url = currentUrlRef.current;
				if ( ! url ) {
					return;
				}

				// Store URL before clearing state.
				var urlToEmbed = url;
				
				// Set flag to skip validation on next setAttributes call.
				skipValidationRef.current = true;
				
				currentUrlRef.current = '';
				setState( {
					isValidating: false,
					pendingUrl: null,
					inputUrl: '',
					validationResult: null
				} );

				setTimeout( function() {
					originalSetAttributes( { url: urlToEmbed } );
				}, 0 );
			}

			// Retry button handler.
			function handleRetry( e ) {
				e.preventDefault();
				e.stopPropagation();
				
				var url = currentUrlRef.current;
				if ( ! url ) {
					return;
				}

				clearCache( url );
				
				setState( {
					isValidating: true,
					pendingUrl: url,
					inputUrl: url,
					validationResult: null
				} );

				validateTikTokVideo( url ).then( function( result ) {
					if ( result.success === true ) {
						currentUrlRef.current = '';
						setState( {
							isValidating: false,
							pendingUrl: null,
							inputUrl: '',
							validationResult: null
						} );
						originalSetAttributes( { url: url } );
					} else {
						setState( {
							isValidating: false,
							pendingUrl: url,
							inputUrl: url,
							validationResult: result
						} );
					}
				} );
			}

			// Show validating state with form.
			if ( state.isValidating ) {
				return createElement(
					Placeholder,
					{
						icon: 'embed-video',
						label: __( 'Embed', 'tiktok-embed-validator' ),
						className: 'wp-block-embed',
						instructions: __( 'Paste a link to the content you want to display on your site.', 'tiktok-embed-validator' )
					},
					createElement(
						'form',
						{ onSubmit: handleSubmit, className: 'tiktok-embed-validator-form' },
						createElement( TextControl, {
							type: 'url',
							value: state.inputUrl,
							onChange: handleInputChange,
							placeholder: __( 'Enter URL to embed here…', 'tiktok-embed-validator' ),
							className: 'tiktok-embed-validator-input',
							disabled: true
						} ),
						createElement(
							Button,
							{
								variant: 'primary',
								type: 'submit',
								disabled: true,
								className: 'tiktok-embed-validator-button'
							},
							__( 'Embed', 'tiktok-embed-validator' )
						)
					),
					createElement(
						'div',
						{ className: 'tiktok-embed-validator-checking' },
						createElement( Spinner, null ),
						createElement( 'span', null, __( 'Checking TikTok video…', 'tiktok-embed-validator' ) )
					)
				);
			}

			// Show error state with form.
			if ( state.validationResult && state.validationResult.success === false ) {
				return createElement(
          Placeholder,
          {
            icon: "embed-video",
            label: __("Embed", "tiktok-embed-validator"),
            className: "wp-block-embed",
            instructions: __(
              "Paste a link to the content you want to display on your site.",
              "tiktok-embed-validator"
            ),
          },
          createElement(
            "form",
            {
              onSubmit: handleSubmit,
              className: "tiktok-embed-validator-form",
            },
            createElement(TextControl, {
              type: "url",
              value: state.inputUrl,
              onChange: handleInputChange,
              placeholder: __(
                "Enter URL to embed here…",
                "tiktok-embed-validator"
              ),
              className: "tiktok-embed-validator-input",
            }),
            createElement(
              Button,
              {
                variant: "primary",
                type: "submit",
                disabled: !state.inputUrl,
                className: "tiktok-embed-validator-button",
              },
              __("Embed", "tiktok-embed-validator")
            )
          ),
          createElement(
            Notice,
            {
              status: "error",
              isDismissible: false,
              className: "tiktok-embed-validator-error",
            },
            createElement(
              "strong",
              null,
              state.validationResult.error === "video_403"
                ? __("TikTok Video Blocked", "tiktok-embed-validator")
                : state.validationResult.error === "video_url_not_found"
                ? __("Could Not Verify Video", "tiktok-embed-validator")
                : __("TikTok Video Error", "tiktok-embed-validator")
            ),
            createElement("p", null, state.validationResult.message),
            state.validationResult.error === "video_403" &&
              createElement(
                "p",
                { className: "tiktok-embed-validator-help-text" },
                __(
                  "Possible causes: region lock, embedding disabled, or video removed.",
                  "tiktok-embed-validator"
                )
              ),
            state.validationResult.error === "video_url_not_found" &&
              createElement(
                "p",
                { className: "tiktok-embed-validator-help-text" },
                __(
                  "The video source URL could not be extracted for verification. This may indicate the video is unavailable.",
                  "tiktok-embed-validator"
                )
              ),
            createElement(
              "div",
              { className: "tiktok-embed-validator-actions" },
              createElement(
                Button,
                {
                  variant: "secondary",
                  type: "button",
                  onClick: handleRetry,
                },
                __("Re-check", "tiktok-embed-validator")
              ),
              createElement(
                Button,
                {
                  variant: "link",
                  type: "button",
                  onClick: handleForceEmbed,
                },
                __("Embed anyway", "tiktok-embed-validator")
              )
            )
          )
        );
			}

			// Normal render with wrapped setAttributes.
			var newProps = Object.assign( {}, props, {
				setAttributes: handleSetAttributes
			} );

			return createElement( BlockEdit, newProps );
		};
	}, 'withTikTokValidation' );

	addFilter( 'editor.BlockEdit', 'tiktok-embed-validator/with-validation', withTikTokValidation );

} )( window.wp );
