'''
CT Scan Processor
Reads DICOM files from a cardiac CT scan, stacks them
into a 3D volume, extracts a surface mesh using the 
Marching Cubes algorithm, and saves the result as a JSON file for WebGPU rendering.

target_face increases detail
sigma increases smoothing
      Target            │ hu_min │ hu_max │
  ├──────────────────────────────┼────────┼────────┤
  │ Heart muscle + blood         │ 50     │ 250    │
  ├──────────────────────────────┼────────┼────────┤
  │ Contrast-enhanced blood pool │ 150    │ 500    │
  ├──────────────────────────────┼────────┼────────┤
  │ Bone only                    │ 400    │ 1500   │
  ├──────────────────────────────┼────────┼────────┤
  │ Everything soft tissue       │ 30     │ 400 
'''

import os
import json
import numpy as np
import pydicom
from skimage import measure
import argparse
from pathlib import Path
import jsonschema 

SCRIPT_DIR = Path(__file__).parent.resolve()
DEFAULT_DICOM_DIR = SCRIPT_DIR / "sample_data"
DEFAULT_OUTPUT_FILE = SCRIPT_DIR / ".." / ".." / "public" / "heart_mesh.json"
DEFAULT_SCHEMA_FILE = SCRIPT_DIR / ".." / ".." / "libs" / "shared-types" / "src" / "lib" / "heart-mesh.schema.json"

parser = argparse.ArgumentParser(
    description="Convert DICOM CT scans to a 3D mesh JSON for WebGPU rendering"
)
parser.add_argument(
    "--input",
    type=Path,
    default=DEFAULT_DICOM_DIR,
    help=f"Path to DICOM source directory (default: {DEFAULT_DICOM_DIR})",
)
parser.add_argument(
    "--output",
    type=Path,
    default=DEFAULT_OUTPUT_FILE,
    help=f"Path for output mesh JSON (default: {DEFAULT_OUTPUT_FILE})",
)
args = parser.parse_args()

DICOM_DIR = args.input
OUTPUT_FILE = args.output


def load_dicom_volume(dicom_dir):
    '''
    Reads all DICOM files from a directory and stacks
    them into a 3D numpy array (the volume).

    Each DICOM file is one 2D slice. We sort them by their pisition in scan (ImagePositionPatient),
    then stack them to form a 3D grid of density values.
    '''

    print(f"Reading DICOM files from {dicom_dir}...")

    # read all .dcm files in the directory
    slices = []
    for filename in os.listdir(dicom_dir):
        if filename.endswith('.dcm'):
            filepath = os.path.join(dicom_dir, filename)
            # pydicom.dcmread() parses the DICOM file
            # format and gives us access to both
            # metdata and pixel data
            ds = pydicom.dcmread(filepath)
            slices.append(ds)

    print(f" Found {len(slices)} slices")

    # Sort slices by their Z position (where they 
    # are along the head-to-toe axis). This ensures
    # the volume is assembled in the correct order.
    slices.sort(key=lambda s: float(s.ImagePositionPatient[2]))

    if len(slices) > 1:
        z_positions = [float(s.ImagePositionPatient[2]) for s in slices]
        slice_spacing = abs(z_positions[1] - z_positions[0])
        pixel_spacing = slices[0].PixelSpacing
        print(f"  Pixel spacing (in-plane): {pixel_spacing[0]:.2f} x {pixel_spacing[1]:.2f} mm")
        print(f"  Slice spacing (Z): {slice_spacing:.2f} mm")
        print(f"  Ratio: {slice_spacing / float(pixel_spacing[0]):.1f}x")

    # Extract the pixel data from each slice and stack
    # into 3D array. pixel_array gives us a 2D numpy
    # array of Hounsfield Units (HU) - a standardized
    # scale where air = -1000, water = 0, bone = +1000
    # We apply RescaleSlope and RescaleIntercept to
    # convert raw pixel values to actual HU values.
    volume = []
    for s in slices:
        # Get the raw pixel data as a 2D array
        image = s.pixel_array.astype(np.float32)
        # Convert to Hounsfield Units using the DICOM
        # calibration values
        slope = float(getattr(s, 'RescaleSlope', 1))
        intercept = float(getattr(s, 'RescaleIntercept', 0))
        image = image * slope + intercept
        volume.append(image)

    # np.stack combines the list of 2D arrays into 
    # one 3D array
    volume = np.stack(volume, axis=0)
    print(f" Volume shape: {volume.shape}")
    print(f" HU range: {volume.min():.0f} to {volume.max():.0f}")

    # Extract spacing info for resampling
    pixel_spacing = slices[0].PixelSpacing
    z_positions = [float(s.ImagePositionPatient[2]) for s in slices]
    slice_spacing = abs(z_positions[1] - z_positions[0])
    
    return volume, pixel_spacing, slice_spacing

