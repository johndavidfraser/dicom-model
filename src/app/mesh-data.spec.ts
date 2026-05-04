/**
 * Integration tests for the mesh data pipeline.
 *
 * These tests verify the FULL data flow:
 *   raw JSON → parseHeartMesh (validate) → prepareMeshData (convert)
 *
 * Unlike the unit tests for parseHeartMesh (which test validation
 * in isolation), these tests check that valid-looking data
 * actually produces correct GPU-ready output. They catch bugs
 * at the seam between the two functions — like data that passes
 * validation but breaks during typed array conversion.
 *
 * This is what makes them "integration" tests: they exercise
 * multiple modules working together, testing the contract
 * between them rather than each one alone.
 */
import { parseHeartMesh } from 'shared-types';
import { prepareMeshData } from './mesh-data';

// ─── Test fixtures ──────────────────────────────────────
// A minimal valid mesh: one triangle, three vertices.
// Small enough to verify every value by hand.
const ONE_TRIANGLE_JSON = {
  vertices: [
    0, 0, 0,  0, 0, 1,   // vertex 0: origin, normal +Z
    1, 0, 0,  0, 0, 1,   // vertex 1: along X axis
    0, 1, 0,  0, 0, 1,   // vertex 2: along Y axis
  ],
  indices: [0, 1, 2],
};

// Two triangles sharing an edge (a quad split into triangles).
// Tests that multi-triangle meshes work correctly.
const TWO_TRIANGLES_JSON = {
  vertices: [
    0, 0, 0,  0, 0, 1,   // vertex 0
    1, 0, 0,  0, 0, 1,   // vertex 1
    1, 1, 0,  0, 0, 1,   // vertex 2
    0, 1, 0,  0, 0, 1,   // vertex 3
  ],
  indices: [0, 1, 2, 0, 2, 3],
};

describe('mesh data pipeline (parseHeartMesh → prepareMeshData)', () => {

  // ─── Full pipeline: parse then prepare ────────────────

  it('should process valid JSON through both stages', () => {
    // This is the integration: data flows through parse
    // (validation) and then prepare (conversion) just like
    // it does in the real app.
    const parsed = parseHeartMesh(ONE_TRIANGLE_JSON);
    const prepared = prepareMeshData(parsed);

    expect(prepared.vertexCount).toBe(3);
    expect(prepared.triangleCount).toBe(1);
  });

  it('should produce Float32Array vertices from parsed data', () => {
    const parsed = parseHeartMesh(ONE_TRIANGLE_JSON);
    const prepared = prepareMeshData(parsed);

    // The typed array should contain the exact same values
    // as the input, just in a GPU-friendly format.
    expect(prepared.vertices).toBeInstanceOf(Float32Array);
    expect(prepared.vertices.length).toBe(18); // 3 vertices × 6 components
    // Check the first vertex position
    expect(prepared.vertices[0]).toBe(0); // x
    expect(prepared.vertices[1]).toBe(0); // y
    expect(prepared.vertices[2]).toBe(0); // z
    // Check the first vertex normal
    expect(prepared.vertices[3]).toBe(0); // nx
    expect(prepared.vertices[4]).toBe(0); // ny
    expect(prepared.vertices[5]).toBe(1); // nz
  });

  it('should produce Uint32Array indices from parsed data', () => {
    const parsed = parseHeartMesh(ONE_TRIANGLE_JSON);
    const prepared = prepareMeshData(parsed);

    expect(prepared.indices).toBeInstanceOf(Uint32Array);
    expect(prepared.indices.length).toBe(3);
    expect(prepared.indices[0]).toBe(0);
    expect(prepared.indices[1]).toBe(1);
    expect(prepared.indices[2]).toBe(2);
  });

  it('should calculate correct buffer sizes', () => {
    const parsed = parseHeartMesh(ONE_TRIANGLE_JSON);
    const prepared = prepareMeshData(parsed);

    // Float32Array: each float is 4 bytes
    // 18 floats × 4 bytes = 72 bytes
    expect(prepared.vertexBufferSize).toBe(18 * 4);

    // Uint32Array: each uint32 is 4 bytes
    // 3 indices × 4 bytes = 12 bytes
    expect(prepared.indexBufferSize).toBe(3 * 4);
  });

  it('should handle multi-triangle meshes', () => {
    const parsed = parseHeartMesh(TWO_TRIANGLES_JSON);
    const prepared = prepareMeshData(parsed);

    expect(prepared.vertexCount).toBe(4);
    expect(prepared.triangleCount).toBe(2);
    expect(prepared.indices.length).toBe(6);
  });

  // ─── Structural validation (what the schema can't catch) ──

  it('should reject vertices not divisible by 6', () => {
    // This data passes parseHeartMesh (it's a valid array
    // of numbers) but is structurally wrong — 7 floats
    // can't form complete vertices of 6 components each.
    const badMesh = { vertices: [1, 2, 3, 4, 5, 6, 7], indices: [0] };

    expect(() => {
      prepareMeshData(badMesh);
    }).toThrow('not divisible by 6');
  });

  it('should reject indices not divisible by 3', () => {
    // Two indices can't form a complete triangle.
    const badMesh = {
      vertices: ONE_TRIANGLE_JSON.vertices,
      indices: [0, 1],
    };

    expect(() => {
      prepareMeshData(badMesh);
    }).toThrow('not divisible by 3');
  });

  it('should reject out-of-bounds indices', () => {
    // Index 5 doesn't exist when there are only 3 vertices
    // (indices 0, 1, 2). This would cause the GPU to read
    // garbage memory.
    const badMesh = {
      vertices: ONE_TRIANGLE_JSON.vertices,
      indices: [0, 1, 5],
    };

    expect(() => {
      prepareMeshData(badMesh);
    }).toThrow('exceeds vertex count');
  });

  it('should handle empty mesh data', () => {
    // Empty arrays pass both parseHeartMesh and prepareMeshData.
    // This is valid — it represents a mesh with no geometry.
    const parsed = parseHeartMesh({ vertices: [], indices: [] });
    const prepared = prepareMeshData(parsed);

    expect(prepared.vertexCount).toBe(0);
    expect(prepared.triangleCount).toBe(0);
    expect(prepared.vertexBufferSize).toBe(0);
    expect(prepared.indexBufferSize).toBe(0);
  });

  // ─── Floating-point precision ──────────────────────────

  it('should preserve floating-point precision through the pipeline', () => {
    // Real CT mesh data has precise float values. Verify
    // nothing gets rounded or truncated during conversion.
    const preciseData = {
      vertices: [
        0.123456789, -0.987654321, 3.14159265,
        0.577350269, 0.577350269, 0.577350269,
      ],
      indices: [0, 0, 0],
    };

    const parsed = parseHeartMesh(preciseData);
    const prepared = prepareMeshData(parsed);

    // Float32 has ~7 digits of precision, so we check
    // to 5 decimal places to stay within that range.
    expect(prepared.vertices[0]).toBeCloseTo(0.123456789, 5);
    expect(prepared.vertices[1]).toBeCloseTo(-0.987654321, 5);
    expect(prepared.vertices[2]).toBeCloseTo(3.14159265, 5);
  });
});