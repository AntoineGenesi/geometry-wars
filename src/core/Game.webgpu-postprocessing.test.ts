import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from './Game';

const noop = () => {};
const noopEvent = (_event: string, _handler: any) => {};

if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = {
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio: 1,
    addEventListener: noopEvent,
    removeEventListener: noopEvent,
    location: { search: '', href: '' },
    navigator: { getGamepads: () => [], userAgent: '' },
    getComputedStyle: () => ({}),
    requestAnimationFrame: vi.fn(() => 0),
    cancelAnimationFrame: vi.fn(),
  };
}

if (typeof globalThis.requestAnimationFrame === 'undefined') {
  (globalThis as any).requestAnimationFrame = vi.fn(() => 0);
  (globalThis as any).cancelAnimationFrame = vi.fn();
}

if (typeof globalThis.document === 'undefined') {
  (globalThis as any).document = {
    hidden: false,
    body: {
      appendChild: noop,
      removeChild: noop,
      style: {},
      clientWidth: 800,
      clientHeight: 600,
      addEventListener: noopEvent,
      removeEventListener: noopEvent,
    },
    createElement: (tag: string) => ({
      tagName: tag.toUpperCase(),
      style: {},
      appendChild: noop,
      removeChild: noop,
      addEventListener: noopEvent,
      removeEventListener: noopEvent,
      getContext: vi.fn(() => null),
      setAttribute: noop,
      getAttribute: () => null,
    }),
    addEventListener: noopEvent,
    removeEventListener: noopEvent,
  };
}

type FakeNode = {
  r: any;
  g: any;
  b: any;
  add: ReturnType<typeof vi.fn>;
  mul: ReturnType<typeof vi.fn>;
  sub: ReturnType<typeof vi.fn>;
  dot: ReturnType<typeof vi.fn>;
  blur?: ReturnType<typeof vi.fn>;
};

let sceneTextureNode: FakeNode;
let brightColorNode: FakeNode;
let convertedBrightTextureNode: FakeNode;
let postProcessingConstructs: any[];
let convertToTextureMock: ReturnType<typeof vi.fn>;

function makeNode(options: { blur?: boolean; channelDepth?: number } = {}): FakeNode {
  const channelDepth = options.channelDepth ?? 0;
  const node: FakeNode = {
    r: null,
    g: null,
    b: null,
    add: vi.fn(() => makeNode()),
    mul: vi.fn(() => makeNode()),
    sub: vi.fn(() => makeNode()),
    dot: vi.fn(() => makeNode()),
  };
  if (channelDepth < 1) {
    node.r = makeNode({ channelDepth: channelDepth + 1 });
    node.g = makeNode({ channelDepth: channelDepth + 1 });
    node.b = makeNode({ channelDepth: channelDepth + 1 });
  }
  if (options.blur) node.blur = vi.fn(() => makeNode());
  return node;
}

vi.mock('three/webgpu', () => ({
  PostProcessing: class MockPostProcessing {
    renderer: any;
    outputNode: any;

    constructor(renderer: any, outputNode: any) {
      this.renderer = renderer;
      this.outputNode = outputNode;
      postProcessingConstructs.push(this);
    }

    render() {}
  },
  pass: vi.fn(() => ({
    getTextureNode: () => sceneTextureNode,
  })),
  float: vi.fn(() => makeNode()),
  max: vi.fn(() => makeNode()),
  add: vi.fn(() => makeNode()),
  screenUV: makeNode(),
  uniform: vi.fn((value: number) => ({ value })),
  convertToTexture: (node: any) => (convertToTextureMock as any)(node),
}));

function makeRenderer(): any {
  return {
    domElement: {
      style: {},
      addEventListener: noopEvent,
      removeEventListener: noopEvent,
    },
    setPixelRatio: vi.fn(),
    getPixelRatio: vi.fn(() => 1),
    setSize: vi.fn(),
    render: vi.fn(),
    dispose: vi.fn(),
    toneMapping: 0,
    toneMappingExposure: 1,
    info: { render: { frame: 0, calls: 0 } },
  };
}

function createWebGPUGame(): Game {
  return new Game({
    _renderer: makeRenderer(),
    _isWebGPU: true,
    _backend: 'webgpu',
    bloom: { strength: 0.7, radius: 0.5, threshold: 0.35 },
  });
}

beforeEach(() => {
  sceneTextureNode = makeNode();
  brightColorNode = makeNode();
  convertedBrightTextureNode = makeNode({ blur: true });
  sceneTextureNode.mul.mockReturnValue(brightColorNode);
  postProcessingConstructs = [];
  convertToTextureMock = vi.fn(() => convertedBrightTextureNode);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Game WebGPU post-processing setup', () => {
  it('materializes the bright-color math node before applying TSL blur', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const game = createWebGPUGame();

    await vi.waitFor(() => {
      expect(postProcessingConstructs).toHaveLength(1);
    });

    expect(convertToTextureMock).toHaveBeenCalledWith(brightColorNode);
    expect(convertedBrightTextureNode.blur).toHaveBeenCalled();
    expect(brightColorNode.blur).toBeUndefined();
    expect(warnSpy.mock.calls.flat().join(' ')).not.toContain('brightColor.blur is not a function');
    expect((game as any).webgpuPostProcessing).toBe(postProcessingConstructs[0]);

    game.setBloomSettings(1.4, 0.6);
    expect((game as any).webgpuBloomStrengthUniform.value).toBe(1.4);
    expect((game as any).webgpuBloomThresholdUniform.value).toBe(0.6);

    game.stop();
  });

  it('falls back to direct render if WebGPU post-processing setup still fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    convertToTextureMock = vi.fn(() => {
      throw new TypeError('convertToTexture failed');
    });

    const game = createWebGPUGame();

    await vi.waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        '[Game] WebGPU PostProcessing setup failed, using direct render:',
        expect.any(TypeError),
      );
    });

    expect((game as any).webgpuPostProcessing).toBeNull();
    expect((game as any).webgpuBloomStrengthUniform).toBeNull();
    expect((game as any).webgpuBloomThresholdUniform).toBeNull();

    game.stop();
  });
});