def resample_volume(volume, pixel_spacing, slice_spacing):
    """
    Resamples the 3D volume so voxels are cubic (same size in all 
    three dimensions). Without this, the Z axis is much coarser 
    than X and Y, making the mesh look like stacked layers.
    
    We use scipy's zoom function which interpolates between 
    existing slices to fill in the gaps.
    """
    from scipy import ndimage
    
    # Calculate how much to scale each axis.
    # We want all axes to match the in-plane pixel spacing.
    # Z needs to be stretched because slices are far apart.
    target_spacing = float(pixel_spacing[0])  # use in-plane spacing as target
    
    zoom_factors = [
        slice_spacing / target_spacing,   # Z: stretch to fill gaps
        1.0,                               # Y: already at target
        1.0,                               # X: already at target
    ]
    
    print(f"Resampling volume...")
    print(f"  Zoom factors: Z={zoom_factors[0]:.1f}x, Y={zoom_factors[1]:.1f}x, X={zoom_factors[2]:.1f}x")
    
    # ndimage.zoom resizes the array using spline interpolation.
    # order=1 means linear interpolation — fast and good enough 
    # for our purposes.
    resampled = ndimage.zoom(volume, zoom_factors, order=3)
    
    print(f"  Original shape: {volume.shape}")
    print(f"  Resampled shape: {resampled.shape}")
    
    return resampled

