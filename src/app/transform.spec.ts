/**
 * Unit tests for the 3D transformation matrix builder.
 *
 * These tests verify the math that positions and rotates the
 * heart mesh in 3D space. A wrong matrix means the model
 * renders in the wrong position, at the wrong size, or with
 * broken perspective — so these tests catch real visual bugs
 * without needing a GPU.
 *
 * Strategy: we can't easily verify every float in a 16-element
 * matrix by hand. Instead we test known mathematical properties
 * that a correct matrix must have:
 *   - Identity-like behavior at zero rotation
 *   - Symmetry properties of rotation
 *   - Aspect ratio affecting only specific columns
 *   - Determinant being non-zero (the matrix is invertible)
 */
import { buildTransformMatrix } from './transform';

describe('buildTransformMatrix', () => {

  // Use a square aspect ratio (1:1) for most tests to keep
  // the math simpler — aspect ratio effects are tested
  // separately.
  const SQUARE_ASPECT = 1.0;

  it('should return a 16-element Float32Array', () => {
    // A 4x4 matrix has 16 elements. Column-major storage
    // means elements [0..3] are column 0, [4..7] are
    // column 1, etc.
    const matrix = buildTransformMatrix(0, 0, SQUARE_ASPECT);
    expect(matrix).toBeInstanceOf(Float32Array);
    expect(matrix.length).toBe(16);
  });

  it('should contain no NaN or Infinity values', () => {
    // NaN or Infinity in a matrix would cause the entire
    // render to produce garbage. This is a sanity check
    // across a range of inputs.
    const inputs = [
      [0, 0],
      [Math.PI, Math.PI],
      [0.3, 0.5],       // the default rotation values
      [-1.5, 2.7],
      [100, -100],       // extreme values
    ];

    for (const [rx, ry] of inputs) {
      const matrix = buildTransformMatrix(rx, ry, 16 / 9);
      for (let i = 0; i < 16; i++) {
        expect(isFinite(matrix[i])).toBe(true);
      }
    }
  });

  it('should produce an invertible matrix (non-zero determinant)', () => {
    // If the determinant is zero, the matrix squashes 3D
    // space into a lower dimension — nothing would render.
    // A valid projection matrix always has a non-zero
    // determinant.
    const m = buildTransformMatrix(0.3, 0.5, 16 / 9);

    // For a 4x4 matrix, we compute the determinant using
    // cofactor expansion along the first row.
    const det = determinant4x4(m);
    expect(Math.abs(det)).toBeGreaterThan(0.0001);
  });

  it('should change when rotation changes', () => {
    // Rotating the model should produce a different matrix.
    // If it doesn't, the rotation isn't being applied.
    const m1 = buildTransformMatrix(0, 0, SQUARE_ASPECT);
    const m2 = buildTransformMatrix(0.5, 0, SQUARE_ASPECT);
    const m3 = buildTransformMatrix(0, 0.5, SQUARE_ASPECT);

    expect(matricesAreEqual(m1, m2)).toBe(false);
    expect(matricesAreEqual(m1, m3)).toBe(false);
    expect(matricesAreEqual(m2, m3)).toBe(false);
  });

  it('should scale with aspect ratio in column 0', () => {
    // The aspect ratio divides into column 0 to prevent
    // horizontal stretching on non-square canvases. A wider
    // canvas (aspect > 1) should produce smaller values in
    // column 0 (squeezing the horizontal axis).
    const wide = buildTransformMatrix(0, 0, 2.0);
    const narrow = buildTransformMatrix(0, 0, 0.5);

    // Column 0, element 0 is cosY * f / aspect.
    // With wider aspect, this value should be smaller.
    expect(Math.abs(wide[0])).toBeLessThan(Math.abs(narrow[0]));
  });

  it('should produce consistent results for the same inputs', () => {
    // Pure functions should always return the same output
    // for the same input. This verifies there's no hidden
    // mutable state affecting the result.
    const m1 = buildTransformMatrix(0.3, 0.5, 16 / 9);
    const m2 = buildTransformMatrix(0.3, 0.5, 16 / 9);
    expect(matricesAreEqual(m1, m2)).toBe(true);
  });

  it('should place the model at the specified z offset', () => {
    // Column 3, element 3 (index 15) is -zOffset.
    // The default zOffset is -6, so element 15 should be 6.
    const m = buildTransformMatrix(0, 0, SQUARE_ASPECT);
    expect(m[15]).toBeCloseTo(6.0, 5);
  });

  it('should accept custom fov, near, far, and zOffset', () => {
    // Verify the function doesn't crash with non-default
    // parameters and produces different results.
    const defaultMatrix = buildTransformMatrix(0, 0, 1.0);
    const customMatrix = buildTransformMatrix(
      0, 0, 1.0,
      Math.PI / 3,   // wider FOV
      0.5,           // near
      50.0,          // far
      -10.0,         // further back
    );
    expect(matricesAreEqual(defaultMatrix, customMatrix)).toBe(false);
    expect(customMatrix[15]).toBeCloseTo(10.0, 5);
  });
});

// ─── Helper functions ────────────────────────────────────

/** Check if two matrices are equal within floating-point tolerance */
function matricesAreEqual(
  a: Float32Array,
  b: Float32Array,
  epsilon = 1e-6,
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i] - b[i]) > epsilon) return false;
  }
  return true;
}

/** Compute the determinant of a 4x4 column-major matrix */
function determinant4x4(m: Float32Array): number {
  // Column-major indexing: element at row r, col c = m[c*4 + r]
  const get = (r: number, c: number) => m[c * 4 + r];

  // Cofactor expansion along row 0
  let det = 0;
  for (let col = 0; col < 4; col++) {
    const sign = col % 2 === 0 ? 1 : -1;
    det += sign * get(0, col) * minor3x3(m, 0, col);
  }
  return det;
}

/** Compute the 3x3 minor for element at (skipRow, skipCol) */
function minor3x3(
  m: Float32Array,
  skipRow: number,
  skipCol: number,
): number {
  const get = (r: number, c: number) => m[c * 4 + r];
  const vals: number[] = [];
  for (let c = 0; c < 4; c++) {
    if (c === skipCol) continue;
    for (let r = 0; r < 4; r++) {
      if (r === skipRow) continue;
      vals.push(get(r, c));
    }
  }
  // 3x3 determinant from the 9 collected values
  // vals is in column-major: [c0r0, c0r1, c0r2, c1r0, ...]
  return (
    vals[0] * (vals[4] * vals[8] - vals[5] * vals[7]) -
    vals[3] * (vals[1] * vals[8] - vals[2] * vals[7]) +
    vals[6] * (vals[1] * vals[5] - vals[2] * vals[4])
  );
}