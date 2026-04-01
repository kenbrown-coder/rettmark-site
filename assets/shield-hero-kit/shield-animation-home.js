/**
 * Snapshot: final keyframe for the home crest (.crest-wrap) after the spin.
 * Full animation (hold + rotateY + keyframes) lives in js/site.js — search isHome.
 *
 * When pasting into a custom animate() call, use something like:
 *   opacity: isHome ? 1 : 0.28,
 *   transform: isMobile && !isHome ? "translateY(-64px) scale(1) rotateY(0deg)" : "scale(1) rotateY(0deg)",
 *   filter: isHome
 *     ? (isMobile
 *         ? "drop-shadow(0 20px 36px rgba(0,0,0,0.48)) drop-shadow(0 0 10px rgba(230,0,0,0.1))"
 *         : "drop-shadow(0 24px 44px rgba(0,0,0,0.5)) drop-shadow(0 0 12px rgba(230,0,0,0.12))")
 *     : (isMobile ? "brightness(1.4) contrast(1.1)" : "brightness(1.15) contrast(1.06)")
 */
