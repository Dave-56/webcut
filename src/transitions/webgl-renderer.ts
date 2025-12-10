/**
 * WebGL 转场渲染器
 * 利用 GPU 加速转场效果渲染
 */

export interface TransitionShaderConfig {
  /** 顶点着色器源码 */
  vertexShader?: string;
  /** 片段着色器源码 */
  fragmentShader: string;
  /** uniform 变量配置 */
  uniforms?: Record<string, any>;
}

// 默认顶点着色器
const DEFAULT_VERTEX_SHADER = `#version 300 es
precision highp float;

in vec2 a_position;
in vec2 a_texCoord;

out vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}
`;

// 淡入淡出着色器
const FADE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_fromTexture;
uniform sampler2D u_toTexture;
uniform float u_progress;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec4 fromColor = texture(u_fromTexture, v_texCoord);
  vec4 toColor = texture(u_toTexture, v_texCoord);
  fragColor = mix(fromColor, toColor, u_progress);
}
`;

// 缩放着色器
const ZOOM_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_fromTexture;
uniform sampler2D u_toTexture;
uniform float u_progress;
uniform float u_fromScale;
uniform float u_toScale;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec2 center = vec2(0.5, 0.5);

  // 前一帧放大
  float scale1 = u_fromScale + (u_toScale - u_fromScale) * u_progress;
  vec2 fromCoord = (v_texCoord - center) / scale1 + center;

  // 后一帧从小变大
  float scale2 = mix(0.8, 1.0, u_progress);
  vec2 toCoord = (v_texCoord - center) / scale2 + center;

  vec4 fromColor = vec4(0.0);
  if (fromCoord.x >= 0.0 && fromCoord.x <= 1.0 && fromCoord.y >= 0.0 && fromCoord.y <= 1.0) {
    fromColor = texture(u_fromTexture, fromCoord);
  }

  vec4 toColor = vec4(0.0);
  if (toCoord.x >= 0.0 && toCoord.x <= 1.0 && toCoord.y >= 0.0 && toCoord.y <= 1.0) {
    toColor = texture(u_toTexture, toCoord);
  }

  fragColor = mix(fromColor, toColor, u_progress);
}
`;

// 滑动着色器（支持四个方向）
const SLIDE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_fromTexture;
uniform sampler2D u_toTexture;
uniform float u_progress;
uniform int u_direction; // 0: left, 1: right, 2: up, 3: down

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec2 fromOffset = vec2(0.0);
  vec2 toOffset = vec2(0.0);

  if (u_direction == 0) { // left
    fromOffset = vec2(-u_progress, 0.0);
    toOffset = vec2(1.0 - u_progress, 0.0);
  } else if (u_direction == 1) { // right
    fromOffset = vec2(u_progress, 0.0);
    toOffset = vec2(-(1.0 - u_progress), 0.0);
  } else if (u_direction == 2) { // up
    fromOffset = vec2(0.0, -u_progress);
    toOffset = vec2(0.0, 1.0 - u_progress);
  } else { // down
    fromOffset = vec2(0.0, u_progress);
    toOffset = vec2(0.0, -(1.0 - u_progress));
  }

  vec2 fromCoord = v_texCoord + fromOffset;
  vec2 toCoord = v_texCoord + toOffset;

  vec4 fromColor = vec4(0.0);
  if (fromCoord.x >= 0.0 && fromCoord.x <= 1.0 && fromCoord.y >= 0.0 && fromCoord.y <= 1.0) {
    fromColor = texture(u_fromTexture, fromCoord);
  }

  vec4 toColor = vec4(0.0);
  if (toCoord.x >= 0.0 && toCoord.x <= 1.0 && toCoord.y >= 0.0 && toCoord.y <= 1.0) {
    toColor = texture(u_toTexture, toCoord);
  }

  // 根据位置决定显示哪一帧
  if (u_direction == 0) { // left
    fragColor = v_texCoord.x < u_progress ? toColor : fromColor;
  } else if (u_direction == 1) { // right
    fragColor = v_texCoord.x > (1.0 - u_progress) ? toColor : fromColor;
  } else if (u_direction == 2) { // up
    fragColor = v_texCoord.y < u_progress ? toColor : fromColor;
  } else { // down
    fragColor = v_texCoord.y > (1.0 - u_progress) ? toColor : fromColor;
  }
}
`;

// 圆形扩展着色器
const CIRCLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_fromTexture;
uniform sampler2D u_toTexture;
uniform float u_progress;
uniform vec2 u_center;
uniform int u_direction; // 0: in (外向内), 1: out (内向外)

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec4 fromColor = texture(u_fromTexture, v_texCoord);
  vec4 toColor = texture(u_toTexture, v_texCoord);

  float dist = distance(v_texCoord, u_center);
  float maxDist = sqrt(2.0); // 对角线距离
  float radius = maxDist * u_progress;

  if (u_direction == 0) { // in: 从外向内，圆形区域显示 toFrame
    fragColor = dist > radius * (1.0 - u_progress) + 0.01 ? toColor : fromColor;
  } else { // out: 从内向外
    fragColor = dist < radius ? toColor : fromColor;
  }
}
`;

