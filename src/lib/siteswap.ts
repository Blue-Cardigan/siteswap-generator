const CHAR_MAP = "0123456789abcdefghijklmnopqrstuvwxyz";

export type SiteswapData = {
  pattern: number[];
  period: number;
  balls: number;
  maxThrow: number;
};

export class SiteswapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SiteswapError";
  }
}

export function parseSiteswap(rawInput: string): SiteswapData {
  const cleaned = rawInput.toLowerCase().replace(/\s+/g, "");

  if (!cleaned) {
    throw new SiteswapError("Enter at least one throw height.");
  }

  const pattern: number[] = [];

  for (const char of cleaned) {
    const value = CHAR_MAP.indexOf(char);
    if (value === -1) {
      throw new SiteswapError(
        `Unsupported character "${char}". Use 0-9 or a-z for throws.`,
      );
    }
    pattern.push(value);
  }

  if (pattern.every((value) => value === 0)) {
    throw new SiteswapError("Pattern cannot be all zeros.");
  }

  const period = pattern.length;
  const sum = pattern.reduce((acc, value) => acc + value, 0);
  const balls = sum / period;

  if (!Number.isInteger(balls)) {
    throw new SiteswapError("Average throw height must be an integer (invalid pattern).");
  }

  // Validate collisions using standard modular test.
  const landings = new Set<number>();
  pattern.forEach((value, index) => {
    if (value === 0) {
      return;
    }
    const landing = (index + value) % period;
    if (landings.has(landing)) {
      throw new SiteswapError("Two balls collide in the same beat (invalid pattern).");
    }
    landings.add(landing);
  });

  if (balls < 1) {
    throw new SiteswapError("Pattern must include at least one ball.");
  }

  return {
    pattern,
    period,
    balls,
    maxThrow: Math.max(...pattern),
  };
}

