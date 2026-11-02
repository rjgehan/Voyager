// Platform detection for key labels (Mod = Cmd on Apple) and iOS-specific editor behaviour.

const nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator;
const ua = nav?.userAgent ?? '';
const platform = nav?.platform ?? '';

/** iPhone, iPad (including iPadOS reporting itself as a Mac) and iPod. */
export const isIOS: boolean = /iP(hone|ad|od)/.test(ua) || (platform === 'MacIntel' && (nav?.maxTouchPoints ?? 0) > 1);

export const isApple: boolean = isIOS || /Mac/.test(platform) || /Mac OS X/.test(ua);

/** True when the primary pointer is coarse (touch). */
export function isCoarsePointer(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}

/**
 * The phone layout (DESIGN §6.16): narrower than 768 px, or a touch screen less than 500 px tall,
 * which is a phone on its side (an iPhone in landscape is 812–956 px wide). The stylesheets use the
 * same media query for their phone rules.
 */
export const PHONE_QUERY = '(max-width: 767px), (max-height: 500px) and (pointer: coarse)';

/** True while the phone layout is in use. */
export function isPhoneLayout(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches;
}

/** True when the platform's Mod key (Cmd on Apple, Ctrl elsewhere) is held. */
export function modKey(e: { metaKey: boolean; ctrlKey: boolean }): boolean {
  return isApple ? e.metaKey : e.ctrlKey;
}

/** Display label for a CodeMirror-style key spec such as `Mod-Alt-n`. */
export function keyLabel(spec: string): string {
  return spec
    .split('-')
    .map((part) => {
      switch (part) {
        case 'Mod':
          return isApple ? '⌘' : 'Ctrl';
        case 'Alt':
          return isApple ? '⌥' : 'Alt';
        case 'Shift':
          return isApple ? '⇧' : 'Shift';
        case 'ArrowLeft':
          return '←';
        case 'ArrowRight':
          return '→';
        case 'ArrowUp':
          return '↑';
        case 'ArrowDown':
          return '↓';
        default:
          return part.length === 1 ? part.toUpperCase() : part;
      }
    })
    .join(isApple ? '' : '+');
}
