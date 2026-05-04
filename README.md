# dicom-model

An Nx monorepo for processing and visualizing cardiac CT scans in the browser using WebGPU.

**Note:** `public/heart_mesh.json` is gitignored due to its size. Before building the Angular app or the Docker image, you must run the CT processor at least once to generate it (see "Process a CT scan" below).

## What it does

1. **Process**: A Python script reads DICOM files from a cardiac CT scan, stacks them into a 3D volume, extracts a surface mesh using the Marching Cubes algorithm, and writes it to a JSON file.
2. **Visualize**: An Angular app loads that JSON mesh and renders it interactively in the browser using WebGPU — with mouse-controlled rotation and Phong lighting.

## Repo structure

```
dicom-model/
├── src/                          # Angular app (WebGPU renderer)
├── tools/ct-processor/           # Python DICOM → mesh pipeline
│   ├── process_ct.py             # Main processing script
│   ├── requirements.txt
│   └── sample_data/              # Place .dcm files here
├── libs/shared-types/            # Shared TypeScript types + JSON Schema
│   └── src/lib/heart-mesh.schema.json
└── public/
    └── heart_mesh.json           # Pre-processed mesh (loaded by the app)
```

## Getting started

### Prerequisites

- Node.js (for the Angular app)
- Python 3.x with a virtual environment (for the CT processor)

### Run the Angular app

```bash
npm install
npm start
```

Open `http://localhost:4200`. The app loads the pre-processed mesh from `public/heart_mesh.json`.

### Process a CT scan

Place DICOM (`.dcm`) files in `tools/ct-processor/sample_data/`, then:

```bash
cd tools/ct-processor
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
python process_ct.py
```

Output is written to `public/heart_mesh.json`. You can override paths:

```bash
python process_ct.py --input /path/to/dicoms --output /path/to/output.json
```

The script validates its output against the shared JSON Schema before writing.

### Build

```bash
npm run build
```

The Angular build depends on the CT processor via Nx — `nx build` will run the processor first if its outputs are stale.

### Test and lint

```bash
npm test
npm run lint
```

## Nx project graph

Nx sees this repo as three projects:

| Project | Type | Location |
|---|---|---|
| `dicom-model` | application | `src/` |
| `ct-processor` | application | `tools/ct-processor/` |
| `shared-types` | library | `libs/shared-types/` |

**Dependency chain:**

```
dicom-model:build
  └── ct-processor:run        (must run first — produces public/heart_mesh.json)
        └── shared-types      (implicit dep — ct-processor validates against its JSON Schema)
```

`ct-processor` is tagged `lang:python` and `scope:tools` and declares `shared-types` as an `implicitDependency` (because Python can't express the link in code the way TypeScript imports can).

**Caching:** Nx caches the outputs of `build`, `test`, `lint`, and `ct-processor:run`. The processor only re-runs if its inputs change — `process_ct.py`, `requirements.txt`, the DICOM files in `sample_data/`, or the shared JSON Schema. Otherwise Nx restores `heart_mesh.json` from cache.

You can inspect the graph visually:

```bash
npx nx graph
```

Or check what Nx knows about a specific project:

```bash
npx nx show project ct-processor
npx nx show project dicom-model
```

## HU windowing

The processor extracts tissue within a Hounsfield Unit window. The defaults target soft tissue + blood:

| Target | HU min | HU max |
|---|---|---|
| Heart muscle + blood | 50 | 250 |
| Contrast-enhanced blood pool | 150 | 500 |
| Bone only | 400 | 1500 |
| Everything soft tissue | 30 | 400 |

Edit `hu_min` / `hu_max` in `process_ct.py` `main()` to change what's rendered.
