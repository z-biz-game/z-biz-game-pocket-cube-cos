// Deterministic noise, so `node assets/gen/make-art.mjs` produces byte-identical bitmaps on
// every machine. Math.random() would make the shipped icons unreproducible, and "regenerate and
// get a different logo" is not a property an asset pipeline can ship with.

// Numerical Recipes' LCG: 32-bit state, integer-only, no floating-point drift between platforms.
export function lcg(seed = 1) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// A hash of (x, y) into [-1, 1]. Not smooth, which is the point: this is film grain for the
// page ground, and a value-noise lattice would show its own cell structure at 256px.
export function grain(x, y, seed = 0x9e3779b9) {
  let h = (x * 374761393 + y * 668265263 + seed) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 1274126177) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h / 4294967296) * 2 - 1;
}
