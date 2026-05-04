// WebGPU renderer service — updated to load and display 
// a cardiac CT mesh instead of a hardcoded cube.

import { Injectable } from '@angular/core';

import { parseHeartMesh } from 'shared-types';

import { buildTransformMatrix } from './transform';

import { prepareMeshData } from './mesh-data';

@Injectable({
  providedIn: 'root'
})
export class WebGpuRendererService {

    // These properties store references to WebGPU objects we need across methods. The '!' tells TypeScript "I know these start undefined but I'll set them before using them."
    private device!: GPUDevice;
    private context!: GPUCanvasContext;
    private pipeline!: GPURenderPipeline;

    // Vertex buffer holds our cube's geometry data on the GPU
    private vertexBuffer!: GPUBuffer;
    // Index buffer tells the GPU which vertices form each triangle
    private indexBuffer!: GPUBuffer;
    // Uniform buffer sends data that changes each frame (like rotation)
    private uniformBuffer!: GPUBuffer;
    // Bind group connects our uniform buffer to the shader
    private bindGroup!: GPUBindGroup;

    // How many indices (triangle corner references) to draw
    private indexCount = 0;
    // Rotation angles controlled by mouse input.
    // rtationX tilts the cube up/down, rotationY spins it left/right
    private rotationX = 0.3;
    private rotationY = 0.5;

    private canvasWidth = 0;
    private canvasHeight = 0;

    // The main setup method. Called once the when the component loads. 'async' means this method can use 'await' to pause and wait for things that take time (like requesting GPU access). It takes the canvas element as a parameter so it knows where to draw.

