/**
 * Unit tests for the HeartMesh parser and validator.
 *
 * These tests verify the I/O boundary validation — the code that
 * ensures untrusted data (from files, network, etc.) matches the
 * HeartMesh contract before the rest of the app trusts it.
 *
 * Testing strategy: we test parseHeartMesh() because it's the
 * public API. We don't test the Ajv internals or the schema
 * directly — if parseHeartMesh behaves correctly, those are
 * working too. This is "black box" testing: we only care about
 * inputs and outputs, not implementation details.
 */
import { parseHeartMesh } from 'shared-types';

// ─── Valid data ──────────────────────────────────────────
// A minimal valid mesh: one triangle (3 vertices, 3 indices).
// Each vertex has 6 floats: x, y, z, nx, ny, nz.
// This is the smallest possible mesh that's geometrically
// meaningful — useful as a test fixture because it's easy
// to reason about.
const VALID_MESH = {
  vertices: [
    0, 0, 0, 0, 0, 1,    // vertex 0: origin, normal pointing up
    1, 0, 0, 0, 0, 1,    // vertex 1: 1 unit along x
    0, 1, 0, 0, 0, 1,    // vertex 2: 1 unit along y
  ],
  indices: [0, 1, 2],     // one triangle using all 3 vertices
};

describe('parseHeartMesh', () => {

  // ─── Happy path ──────────────────────────────────────
  // The most important test: does valid data pass through?

  it('should accept a valid mesh and return it', () => {
    // parseHeartMesh should return the data unchanged when
    // it conforms to the schema. We check both that it
    // doesn't throw AND that the returned object matches.
    const result = parseHeartMesh(VALID_MESH);
    expect(result.vertices).toEqual(VALID_MESH.vertices);
    expect(result.indices).toEqual(VALID_MESH.indices);
  });

  it('should accept a mesh with floating-point indices', () => {
    // The schema says indices are "integer" — but JSON doesn't
    // distinguish 1 from 1.0. Ajv treats whole-number floats
    // as valid integers. This test documents that behavior
    // so we don't accidentally break it.
    const mesh = {
      vertices: VALID_MESH.vertices,
      indices: [0.0, 1.0, 2.0],
    };
    const result = parseHeartMesh(mesh);
    expect(result.indices).toEqual([0, 1, 2]);
  });

  it('should accept empty arrays', () => {
    // An empty mesh is structurally valid even if it's not
    // useful. The schema only requires the arrays to exist,
    // not to have contents. This is intentional — it allows
    // placeholder/loading states.
    const result = parseHeartMesh({ vertices: [], indices: [] });
    expect(result.vertices).toEqual([]);
    expect(result.indices).toEqual([]);
  });

  // ─── Missing fields ─────────────────────────────────
  // The schema has "required": ["vertices", "indices"].
  // These tests verify that requirement is enforced.

  it('should reject data with missing vertices', () => {
    expect(() => {
      parseHeartMesh({ indices: [0, 1, 2] });
    }).toThrow('Invalid HeartMesh data');
  });

  it('should reject data with missing indices', () => {
    expect(() => {
      parseHeartMesh({ vertices: [0, 0, 0, 0, 0, 1] });
    }).toThrow('Invalid HeartMesh data');
  });

  it('should reject an empty object', () => {
    expect(() => {
      parseHeartMesh({});
    }).toThrow('Invalid HeartMesh data');
  });

  // ─── Wrong types ────────────────────────────────────
  // The schema specifies vertices as number[] and indices
  // as integer[]. These tests verify type enforcement.

  it('should reject vertices containing strings', () => {
    expect(() => {
      parseHeartMesh({
        vertices: ['not', 'numbers'],
        indices: [0],
      });
    }).toThrow('Invalid HeartMesh data');
  });

  it('should reject negative indices', () => {
    // The schema has "minimum": 0 on indices. A negative
    // index would be meaningless (can't point to a vertex
    // before the array starts).
    expect(() => {
      parseHeartMesh({
        vertices: VALID_MESH.vertices,
        indices: [-1, 0, 1],
      });
    }).toThrow('Invalid HeartMesh data');
  });

  it('should reject fractional indices', () => {
    // Index 1.5 isn't an integer — you can't have half a
    // vertex reference. Ajv enforces "type": "integer".
    expect(() => {
      parseHeartMesh({
        vertices: VALID_MESH.vertices,
        indices: [0, 1.5, 2],
      });
    }).toThrow('Invalid HeartMesh data');
  });

  // ─── Completely wrong input types ───────────────────
  // These test the outer boundary: what happens when the
  // input isn't even an object? This matters because
  // parseHeartMesh accepts "unknown" — it could receive
  // anything from a file read or network response.

  it('should reject null', () => {
    expect(() => {
      parseHeartMesh(null);
    }).toThrow('Invalid HeartMesh data');
  });

  it('should reject a string', () => {
    expect(() => {
      parseHeartMesh('not a mesh');
    }).toThrow('Invalid HeartMesh data');
  });

  it('should reject a number', () => {
    expect(() => {
      parseHeartMesh(42);
    }).toThrow('Invalid HeartMesh data');
  });

  // ─── Extra properties ──────────────────────────────
  // The schema has "additionalProperties": false. This is
  // a deliberate design choice: if the Python processor
  // starts emitting new fields, we want to know about it
  // rather than silently ignoring them. It forces both
  // sides of the data contract to stay in sync.

  it('should reject objects with extra properties', () => {
    expect(() => {
      parseHeartMesh({
        ...VALID_MESH,
        normals: [0, 0, 1],
      });
    }).toThrow('Invalid HeartMesh data');
  });
});