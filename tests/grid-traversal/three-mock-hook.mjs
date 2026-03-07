/**
 * three-mock-hook.mjs
 *
 * ESM preload file that sets up DOM shims and WebGL mocks BEFORE any
 * game/three.js code is imported. Used by run-full-grid-traversal.ts.
 *
 * Load via: node --import=./tests/grid-traversal/three-mock-hook.mjs
 *
 * Because this file is loaded first via --import, the globalThis.document
 * mock with the WebGL2 context is in place before three.module.js loads.
 */

const _noop = () => {};
const _noopEvent = (_e, _h) => {};

// ---------------------------------------------------------------------------
// Window mock
// ---------------------------------------------------------------------------

if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio: 1,
    addEventListener: _noopEvent,
    removeEventListener: _noopEvent,
    location: { search: '', href: '' },
    navigator: { getGamepads: () => [], userAgent: '' },
    getComputedStyle: () => ({}),
  };
}

// ---------------------------------------------------------------------------
// WebGL2 mock context
// ---------------------------------------------------------------------------

function createMockWebGL2Context() {
  const noop = () => null;
  const noopTrue = () => true;
  const noopArr = () => [];
  const noopInt = () => 0;

  return {
    canvas: { width: 800, height: 600, style: {}, addEventListener: noop, removeEventListener: noop },
    getContextAttributes: () => ({
      alpha: true, depth: true, stencil: false, antialias: false,
      premultipliedAlpha: true, preserveDrawingBuffer: false,
    }),
    getExtension: noop,
    getSupportedExtensions: noopArr,
    getParameter: (param) => {
      const p = {
        0x0D33: 4096,  // MAX_TEXTURE_SIZE
        0x8073: 16,    // MAX_RENDERBUFFER_SIZE
        0x0D54: 4,     // MAX_TEXTURE_IMAGE_UNITS
        0x8B4D: 16,    // MAX_COMBINED_TEXTURE_IMAGE_UNITS
        0x8872: 8,     // MAX_FRAGMENT_UNIFORM_VECTORS
        0x84E8: 1,     // MAX_SAMPLES
        0x8906: 4,     // MAX_DRAW_BUFFERS_WEBGL
        0x8869: 8,     // MAX_VERTEX_ATTRIBS
        0x1F00: 'Mock Renderer',
        0x1F01: 'Mock Vendor',
        0x1F02: 'WebGL 2.0',
        0x8B8C: 'highp',
      };
      return p[param] !== undefined ? p[param] : 0;
    },
    createShader: () => ({}),
    shaderSource: noop, compileShader: noop,
    getShaderParameter: (_s, p) => p === 0x8B81 ? true : null,
    getShaderInfoLog: () => '',
    deleteShader: noop,
    createProgram: () => ({}),
    attachShader: noop, linkProgram: noop,
    getProgramParameter: (_p, p) => p === 0x8B82 ? true : null,
    getProgramInfoLog: () => '',
    useProgram: noop, deleteProgram: noop,
    getUniformLocation: () => ({}),
    getAttribLocation: () => 0,
    uniform1i: noop, uniform1f: noop, uniform2f: noop, uniform3f: noop, uniform4f: noop,
    uniform1iv: noop, uniform2iv: noop, uniform3iv: noop, uniform4iv: noop,
    uniform1fv: noop, uniform2fv: noop, uniform3fv: noop, uniform4fv: noop,
    uniformMatrix2fv: noop, uniformMatrix3fv: noop, uniformMatrix4fv: noop,
    uniformMatrix3x2fv: noop, uniformMatrix4x2fv: noop, uniformMatrix2x3fv: noop,
    uniformMatrix4x3fv: noop, uniformMatrix2x4fv: noop, uniformMatrix3x4fv: noop,
    uniform1ui: noop, uniform2ui: noop, uniform3ui: noop, uniform4ui: noop,
    uniform1uiv: noop, uniform2uiv: noop, uniform3uiv: noop, uniform4uiv: noop,
    createBuffer: () => ({}),
    bindBuffer: noop, bufferData: noop, bufferSubData: noop, deleteBuffer: noop,
    getBufferParameter: noopInt,
    createVertexArray: () => ({}),
    bindVertexArray: noop, deleteVertexArray: noop,
    enableVertexAttribArray: noop, disableVertexAttribArray: noop,
    vertexAttribPointer: noop, vertexAttribIPointer: noop, vertexAttribDivisor: noop,
    createTexture: () => ({}),
    bindTexture: noop, texParameteri: noop, texParameterf: noop,
    texImage2D: noop, texImage3D: noop, texSubImage2D: noop, texSubImage3D: noop,
    compressedTexImage2D: noop, compressedTexImage3D: noop,
    generateMipmap: noop, deleteTexture: noop, activeTexture: noop,
    texStorage2D: noop, texStorage3D: noop,
    createFramebuffer: () => ({}),
    bindFramebuffer: noop, framebufferTexture2D: noop, framebufferTextureLayer: noop,
    checkFramebufferStatus: () => 0x8CD5,
    deleteFramebuffer: noop, blitFramebuffer: noop,
    invalidateFramebuffer: noop, readBuffer: noop,
    createRenderbuffer: () => ({}),
    bindRenderbuffer: noop, renderbufferStorage: noop,
    renderbufferStorageMultisample: noop,
    framebufferRenderbuffer: noop, deleteRenderbuffer: noop,
    createQuery: () => ({}),
    deleteQuery: noop, beginQuery: noop, endQuery: noop,
    getQueryParameter: (q, p) => p === 0x8867 ? true : 0,
    getQuery: () => null,
    createTransformFeedback: () => ({}),
    bindTransformFeedback: noop, beginTransformFeedback: noop,
    endTransformFeedback: noop, deleteTransformFeedback: noop,
    transformFeedbackVaryings: noop,
    createSampler: () => ({}),
    deleteSampler: noop, bindSampler: noop,
    samplerParameteri: noop, samplerParameterf: noop,
    viewport: noop, scissor: noop,
    enable: noop, disable: noop,
    blendFunc: noop, blendFuncSeparate: noop,
    blendEquation: noop, blendEquationSeparate: noop,
    colorMask: noop, depthFunc: noop, depthMask: noop, depthRange: noop,
    clearDepth: noop, clearColor: noop, clearStencil: noop, clear: noop,
    stencilFunc: noop, stencilFuncSeparate: noop,
    stencilOp: noop, stencilOpSeparate: noop,
    stencilMask: noop, stencilMaskSeparate: noop,
    polygonOffset: noop, lineWidth: noop, frontFace: noop, cullFace: noop,
    drawArrays: noop, drawElements: noop,
    drawArraysInstanced: noop, drawElementsInstanced: noop,
    finish: noop, flush: noop,
    isContextLost: () => false,
    readPixels: noop, copyTexImage2D: noop, copyTexSubImage2D: noop, copyTexSubImage3D: noop,
    pixelStorei: noop,
    fenceSync: () => ({}), deleteSync: noop,
    clientWaitSync: () => 0x911A,
    waitSync: noop, getSyncParameter: () => 0,
    getUniformBlockIndex: () => 0, uniformBlockBinding: noop,
    getActiveUniformBlockParameter: noopInt, getActiveUniformBlockName: () => '',
    getUniformIndices: () => [], getActiveUniforms: noopArr,
    drawBuffers: noop,
    getError: () => 0,

    // WebGL constants needed by Three.js
    FLOAT: 0x1406,
    UNSIGNED_BYTE: 0x1401, UNSIGNED_SHORT: 0x1403, UNSIGNED_INT: 0x1405,
    ARRAY_BUFFER: 0x8892, ELEMENT_ARRAY_BUFFER: 0x8893,
    STATIC_DRAW: 0x88B4, DYNAMIC_DRAW: 0x88E8,
    TRIANGLES: 0x0004,
    TEXTURE_2D: 0x0DE1, TEXTURE_3D: 0x806F,
    TEXTURE_CUBE_MAP: 0x8513, TEXTURE_2D_ARRAY: 0x8C1A,
    RGBA: 0x1908, RGBA8: 0x8058,
    DEPTH_COMPONENT: 0x1902, DEPTH_ATTACHMENT: 0x8D00,
    COLOR_ATTACHMENT0: 0x8CE0,
    FRAMEBUFFER: 0x8D40, READ_FRAMEBUFFER: 0x8CA8, DRAW_FRAMEBUFFER: 0x8CA9,
    RENDERBUFFER: 0x8D41,
    VERTEX_SHADER: 0x8B31, FRAGMENT_SHADER: 0x8B30,
    COMPILE_STATUS: 0x8B81, LINK_STATUS: 0x8B82,
    TEXTURE0: 0x84C0,
    CLAMP_TO_EDGE: 0x812F, REPEAT: 0x2901, MIRRORED_REPEAT: 0x8370,
    LINEAR: 0x2601, NEAREST: 0x2600,
    LINEAR_MIPMAP_LINEAR: 0x2703, NEAREST_MIPMAP_NEAREST: 0x2700,
    LINEAR_MIPMAP_NEAREST: 0x2701, NEAREST_MIPMAP_LINEAR: 0x2702,
    NO_ERROR: 0,
    LEQUAL: 0x0203, LESS: 0x0201, EQUAL: 0x0202,
    GREATER: 0x0204, NOTEQUAL: 0x0205, GEQUAL: 0x0206,
    ALWAYS: 0x0207, NEVER: 0x0200,
    ONE: 1, ZERO: 0,
    SRC_ALPHA: 0x0302, ONE_MINUS_SRC_ALPHA: 0x0303,
    DST_ALPHA: 0x0304, ONE_MINUS_DST_ALPHA: 0x0305,
    SRC_COLOR: 0x0300, ONE_MINUS_SRC_COLOR: 0x0301,
    DST_COLOR: 0x0306, ONE_MINUS_DST_COLOR: 0x0307,
    FUNC_ADD: 0x8006, FUNC_SUBTRACT: 0x800A, FUNC_REVERSE_SUBTRACT: 0x800B,
    MIN: 0x8007, MAX: 0x8008,
    FRONT: 0x0404, BACK: 0x0405, FRONT_AND_BACK: 0x0408,
    CW: 0x0900, CCW: 0x0901,
    BLEND: 0x0BE2, CULL_FACE: 0x0B44,
    DEPTH_TEST: 0x0B71, STENCIL_TEST: 0x0B90, SCISSOR_TEST: 0x0C11,
    POLYGON_OFFSET_FILL: 0x8037,
  };
}

