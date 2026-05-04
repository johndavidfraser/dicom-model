/**
 * 3D transformation utilities for the WebGPU renderer.
 *
 * These are pure math functions — no GPU, no DOM, no side
 * effects. They take numbers in and return Float32Arrays out,
 * which makes them easy to test and reason about.
 */

/**
 * Build a combined model-view-projection matrix.
 *
 * This single matrix combines three transformations:
 *   1. Rotation: spin the model by rotationX (tilt) and
 *      rotationY (turn) so the user can look at it from
 *      different angles
 *   2. Translation: push the model back on the Z axis so
 *      it's in front of the camera, not inside it
 *   3. Perspective projection: make far things look smaller,
 *      giving the scene a 3D appearance on a 2D screen
 *
 * The result is a 4x4 matrix stored in column-major order
 * (the format WebGPU expects). Column-major means the first
 * 4 floats are column 0, the next 4 are column 1, etc.
 *
 * @param rotationX - Tilt angle in radians (up/down)
 * @param rotationY - Turn angle in radians (left/right)
 * @param aspect    - Canvas width / height (prevents stretching)
 * @param fov       - Field of view in radians (how "wide" the lens is)
 * @param near      - Nearest visible distance (clips anything closer)
 * @param far       - Farthest visible distance (clips anything beyond)
 * @param zOffset   - How far back to push the model on the Z axis
 */
export function buildTransformMatrix(
  rotationX: number,
  rotationY: number,
  aspect: number,
  fov = Math.PI / 4,
  near = 0.1,
  far = 100.0,
  zOffset = -6.0,
): Float32Array<ArrayBuffer> {
  const f = 1.0 / Math.tan(fov / 2);
  const cosY = Math.cos(rotationY);
  const sinY = Math.sin(rotationY);
  const cosX = Math.cos(rotationX);
  const sinX = Math.sin(rotationX);
  const rangeInv = 1 / (near - far);

  return new Float32Array([
    // Column 0
    cosY * f / aspect,
    0,
    -sinY * far * rangeInv,
    sinY,

    // Column 1
    sinY * sinX * f / aspect,
    cosX * f,
    cosY * sinX * far * rangeInv,
    -cosY * sinX,

    // Column 2
    sinY * cosX * f / aspect,
    -sinX * f,
    cosY * cosX * far * rangeInv,
    -cosY * cosX,

    // Column 3
    0,
    0,
    (zOffset * far + far * near) * rangeInv,
    -zOffset,
  ]);
}