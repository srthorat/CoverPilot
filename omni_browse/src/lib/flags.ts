// This build is a demo: it works on the bundled sample documents only. The code that reads a file the
// customer picks (blur-first ID reading, PDF review) is kept and tested, but its controls are hidden
// unless the image is built with NEXT_PUBLIC_ALLOW_OWN_FILES=true.
export const ALLOW_OWN_FILES = process.env.NEXT_PUBLIC_ALLOW_OWN_FILES === 'true';
