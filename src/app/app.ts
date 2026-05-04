// Import Angular building blocks:
// - Component: the decorator that makes this class a component
// signal: creates reactive values
// - viewChild: gives us access to elements in the template
// - afterNextRender: runs code after Angular has rendered the template to the DOM

import { Component, signal, viewChild, ElementRef, afterNextRender, inject } from '@angular/core';

// Import our WebGPU renderer service

import { WebGpuRendererService } from './webgpu-renderer.service';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private renderer = inject(WebGpuRendererService);

  protected readonly title = signal('dicom-model');

  // viewChild looks into the template and finds the element
  // marked with #gpuCanvas. It returns a signal containing
  // a reference to that DOM element.
  // ElementRef<HTMLCanvasElement> tells TypeScript this is
  // specifically a canvas element.
  private canvas = viewChild<ElementRef<HTMLCanvasElement>>('gpuCanvas');

  // Track whether the user is currently dragging (mouse or touch).
  // We only rotate when dragging, not just moving.
  private isDragging = false;

  // Store the last pointer position so we can calculate
  // how far it moved between events. Used by both mouse
  // and touch handlers.
  private lastPointerX = 0;
  private lastPointerY = 0;

  constructor() {
    // afterNextRender runs once after Angular has placed our
    // template elements into the actual browser DOM.
    // We need to wait for this because the canvas element
    // doesn't exist until the template is rendered - if we
    // tried to access it immediately, it would be undefined.
    afterNextRender(() => {
      const canvasElement = this.canvas()?.nativeElement;
      if (canvasElement) {
        // CV-2: Set the canvas rendering resolution to match
        // its display size. Without this, the canvas renders
        // at its default 300x150 internal resolution and
        // stretches to fill the CSS size — making everything
        // blurry.
        //
        // devicePixelRatio accounts for high-DPI screens
        // (Retina displays, modern phones). A Retina Mac has
        // ratio 2, meaning each CSS pixel is 2 hardware pixels.
        // Multiplying by this ratio ensures crisp rendering.
        const rect = canvasElement.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvasElement.width = rect.width * dpr;
        canvasElement.height = rect.height * dpr;

        this.renderer.initialize(canvasElement);

        // ── Mouse event listeners ─────────────────────────

        // mousedown: user pressed the button - start tracking
        canvasElement.addEventListener('mousedown', (event: MouseEvent) => {
          this.onPointerStart(event.clientX, event.clientY);
        });

        // mousemove: user is moving the mouse - rotate if dragging
        canvasElement.addEventListener('mousemove', (event: MouseEvent) => {
          this.onPointerMove(event.clientX, event.clientY);
        });

        // mouseup: user released the button - stop tracking
        canvasElement.addEventListener('mouseup', () => {
          this.onPointerEnd();
        });

        // mouseleave: mouse left the canvas, stop tracking
        // so it doesn't get stuck in drag mode
        canvasElement.addEventListener('mouseleave', () => {
          this.onPointerEnd();
        });

        // ── Touch event listeners (CV-2) ──────────────────
        // Touch events mirror mouse events but read position
        // from the touches array. A single finger drag is
        // touches[0]. We call preventDefault() to stop the
        // browser from scrolling or zooming when the user
        // drags on the canvas.
        //
        // { passive: false } is required because
        // preventDefault() doesn't work on passive listeners.
        // Browsers default touch listeners to passive for
        // scroll performance, so we must explicitly opt out.

        canvasElement.addEventListener('touchstart', (event: TouchEvent) => {
          event.preventDefault();
          const touch = event.touches[0];
          this.onPointerStart(touch.clientX, touch.clientY);
        }, { passive: false });

        canvasElement.addEventListener('touchmove', (event: TouchEvent) => {
          event.preventDefault();
          const touch = event.touches[0];
          this.onPointerMove(touch.clientX, touch.clientY);
        }, { passive: false });

        canvasElement.addEventListener('touchend', () => {
          this.onPointerEnd();
        });

        canvasElement.addEventListener('touchcancel', () => {
          this.onPointerEnd();
        });
      }
    });
  }

  // ── Unified pointer handlers ──────────────────────────
  // Both mouse and touch events feed into these same methods.
  // This avoids duplicating the rotation logic — the only
  // difference between mouse and touch is how we extract
  // the x/y coordinates, which happens in the event
  // listeners above.

  // Called when the user starts a drag (mouse down or finger touch)
  private onPointerStart(x: number, y: number): void {
    this.isDragging = true;
    this.lastPointerX = x;
    this.lastPointerY = y;
  }

  // Called when the pointer moves during a drag
  private onPointerMove(x: number, y: number): void {
    if (!this.isDragging) {
      return;
    }

    // Calculate how far the pointer moved since the last event.
    // Multiply by a small factor (0.005) to convert pixel
    // distance into a reasonable rotation amount in radians.
    const deltaX = (x - this.lastPointerX) * 0.005;
    const deltaY = (y - this.lastPointerY) * 0.005;

    // Send the rotation deltas to the renderer
    this.renderer.updateRotation(deltaX, deltaY);

    // Update the stored position for the next move event
    this.lastPointerX = x;
    this.lastPointerY = y;
  }

  // Called when the user ends a drag (mouse up, finger lift, or leave)
  private onPointerEnd(): void {
    this.isDragging = false;
  }
}