// 擦除着色器
const WIPE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_fromTexture;
uniform sampler2D u_toTexture;
uniform float u_progress;
uniform int u_direction; // 0: left, 1: right, 2: up, 3: down
uniform float u_softEdge;

in vec2 v_texCoord;
out vec4 fragColor;

void main() {
  vec4 fromColor = texture(u_fromTexture, v_texCoord);
  vec4 toColor = texture(u_toTexture, v_texCoord);

  float edge = 0.0;

  if (u_direction == 0) { // left
    edge = v_texCoord.x - u_progress;
  } else if (u_direction == 1) { // right
    edge = (1.0 - v_texCoord.x) - u_progress;
  } else if (u_direction == 2) { // up
    edge = v_texCoord.y - u_progress;
  } else { // down
    edge = (1.0 - v_texCoord.y) - u_progress;
  }

  if (u_softEdge > 0.0) {
    float alpha = smoothstep(-u_softEdge, u_softEdge, edge);
    fragColor = mix(toColor, fromColor, alpha);
  } else {
    fragColor = edge > 0.0 ? fromColor : toColor;
  }
}
`;

// 模糊转场着色器（简化版，使用 box blur）
const BLUR_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_fromTexture;
uniform sampler2D u_toTexture;
uniform float u_progress;
uniform float u_maxBlur;
uniform vec2 u_texelSize;

in vec2 v_texCoord;
out vec4 fragColor;

vec4 blur(sampler2D tex, vec2 coord, float blurAmount) {
  if (blurAmount <= 0.0) {
    return texture(tex, coord);
  }

  vec4 color = vec4(0.0);
  float total = 0.0;
  int samples = int(blurAmount * 2.0) + 1;

  for (int x = -samples; x <= samples; x++) {
    for (int y = -samples; y <= samples; y++) {
      vec2 offset = vec2(float(x), float(y)) * u_texelSize * blurAmount;
      color += texture(tex, coord + offset);
      total += 1.0;
    }
  }

  return color / total;
}

void main() {
  float fromBlur = u_progress * u_maxBlur;
  float toBlur = (1.0 - u_progress) * u_maxBlur;

  vec4 fromColor = blur(u_fromTexture, v_texCoord, fromBlur);
  vec4 toColor = blur(u_toTexture, v_texCoord, toBlur);

  fragColor = mix(fromColor, toColor, u_progress);
}
`;

// 溶解着色器
const DISSOLVE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_fromTexture;
uniform sampler2D u_toTexture;
uniform float u_progress;
uniform float u_blockSize;
uniform vec2 u_resolution;

in vec2 v_texCoord;
out vec4 fragColor;

