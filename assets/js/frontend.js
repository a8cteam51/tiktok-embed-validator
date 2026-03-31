( function() {
	'use strict';

	var RETRY_DELAY = 3000;
	var MAX_RETRIES = 3;

	/**
	 * Check whether a TikTok blockquote has been hydrated into an iframe player.
	 */
	function isHydrated( blockquote ) {
		return !! blockquote.querySelector( 'iframe' );
	}

	/**
	 * Reload TikTok's embed.js by appending a fresh script tag.
	 */
	function reloadEmbedScript() {
		return new Promise( function( resolve ) {
			var script = document.createElement( 'script' );
			script.src = 'https://www.tiktok.com/embed.js';
			script.async = true;
			script.onload = resolve;
			script.onerror = resolve;
			document.body.appendChild( script );
		} );
	}

	/**
	 * Attempt to hydrate any un-rendered TikTok embeds.
	 * Tries the global tiktokEmbed API first, falls back to reloading the script.
	 */
	function hydrateEmbeds( retryCount ) {
		var embeds = document.querySelectorAll( 'blockquote.tiktok-embed' );
		if ( 0 === embeds.length ) {
			return;
		}

		var hasUnhydrated = false;
		embeds.forEach( function( el ) {
			if ( ! isHydrated( el ) ) {
				hasUnhydrated = true;
			}
		} );

		if ( ! hasUnhydrated ) {
			return;
		}

		if ( window.tiktokEmbed && 'object' === typeof window.tiktokEmbed.lib ) {
			try {
				window.tiktokEmbed.lib.render();
			} catch ( e ) {
				// Fall through to the script-reload path.
			}
		}

		setTimeout( function() {
			var stillPending = false;
			embeds.forEach( function( el ) {
				if ( ! isHydrated( el ) ) {
					stillPending = true;
				}
			} );

			if ( ! stillPending || retryCount >= MAX_RETRIES ) {
				return;
			}

			reloadEmbedScript().then( function() {
				setTimeout( function() {
					hydrateEmbeds( retryCount + 1 );
				}, RETRY_DELAY );
			} );
		}, 1000 );
	}

	/**
	 * Watch for dynamically inserted TikTok blockquotes and trigger hydration.
	 */
	function observeDynamicEmbeds() {
		if ( 'undefined' === typeof MutationObserver ) {
			return;
		}

		var observer = new MutationObserver( function( mutations ) {
			var found = false;
			mutations.forEach( function( mutation ) {
				if ( found ) {
					return;
				}
				for ( var i = 0; i < mutation.addedNodes.length; i++ ) {
					var node = mutation.addedNodes[ i ];
					if ( 1 !== node.nodeType ) {
						continue;
					}
					if (
						node.matches( 'blockquote.tiktok-embed' ) ||
						node.querySelector( 'blockquote.tiktok-embed' )
					) {
						found = true;
						break;
					}
				}
			} );

			if ( found ) {
				setTimeout( function() {
					hydrateEmbeds( 0 );
				}, 500 );
			}
		} );

		observer.observe( document.body, { childList: true, subtree: true } );
	}

	if ( 'loading' === document.readyState ) {
		document.addEventListener( 'DOMContentLoaded', function() {
			setTimeout( function() {
				hydrateEmbeds( 0 );
			}, RETRY_DELAY );
			observeDynamicEmbeds();
		} );
	} else {
		setTimeout( function() {
			hydrateEmbeds( 0 );
		}, RETRY_DELAY );
		observeDynamicEmbeds();
	}
} )();