  async initialize(canvas: HTMLCanvasElement): Promise<void> {
    this.canvasWidth = canvas.width;
    this.canvasHeight = canvas.height;

    const adapter = (await navigator.gpu.requestAdapter())!;
    this.device = await adapter.requestDevice();
    this.context = canvas.getContext('webgpu')!;

    const canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: canvasFormat,
    });

    // Load the heart mesh data from our preprocessed JSON file
    await this.loadMesh();

        // Step 5: Create the shader programs and rendering pipeline.
        this.createPipeline(canvasFormat);

        // Step 6: Start the render loop.
        this.render();
    }

    // Called by the component when the mouse drags.
    // deltaX and deltaY are how far the mouse moved,
    // scaled to a rotation amount.
    updateRotation(deltaX: number, deltaY: number): void {
        this.rotationY += deltaX;
        this.rotationX += deltaY;
    }

  // Fetches the heart mesh JSON and uploads vertex/index 
  // data to the GPU
  private async loadMesh(): Promise<void> {
    console.log('Loading heart mesh...');

    const response = await fetch('/heart_mesh.json');
    const meshData = parseHeartMesh(await response.json());
    const prepared = prepareMeshData(meshData);
    this.indexCount = prepared.indices.length;

    console.log(`  Vertices: ${prepared.vertexCount}`);
    console.log(`  Triangles: ${prepared.triangleCount}`);

    // Upload vertex data to GPU
    this.vertexBuffer = this.device.createBuffer({
      size: prepared.vertexBufferSize,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Float32Array(this.vertexBuffer.getMappedRange()).set(prepared.vertices);
    this.vertexBuffer.unmap();

    // Upload index data to GPU
    this.indexBuffer = this.device.createBuffer({
      size: prepared.indexBufferSize,
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    new Uint32Array(this.indexBuffer.getMappedRange()).set(prepared.indices);
    this.indexBuffer.unmap();

    // Uniform buffer for the transform matrix (4x4 = 64 bytes)
    // plus a light direction vector (16 bytes, padded to 16-byte alignment)
    // Total: 80 bytes
    this.uniformBuffer = this.device.createBuffer({
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
  }

  private createPipeline(canvasFormat: GPUTextureFormat): void {

    // Updated shader with lighting. Instead of per-vertex colors,
    // we use surface normals to calculate how much light hits 
    // each point. This creates shading that reveals the 3D shape 
    // of the heart — brighter where the surface faces the light, 
    // darker where it faces away.
    const shaderCode = `
      struct VertexOutput {
        @builtin(position) position: vec4f,
        @location(0) normal: vec3f,
      };

      // Two uniforms now: the transform matrix and a light direction
      struct Uniforms {
        transformMatrix: mat4x4f,
        lightDirection: vec4f,
      };

      @group(0) @binding(0) var<uniform> uniforms: Uniforms;

      @vertex
      fn vertexMain(
        @location(0) position: vec3f,
        @location(1) normal: vec3f
      ) -> VertexOutput {
        var output: VertexOutput;
        output.position = uniforms.transformMatrix * vec4f(position, 1.0);
        // Transform the normal by the same rotation so lighting 
        // stays consistent as the model rotates.
        // We use mat3x3 (top-left 3x3 of the 4x4) to transform 
        // the normal without translation.
        let normalMatrix = mat3x3f(
          uniforms.transformMatrix[0].xyz,
          uniforms.transformMatrix[1].xyz,
          uniforms.transformMatrix[2].xyz
        );
        output.normal = normalize(normalMatrix * normal);
        return output;
      }

      @fragment
      fn fragmentMain(@location(0) normal: vec3f) -> @location(0) vec4f {
        // Simple directional lighting calculation.
        // dot() measures how aligned the surface normal is with 
        // the light direction. Ranges from -1 (facing away) to 
        // 1 (facing directly toward light).
        let lightDir = normalize(uniforms.lightDirection.xyz);
        let ndotl = max(dot(normalize(normal), lightDir), 0.0);

        // Ambient light (base brightness so shadows aren't pure black)
        let ambient = 0.15;
        // Diffuse light (brightness based on angle to light)
        let diffuse = ndotl * 0.85;

        // Heart tissue color — a warm reddish tone
        let baseColor = vec3f(0.8, 0.25, 0.25);
        let finalColor = baseColor * (ambient + diffuse);

        return vec4f(finalColor, 1.0);
      }
    `;

    const shaderModule = this.device.createShaderModule({
      code: shaderCode,
    });

    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [{
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' },
      }],
    });

    this.bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [{
        binding: 0,
        resource: { buffer: this.uniformBuffer },
      }],
    });

             // Finally, create the render pipeline. This bundles everything:
             // shaders, vertext data format, and output format.
             this.pipeline = this.device.createRenderPipeline({
                layout: this.device.createPipelineLayout({
                    bindGroupLayouts: [bindGroupLayout],
                }),
                vertex: {
                    module: shaderModule,
                    entryPoint: 'vertexMain',
                    // This tells the GPU how to read our vertex buffer.
                    // Each vertex is 24 bytes: 3 floats for position + 3 for color,
                    // each float is 4 bytes, so 6 x 4 = 24.
                    buffers: [{
                        arrayStride: 24,
                        attributes: [
                            // Position: starts at byte 0, is a float32x3 (vec3f)
                            { shaderLocation: 0, offset: 0, format: 'float32x3' as GPUVertexFormat },
                            // Color: starts at byte 12 (after 3 floats), is a float32x3
                            { shaderLocation: 1, offset: 12, format: 'float32x3' as GPUVertexFormat },
                        ],
                    }],
                },
                fragment: {
                    module: shaderModule,
                    entryPoint: 'fragmentMain',
                    // Output to the canvas in its preferred color format
                    targets: [{ format: canvasFormat }],
                },
                // Enable depth testing so nearer faces draw over further ones.
                // Without this, back faces could draw on top of front faces.
                depthStencil: {
                    format: 'depth24plus',
                    depthWriteEnabled: true,
                    depthCompare: 'less',
                },
             });
        }
        // Step 6: Start the render loop. Called ~60 times per second to draw each frame
        // Each frame we: update the rotation matrix, then tell the GPU to
        // draw the cube with the new rotation applied.
        private render(): void {

            // Build a 4x4 transformation matrix that combines:
            // - Rotation around the Y axis (left-right spin)
            // - Rotation around the X axis (tilt)
            // - Perspective projection (makes far things look smaller)
            // - A slight push back on the Z axis so teh cube isn't inside the camera
            const transformMatrix = buildTransformMatrix(
              this.rotationX,
              this.rotationY,
              this.canvasWidth / this.canvasHeight,
            );
          
            // Upload the transform matrix, then the light direction at byte offset 64
            this.device.queue.writeBuffer(this.uniformBuffer, 0, transformMatrix);
            // Diagonal light from upper-right-front; w=0 means direction not position
            const lightDir = new Float32Array([1.0, 1.0, 1.0, 0.0]);
            this.device.queue.writeBuffer(this.uniformBuffer, 64, lightDir);

    const depthTexture = this.device.createTexture({
      size: [this.canvasWidth, this.canvasHeight],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    const commandEncoder = this.device.createCommandEncoder();

    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: this.context.getCurrentTexture().createView(),
        clearValue: { r: 0.1, g: 0.1, b: 0.18, a: 1.0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
    });

    renderPass.setPipeline(this.pipeline);
    renderPass.setVertexBuffer(0, this.vertexBuffer);
    // Note: 'uint32' instead of 'uint16' because we have 
    // more than 65535 vertices
    renderPass.setIndexBuffer(this.indexBuffer, 'uint32');
    renderPass.setBindGroup(0, this.bindGroup);
    renderPass.drawIndexed(this.indexCount);
    renderPass.end();

    this.device.queue.submit([commandEncoder.finish()]);
    requestAnimationFrame(() => this.render());
  }
}