// 伪随机函数
float random(vec2 st) {
  return fract(sin(dot(st.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

void main() {
  vec4 fromColor = texture(u_fromTexture, v_texCoord);
  vec4 toColor = texture(u_toTexture, v_texCoord);

  vec2 blockCoord = floor(v_texCoord * u_resolution / u_blockSize) * u_blockSize / u_resolution;
  float noise = random(blockCoord);

  float threshold = u_progress;
  fragColor = noise < threshold ? toColor : fromColor;
}
`;

// 旋转着色器
const ROTATE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

uniform sampler2D u_fromTexture;
uniform sampler2D u_toTexture;
uniform float u_progress;
uniform float u_angle;
uniform int u_clockwise;

in vec2 v_texCoord;
out vec4 fragColor;

vec2 rotateUV(vec2 uv, float angle) {
  vec2 center = vec2(0.5, 0.5);
  vec2 translated = uv - center;
  float c = cos(angle);
  float s = sin(angle);
  vec2 rotated = vec2(
    translated.x * c - translated.y * s,
    translated.x * s + translated.y * c
  );
  return rotated + center;
}

void main() {
  float direction = u_clockwise == 1 ? 1.0 : -1.0;
  float angleRad = direction * u_angle * 3.14159265 / 180.0;

  vec2 fromCoord = rotateUV(v_texCoord, angleRad * u_progress);
  vec2 toCoord = rotateUV(v_texCoord, -angleRad * (1.0 - u_progress));

  vec4 fromColor = vec4(0.0);
  if (fromCoord.x >= 0.0 && fromCoord.x <= 1.0 && fromCoord.y >= 0.0 && fromCoord.y <= 1.0) {
    fromColor = texture(u_fromTexture, fromCoord);
  }

  vec4 toColor = vec4(0.0);
  if (toCoord.x >= 0.0 && toCoord.x <= 1.0 && toCoord.y >= 0.0 && toCoord.y <= 1.0) {
    toColor = texture(u_toTexture, toCoord);
  }

  fragColor = mix(fromColor, toColor, u_progress);
}
`;

/**
 * 内置转场着色器配置
 */
export const BUILTIN_SHADERS: Record<string, TransitionShaderConfig> = {
  fade: {
    fragmentShader: FADE_FRAGMENT_SHADER,
  },
  zoom: {
    fragmentShader: ZOOM_FRAGMENT_SHADER,
    uniforms: {
      u_fromScale: 1.0,
      u_toScale: 1.2,
    },
  },
  slide: {
    fragmentShader: SLIDE_FRAGMENT_SHADER,
    uniforms: {
      u_direction: 0,
    },
  },
  circle: {
    fragmentShader: CIRCLE_FRAGMENT_SHADER,
    uniforms: {
      u_center: [0.5, 0.5],
      u_direction: 1,
    },
  },
  wipe: {
    fragmentShader: WIPE_FRAGMENT_SHADER,
    uniforms: {
      u_direction: 0,
      u_softEdge: 0.0,
    },
  },
  blur: {
    fragmentShader: BLUR_FRAGMENT_SHADER,
    uniforms: {
      u_maxBlur: 5.0,
    },
  },
  dissolve: {
    fragmentShader: DISSOLVE_FRAGMENT_SHADER,
    uniforms: {
      u_blockSize: 1.0,
    },
  },
  rotate: {
    fragmentShader: ROTATE_FRAGMENT_SHADER,
    uniforms: {
      u_angle: 180.0,
      u_clockwise: 1,
    },
  },
};

export class WebGLTransitionRenderer {
  private canvas: OffscreenCanvas;
  private gl: WebGL2RenderingContext | null = null;
  private programs: Map<string, WebGLProgram> = new Map();
  private textures: { from: WebGLTexture | null; to: WebGLTexture | null } = {
    from: null,
    to: null,
  };
  private vao: WebGLVertexArrayObject | null = null;
  private initialized: boolean = false;
  private fallbackCanvas: OffscreenCanvas;
  private fallbackCtx: OffscreenCanvasRenderingContext2D | null = null;

  constructor() {
    this.canvas = new OffscreenCanvas(1, 1);
    this.fallbackCanvas = new OffscreenCanvas(1, 1);
  }

  /**
   * 初始化 WebGL 上下文
   */
  init(): boolean {
    if (this.initialized) {
      return !!this.gl;
    }

    try {
      this.gl = this.canvas.getContext('webgl2', {
        premultipliedAlpha: false,
        preserveDrawingBuffer: true,
      });

      if (!this.gl) {
        console.warn('WebGL2 not supported, falling back to Canvas2D');
        this.fallbackCtx = this.fallbackCanvas.getContext('2d');
        this.initialized = true;
        return false;
      }

      this.setupGL();
      this.initialized = true;
      return true;
    } catch (e) {
      console.warn('WebGL initialization failed:', e);
      this.fallbackCtx = this.fallbackCanvas.getContext('2d');
      this.initialized = true;
      return false;
    }
  }

  /**
   * 设置 WebGL 基础配置
   */
  private setupGL(): void {
    const gl = this.gl!;

    // 创建顶点数组对象
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    // 创建顶点缓冲
    const positionBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    const positions = new Float32Array([
      -1, -1, 0, 1,
       1, -1, 1, 1,
      -1,  1, 0, 0,
       1,  1, 1, 0,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    // 创建纹理
    this.textures.from = gl.createTexture();
    this.textures.to = gl.createTexture();

    // 配置纹理参数
    [this.textures.from, this.textures.to].forEach((texture) => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    });
  }

  /**
   * 编译着色器程序
   */
  compileProgram(name: string, config: TransitionShaderConfig): WebGLProgram | null {
    if (!this.gl) {
      return null;
    }

    if (this.programs.has(name)) {
      return this.programs.get(name)!;
    }

    const gl = this.gl;
    const vertexShader = this.compileShader(
      gl.VERTEX_SHADER,
      config.vertexShader || DEFAULT_VERTEX_SHADER
    );
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, config.fragmentShader);

    if (!vertexShader || !fragmentShader) {
      return null;
    }

    const program = gl.createProgram()!;
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      return null;
    }

    // 设置顶点属性
    const positionLoc = gl.getAttribLocation(program, 'a_position');
    const texCoordLoc = gl.getAttribLocation(program, 'a_texCoord');

    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(texCoordLoc);
    gl.vertexAttribPointer(texCoordLoc, 2, gl.FLOAT, false, 16, 8);

    this.programs.set(name, program);
    return program;
  }

  /**
   * 编译单个着色器
   */
  private compileShader(type: number, source: string): WebGLShader | null {
    const gl = this.gl!;
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader compile error:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  /**
   * 渲染转场效果
   */
  async renderTransition(
    fromFrame: VideoFrame,
    toFrame: VideoFrame,
    progress: number,
    transitionType: string,
    config: Record<string, any> = {}
  ): Promise<VideoFrame> {
    const width = fromFrame.displayWidth;
    const height = fromFrame.displayHeight;

    // 初始化（如果尚未初始化）
    if (!this.initialized) {
      this.init();
    }

    // 如果 WebGL 不可用，使用 Canvas2D 回退
    if (!this.gl) {
      return this.fallbackRender(fromFrame, toFrame, progress);
    }

    // 获取或编译着色器程序
    const shaderConfig = BUILTIN_SHADERS[transitionType];
    if (!shaderConfig) {
      console.warn(`No WebGL shader for transition "${transitionType}", using fallback`);
      return this.fallbackRender(fromFrame, toFrame, progress);
    }

    const program = this.compileProgram(transitionType, shaderConfig);
    if (!program) {
      return this.fallbackRender(fromFrame, toFrame, progress);
    }

    const gl = this.gl;

    // 调整画布大小
    this.canvas.width = width;
    this.canvas.height = height;
    gl.viewport(0, 0, width, height);

    // 使用程序
    gl.useProgram(program);
    gl.bindVertexArray(this.vao);

    // 上传纹理
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.from);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, fromFrame);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.to);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, toFrame);

    // 设置 uniform
    gl.uniform1i(gl.getUniformLocation(program, 'u_fromTexture'), 0);
    gl.uniform1i(gl.getUniformLocation(program, 'u_toTexture'), 1);
    gl.uniform1f(gl.getUniformLocation(program, 'u_progress'), progress);

    // 设置特定转场的 uniform
    this.setTransitionUniforms(gl, program, transitionType, config, width, height);

    // 绘制
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // 创建 VideoFrame
    return new VideoFrame(this.canvas, {
      timestamp: fromFrame.timestamp,
      duration: fromFrame.duration ?? undefined,
    });
  }

  /**
   * 设置特定转场的 uniform 变量
   */
  private setTransitionUniforms(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    transitionType: string,
    config: Record<string, any>,
    width: number,
    height: number
  ): void {
    const defaults = BUILTIN_SHADERS[transitionType]?.uniforms || {};
    const merged = { ...defaults, ...config };

    switch (transitionType) {
      case 'zoom':
        gl.uniform1f(gl.getUniformLocation(program, 'u_fromScale'), merged.fromScale ?? 1.0);
        gl.uniform1f(gl.getUniformLocation(program, 'u_toScale'), merged.toScale ?? 1.2);
        break;

      case 'slide':
      case 'wipe': {
        const directionMap: Record<string, number> = { left: 0, right: 1, up: 2, down: 3 };
        gl.uniform1i(
          gl.getUniformLocation(program, 'u_direction'),
          directionMap[merged.direction] ?? 0
        );
        if (transitionType === 'wipe') {
          gl.uniform1f(gl.getUniformLocation(program, 'u_softEdge'), merged.softEdge ?? 0);
        }
        break;
      }

      case 'circle': {
        const center = merged.center || merged.u_center || [0.5, 0.5];
        gl.uniform2f(gl.getUniformLocation(program, 'u_center'), center[0], center[1]);
        const dirMap: Record<string, number> = { in: 0, out: 1 };
        gl.uniform1i(
          gl.getUniformLocation(program, 'u_direction'),
          dirMap[merged.direction] ?? 1
        );
        break;
      }

      case 'blur':
        gl.uniform1f(gl.getUniformLocation(program, 'u_maxBlur'), merged.maxBlur ?? 5.0);
        gl.uniform2f(gl.getUniformLocation(program, 'u_texelSize'), 1.0 / width, 1.0 / height);
        break;

      case 'dissolve':
        gl.uniform1f(gl.getUniformLocation(program, 'u_blockSize'), merged.blockSize ?? 1.0);
        gl.uniform2f(gl.getUniformLocation(program, 'u_resolution'), width, height);
        break;

      case 'rotate':
        gl.uniform1f(gl.getUniformLocation(program, 'u_angle'), merged.angle ?? 180);
        gl.uniform1i(gl.getUniformLocation(program, 'u_clockwise'), merged.clockwise ? 1 : 0);
        break;
    }
  }

  /**
   * Canvas2D 回退渲染
   */
  private async fallbackRender(
    fromFrame: VideoFrame,
    toFrame: VideoFrame,
    progress: number
  ): Promise<VideoFrame> {
    const width = fromFrame.displayWidth;
    const height = fromFrame.displayHeight;

    this.fallbackCanvas.width = width;
    this.fallbackCanvas.height = height;

    if (!this.fallbackCtx) {
      this.fallbackCtx = this.fallbackCanvas.getContext('2d');
    }

    const ctx = this.fallbackCtx!;

    // 简单的透明度混合
    ctx.clearRect(0, 0, width, height);
    ctx.globalAlpha = 1 - progress;
    ctx.drawImage(fromFrame, 0, 0);
    ctx.globalAlpha = progress;
    ctx.drawImage(toFrame, 0, 0);
    ctx.globalAlpha = 1;

    return new VideoFrame(this.fallbackCanvas, {
      timestamp: fromFrame.timestamp,
      duration: fromFrame.duration ?? undefined,
    });
  }

  /**
   * 检查是否支持 WebGL
   */
  isWebGLSupported(): boolean {
    if (!this.initialized) {
      this.init();
    }
    return !!this.gl;
  }

  /**
   * 注册自定义着色器
   */
  registerShader(name: string, config: TransitionShaderConfig): void {
    BUILTIN_SHADERS[name] = config;
    // 如果程序已编译，删除旧的以便重新编译
    if (this.programs.has(name)) {
      const program = this.programs.get(name)!;
      this.gl?.deleteProgram(program);
      this.programs.delete(name);
    }
  }

  /**
   * 释放资源
   */
  destroy(): void {
    if (this.gl) {
      // 删除所有程序
      for (const program of this.programs.values()) {
        this.gl.deleteProgram(program);
      }
      this.programs.clear();

      // 删除纹理
      if (this.textures.from) {
        this.gl.deleteTexture(this.textures.from);
      }
      if (this.textures.to) {
        this.gl.deleteTexture(this.textures.to);
      }

      // 删除 VAO
      if (this.vao) {
        this.gl.deleteVertexArray(this.vao);
      }
    }

    this.canvas.width = 0;
    this.canvas.height = 0;
    this.fallbackCanvas.width = 0;
    this.fallbackCanvas.height = 0;
    this.initialized = false;
  }
}

// 创建全局 WebGL 渲染器实例
export const webglRenderer = new WebGLTransitionRenderer();
