/**
 * Mesh data preparation — the bridge between the JSON wire
 * format and the GPU-ready typed arrays.
 *
 * This module handles the conversion from parsed HeartMesh
 * (plain number arrays from JSON) into the Float32Array and
 * Uint32Array formats that WebGPU buffers expect. It also
 * validates structural constraints that the JSON schema
 * can't express, like "vertices must be divisible by 6"
 * (because each vertex has 6 components: x, y, z, nx, ny, nz).
 *
 * Extracted from WebGpuRendererService.loadMesh() so the
 * data pipeline can be tested without a GPU.
 */
import { HeartMesh } from 'shared-types';

/**
 * GPU-ready mesh data. These typed arrays can be uploaded
 * directly into WebGPU vertex and index buffers.
 */
export interface PreparedMeshData {
  /** Interleaved vertex positions and normals as 32-bit floats */
  vertices: Float32Array<ArrayBuffer>;
  /** Triangle indices as 32-bit unsigned integers */
  indices: Uint32Array<ArrayBuffer>;
  /** Number of vertices (vertices.length / 6) */
  vertexCount: number;
  /** Number of triangles (indices.length / 3) */
  triangleCount: number;
  /** Size in bytes needed for the vertex GPU buffer */
  vertexBufferSize: number;
  /** Size in bytes needed for the index GPU buffer */
  indexBufferSize: number;
}

/**
 * Convert a validated HeartMesh into GPU-ready typed arrays.
 *
 * This function sits between parseHeartMesh (which validates
 * the JSON structure) and the GPU buffer upload (which needs
 * typed arrays with specific sizes). It catches problems that
 * the schema validator can't:
 *
 *   - Vertex count not divisible by 6 (incomplete vertex data)
 *   - Indices pointing beyond the vertex array
 *   - Empty mesh data
 *
 * @throws Error if the mesh data has structural problems
 */
export function prepareMeshData(mesh: HeartMesh): PreparedMeshData {
  // Each vertex is 6 floats: x, y, z, nx, ny, nz
  // If the array length isn't divisible by 6, we have
  // incomplete vertex data — probably a corrupt file or
  // a bug in the Python processor.
  if (mesh.vertices.length % 6 !== 0) {
    throw new Error(
      `Vertex array length ${mesh.vertices.length} is not divisible by 6. ` +
      `Each vertex requires 6 components (x, y, z, nx, ny, nz).`
    );
  }

  const vertexCount = mesh.vertices.length / 6;

  // Each triangle is 3 indices. If not divisible by 3, we
  // have incomplete triangle data.
  if (mesh.indices.length % 3 !== 0) {
    throw new Error(
      `Index array length ${mesh.indices.length} is not divisible by 3. ` +
      `Each triangle requires 3 indices.`
    );
  }

  const triangleCount = mesh.indices.length / 3;

  // Check that no index points beyond the vertex array.
  // An out-of-bounds index would cause the GPU to read
  // garbage memory, which could crash or render artifacts.
  let maxIndex = -1;
  for (const idx of mesh.indices) {
    if (idx > maxIndex) {
      maxIndex = idx;
    }
  }
  
  if (maxIndex >= vertexCount) {
    throw new Error(
      `Index ${maxIndex} exceeds vertex count ${vertexCount}. ` +
      `Indices must be in range [0, ${vertexCount - 1}].`
    );
  }

  const vertices = new Float32Array(mesh.vertices);
  const indices = new Uint32Array(mesh.indices);

  return {
    vertices,
    indices,
    vertexCount,
    triangleCount,
    vertexBufferSize: vertices.byteLength,
    indexBufferSize: indices.byteLength,
  };
}