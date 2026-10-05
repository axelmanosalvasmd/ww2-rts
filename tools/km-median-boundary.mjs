// Prospective median classification preserves the existing floating survival curve.
export const KM_MEDIAN_BOUNDARY_VERSION = 'km-exact-half-v1';
const gcd = (a, b) => { while (b) [a, b] = [b, a % b]; return a; };
export function exactHalfBoundary() {
  const factors = []; let exact = null, consumed = 0;
  return (survival, risk, observed) => {
    if (observed) factors.push([risk - observed, risk]);
    // A conservative accumulation bound limits exact arithmetic to an ambiguous half crossing.
    const uncertainty = 4 * Number.EPSILON * Math.max(1, factors.length);
    if (Math.abs(survival - .5) > uncertainty) return survival <= .5;
    exact ??= [1n, 1n];
    for (; consumed < factors.length; consumed++) {
      let [a, b] = factors[consumed].map(BigInt);
      const common = gcd(a, b); a /= common; b /= common;
      let [n, d] = exact;
      const left = gcd(a, d), right = gcd(b, n);
      a /= left; d /= left; b /= right; n /= right;
      exact = [n * a, d * b];
    }
    return 2n * exact[0] <= exact[1];
  };
}