// ---------------------------------------------------------------------------
// Document mock with WebGL2 canvas support
// ---------------------------------------------------------------------------

function createMockCanvas() {
  const mockGL = createMockWebGL2Context();
  return {
    width: 64, height: 64, style: {},
    getContext: (type) => (type === 'webgl2' || type === 'webgl') ? mockGL : null,
    addEventListener: _noopEvent, removeEventListener: _noopEvent,
    setAttribute: () => {}, toDataURL: () => '', remove: _noop,
  };
}

function createMockElement(tag) {
  if (tag === 'canvas') {
    return createMockCanvas();
  }
  return {
    style: {}, clientWidth: 800, clientHeight: 600,
    appendChild: _noop, removeChild: _noop,
    getBoundingClientRect: () => ({
      left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: _noop,
    }),
    addEventListener: _noopEvent, removeEventListener: _noopEvent,
  };
}

if (typeof globalThis.document === 'undefined') {
  globalThis.document = {
    hidden: false,
    body: {
      appendChild: _noop, removeChild: _noop, style: {},
      clientWidth: 800, clientHeight: 600,
      getBoundingClientRect: () => ({
        left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: _noop,
      }),
      addEventListener: _noopEvent, removeEventListener: _noopEvent,
    },
    createElement: (tag) => createMockElement(tag),
    createElementNS: (_ns, tag) => createMockElement(tag),
    addEventListener: _noopEvent,
    removeEventListener: _noopEvent,
  };
}

// Make window, document, navigator available as bare globals (not just globalThis.X)
// Some game code references these as bare identifiers e.g. `window.innerWidth`
// In Node, globalThis === global, so assigning to global makes them available as bare names.
global.window = globalThis.window;
global.document = globalThis.document;

if (typeof globalThis.navigator === 'undefined') {
  globalThis.navigator = { getGamepads: () => [], userAgent: '' };
}
global.navigator = globalThis.navigator;
if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 16);
}
if (typeof globalThis.cancelAnimationFrame === 'undefined') {
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}
if (typeof globalThis.HTMLElement === 'undefined') {
  globalThis.HTMLElement = class MockHTMLElement {};
}
if (typeof globalThis.URLSearchParams === 'undefined') {
  globalThis.URLSearchParams = class MockURLSearchParams {
    #params = {};
    constructor(search) {
      (search || '').replace(/^\?/, '').split('&').forEach(pair => {
        const [k, v] = pair.split('=');
        if (k) this.#params[decodeURIComponent(k)] = decodeURIComponent(v ?? '');
      });
    }
    get(key) { return this.#params[key] ?? null; }
  };
}
