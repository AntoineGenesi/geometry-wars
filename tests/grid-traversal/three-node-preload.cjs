/**
 * three-node-preload.cjs
 *
 * CommonJS preloader that patches THREE.WebGLRenderer to avoid
 * WebGL context creation in Node.js environment (where no GPU is available).
 *
 * Load via: node --require ./three-node-preload.cjs
 *
 * This hooks into the Node.js module system BEFORE three is loaded,
 * so when SurfaceGridWalker imports THREE, it gets the patched version.
 */

const Module = require('module');
const originalLoad = Module._load;

Module._load = function (request, parent, isMain) {
  const result = originalLoad.apply(this, arguments);

  // After loading 'three', patch WebGLRenderer
  if (request === 'three' || (request.includes('three') && request.endsWith('three.module.js'))) {
    if (result && typeof result.WebGLRenderer === 'function') {
      const actual = result;

      // Replace WebGLRenderer with a mock that doesn't need a GPU
      result.WebGLRenderer = class MockWebGLRenderer {
        constructor(_opts) {
          this.domElement = {
            style: {},
            width: 800,
            height: 600,
            addEventListener: () => {},
            removeEventListener: () => {},
            remove: () => {},
            getContext: () => null,
            toDataURL: () => '',
            setAttribute: () => {},
          };
          this.toneMapping = actual.NoToneMapping;
          this.toneMappingExposure = 1.0;
          this.shadowMap = { enabled: false };
          this.outputColorSpace = actual.SRGBColorSpace;
          this.info = { render: { calls: 0, triangles: 0 } };
        }
        setSize() {}
        setPixelRatio() {}
        render() {}
        dispose() {}
        getSize(target) {
          if (target && target.set) target.set(800, 600);
          return target || new actual.Vector2(800, 600);
        }
        getPixelRatio() { return 1; }
      };
    }
  }

  return result;
};
