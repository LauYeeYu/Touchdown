// Whether the reader asks for reduced motion (DESIGN.md, "Motion"): then nothing moves, and a change is made at once.

export const reducedMotion = (): boolean => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
