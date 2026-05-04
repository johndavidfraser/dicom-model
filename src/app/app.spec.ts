import { TestBed } from '@angular/core/testing';
import { App } from './app';
import { WebGpuRendererService } from './webgpu-renderer.service';

// Instead of faking every level of the WebGPU API (adapter,
// device, canvas context, buffers...), we replace the entire
// WebGpuRendererService with a mock. This is a common testing
// pattern: when a dependency is complex and irrelevant to what
// you're testing, replace it entirely.
//
// "What are we actually testing?" The App component's template
// renders and its basic structure works. We're NOT testing
// WebGPU rendering — that belongs in the renderer's own tests
// (and eventually E2E tests with a real browser).
//
// TestBed.overrideProvider tells Angular's dependency injection:
// "when anyone asks for WebGpuRendererService, give them this
// fake instead." The fake has the same method names but they
// do nothing. The component can call initialize() and render()
// without crashing.
const mockRenderer = {
  initialize: async () => { return; },
  render: () => { return; },
  cleanup: () => { return; },
  updateRotation: () => { return; },
};

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
    })
    .overrideProvider(WebGpuRendererService, {
      useValue: mockRenderer,
    })
    .compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it('should render title', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('h1')?.textContent).toContain('dicom-model');
  });
});