def extract_mesh(volume, hu_min=50, hu_max=500, smoothing_sigma=1.0):
    """
    Extracts a 3D surface mesh for voxels whose HU value falls within
    [hu_min, hu_max]. This windowed approach avoids the 'body shell'
    problem: a simple lower-bound threshold captures the skin surface
    (air→tissue boundary), which creates a giant closed hull that hides
    everything inside. By also imposing an upper bound we exclude that
    outer fat/skin layer and isolate the target tissue.

    The process:
      1. Build a binary mask: 1 where HU is in range, 0 elsewhere.
      2. Smooth the mask with a Gaussian to reduce noise and jagged edges.
      3. Run Marching Cubes on the smoothed mask at level=0.5 (the midpoint
         of the 0–1 binary range), which finds the surface of the masked region.
    """
    from scipy import ndimage

    print(f"Building tissue mask for HU range [{hu_min}, {hu_max}]...")
    # Binary mask: True where the voxel is within the target HU window
    mask = ((volume >= hu_min) & (volume <= hu_max)).astype(np.float32)

    # Pad all sides with one voxel of zeros so the mask is fully enclosed
    # by empty space. Without this, marching cubes produces open edges
    # wherever the mask touches the volume boundary — holes that let you
    # see through the mesh as you rotate it.
    mask = np.pad(mask, pad_width=1, mode='constant', constant_values=0)
    print(f"  Voxels in range: {mask.sum():.0f} ({mask.mean()*100:.1f}% of volume)")

    if smoothing_sigma > 0:
        print(f"Smoothing mask with sigma={smoothing_sigma}...")
        # Smoothing the binary mask blurs the 0/1 boundary, giving
        # Marching Cubes a smooth gradient to work with instead of
        # a hard step. This produces much cleaner surfaces.
        mask = ndimage.gaussian_filter(mask, sigma=smoothing_sigma)

    print(f"Extracting surface mesh...")
    vertices, faces, normals, _ = measure.marching_cubes(
        mask,
        level=0.5,   # surface sits at the midpoint of the smoothed mask
        step_size=1, # step_size=2 reduces triangle count ~4x with little quality loss
    )

    print(f"  Vertices: {len(vertices)}, Triangles: {len(faces)}")

    # Subsample to a manageable triangle count by taking every Nth face.
    # This preserves the original vertex positions and normals (no 
    # geometric simplification), which keeps the raw marching cubes
    # surface quality intact.
    target_faces = 3_500_000
    if len(faces) > target_faces:
        step = max(1, len(faces) // target_faces)
        faces = faces[::step]
        print(f"  After subsampling: {len(faces)} triangles")

        # Remove vertices that are no longer referenced by any face.
        # Without this, millions of unused vertices bloat the file.
        referenced = np.unique(faces)
        # Build a mapping from old vertex indices to new compact indices
        index_map = np.full(len(vertices), -1, dtype=np.int64)
        index_map[referenced] = np.arange(len(referenced))
        # Reindex faces and keep only referenced vertices/normals
        vertices = vertices[referenced]
        normals = normals[referenced]
        faces = index_map[faces]
        print(f"  After cleanup: {len(vertices)} vertices, {len(faces)} triangles")

    return vertices, faces, normals

def center_and_scale(vertices):
    '''
    Centers the mesh at the origin and scales it
    to fit within a reasonable size for rendering.

    Without this, the mesg would be positioned at
    whatever coordinates the CT scanner used (could be hundreds of units away from origin) and might be way too large or small to see properly.
    '''
    # Move the center of the mesh to the origin (0, 0, 0)
    center = (vertices.max(axis=0) + vertices.min(axis=0)) / 2
    vertices = vertices - center

    # Scale so the largest dimension fits within [-2, 2]
    max_extent = np.abs(vertices).max()
    vertices = vertices * (2.0 / max_extent)

    return vertices

def save_mesh(vertices, faces, normals, output_path):
    '''
    
    Saves the mesg as a JSON file that our Angular app can load.
    
    The format matches what our WebGPU renderer expects: a flat list of vertex data (position + normal for each vertex) and a flat list of triangle indices.
    '''
    print(f"Saving mesh to {output_path}...")

    # Make sure the output directory exists
    os.makedirs(os.path.dirname(output_path), exist_ok=True)

    # Build the mesh data structure.
    # We flatten everything into simple lists because JSON
    # doesn't understand numpy arrays.
    mesh_data = {
        # Interleaved vertex data: [x, y, z, nx, ny, nz ...]
        # Each vertex has 6 floats: 3 for position, 3 for normal direction
        "vertices": [],
        # Triangle indices: [i0, i1, i2, i0, i2 ...]
        # Each group of 3 references vertices that form one triangle
        "indices": faces.flatten().tolist(),
    }

    # Interleave position and normal data for each vertex
    for i in range(len(vertices)):
        # position (x, y, z) then normal (nx, ny, nz) — 6 floats per vertex
        mesh_data["vertices"].extend([
            round(float(vertices[i][0]), 4),
            round(float(vertices[i][1]), 4),
            round(float(vertices[i][2]), 4),
            round(float(normals[i][0]), 4),
            round(float(normals[i][1]), 4),
            round(float(normals[i][2]), 4),
        ])
    
    # Validate against the shared schema before writing.
    # This catches any drift between the script's output and the
    # data contract that dicom-model expects.
    with open(DEFAULT_SCHEMA_FILE) as schema_file:
        schema = json.load(schema_file)
    jsonschema.validate(instance=mesh_data, schema=schema)
    
    with open(output_path, 'w') as f:
        json.dump(mesh_data, f)

    # Report the file size
    size_mb = os.path.getsize(output_path) / (1024 * 1024)
    print(f"File size: {size_mb:.1f} MB")
    print("Done")

def main():
    volume, pixel_spacing, slice_spacing = load_dicom_volume(DICOM_DIR)
    volume = resample_volume(volume, pixel_spacing, slice_spacing)
    vertices, faces, normals = extract_mesh(
        volume,
        hu_min=30,    # lower edge: excludes fat/air (below ~0 HU)
        hu_max=400,   # upper edge: excludes dense bone (above ~400 HU)
        smoothing_sigma=2.2
    )
    
    # Center and scale for rendering
    vertices = center_and_scale(vertices)
    
    # Save as JSON for the Angular app
    save_mesh(vertices, faces, normals, OUTPUT_FILE)

# This is the standard Python entry point pattern.
# It means "only run main() if this file is executed directly,
# not if it's imported by another file."
if __name__ == '__main__':
    main()
