(function (FS) {
    'use strict';

    // ===== Canvas & Config =====
    FS.canvas = document.getElementsByTagName('canvas')[0];

    FS.config = {
        SIM_RESOLUTION: 256,
        DYE_RESOLUTION: 1024,
        CAPTURE_RESOLUTION: 512,
        DENSITY_DISSIPATION: 1,
        VELOCITY_DISSIPATION: 0.2,
        PRESSURE: 0.8,
        PRESSURE_ITERATIONS: 20,
        CURL: 30,
        SPLAT_RADIUS: 0.25,
        SPLAT_FORCE: 6000,
        SHADING: true,
        COLORFUL: true,
        COLOR_UPDATE_SPEED: 10,
        PAUSED: false,
        BACK_COLOR: { r: 0, g: 0, b: 0 },
        TRANSPARENT: false,
        BLOOM: true,
        BLOOM_ITERATIONS: 8,
        BLOOM_RESOLUTION: 256,
        BLOOM_INTENSITY: 0.8,
        BLOOM_THRESHOLD: 0.6,
        BLOOM_SOFT_KNEE: 0.7,
        SUNRAYS: true,
        SUNRAYS_RESOLUTION: 196,
        SUNRAYS_WEIGHT: 1.0,
        CAMERA_ENABLED: false,
        CAMERA_PREVIEW: true,
        CAMERA_SENSITIVITY: 1.0,
        CAMERA_SMOOTHING: 0.15,
        HAND_OPEN_THRESHOLD: 0.8,
        MEDIA_PIPE_FRAME_SKIP: 1,
        MAX_HANDS: 6,
        PERSON_DEPTH_THRESHOLD: 0.4,
        PERSON_XY_THRESHOLD: 0.8,
    };

    FS.pointers = [];
    FS.splatStack = [];

    // ===== Simple utility functions (no GL required) =====
    FS.isMobile = function () {
        return /Mobi|Android/i.test(navigator.userAgent);
    };

    FS.colorUpdateTimer = 0.0;

    FS.scaleByPixelRatio = function (input) {
        return Math.floor(input * window.devicePixelRatio);
    };

    FS.wrap = function (value, min, max) {
        var range = max - min;
        if (range === 0) return min;
        return ((value - min) % range + range) % range + min;
    };

    FS.clamp01 = function (input) {
        return Math.min(Math.max(input, 0), 1);
    };

    FS.hashCode = function (s) {
        if (s.length === 0) return 0;
        var hash = 0;
        for (var i = 0; i < s.length; i++) {
            hash = ((hash << 5) - hash) + s.charCodeAt(i);
            hash |= 0;
        }
        return hash;
    };

    FS.normalizeColor = function (input) {
        return { r: input.r / 255, g: input.g / 255, b: input.b / 255 };
    };

    FS.getResolution = function (resolution) {
        var aspectRatio = FS.gl.drawingBufferWidth / FS.gl.drawingBufferHeight;
        if (aspectRatio < 1) aspectRatio = 1 / aspectRatio;
        var min = Math.round(resolution);
        var max = Math.round(resolution * aspectRatio);
        if (FS.gl.drawingBufferWidth > FS.gl.drawingBufferHeight)
            return { width: max, height: min };
        else
            return { width: min, height: max };
    };

    FS.getTextureScale = function (texture, width, height) {
        return { x: width / texture.width, y: height / texture.height };
    };

    FS.correctDeltaX = function (delta) {
        var aspectRatio = FS.canvas.width / FS.canvas.height;
        if (aspectRatio < 1) delta *= aspectRatio;
        return delta;
    };

    FS.correctDeltaY = function (delta) {
        var aspectRatio = FS.canvas.width / FS.canvas.height;
        if (aspectRatio > 1) delta /= aspectRatio;
        return delta;
    };

    FS.correctRadius = function (radius) {
        var aspectRatio = FS.canvas.width / FS.canvas.height;
        if (aspectRatio > 1) radius *= aspectRatio;
        return radius;
    };

    // ===== WebGL initialization functions =====
    FS.getWebGLContext = function (canvas) {
        var params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false };
        var gl = canvas.getContext('webgl2', params);
        var isWebGL2 = !!gl;
        if (!isWebGL2) gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params);
        var halfFloat, supportLinearFiltering;
        var formatRGBA, formatRG, formatR;
        if (isWebGL2) {
            gl.getExtension('EXT_color_buffer_float');
            supportLinearFiltering = gl.getExtension('OES_texture_float_linear');
        } else {
            halfFloat = gl.getExtension('OES_texture_half_float');
            supportLinearFiltering = gl.getExtension('OES_texture_half_float_linear');
        }
        gl.clearColor(0, 0, 0, 1);
        var halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : halfFloat.HALF_FLOAT_OES;
        formatRGBA = FS.getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloatTexType);
        formatRG = FS.getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloatTexType);
        formatR = FS.getSupportedFormat(gl, gl.R16F, gl.RED, halfFloatTexType);
        return { gl: gl, ext: { formatRGBA: formatRGBA, formatRG: formatRG, formatR: formatR, halfFloatTexType: halfFloatTexType, supportLinearFiltering: supportLinearFiltering } };
    };

    FS.getSupportedFormat = function (gl, internalFormat, format, type) {
        if (!FS.supportRenderTextureFormat(gl, internalFormat, format, type)) {
            switch (internalFormat) {
                case gl.R16F: return FS.getSupportedFormat(gl, gl.RG16F, gl.RG, type);
                case gl.RG16F: return FS.getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
                default: return { internalFormat: gl.RGBA, format: gl.RGBA };
            }
        }
        return { internalFormat: internalFormat, format: format };
    };

    FS.supportRenderTextureFormat = function (gl, internalFormat, format, type) {
        var texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
        var fbo = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        var status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
        gl.deleteTexture(texture);
        gl.deleteFramebuffer(fbo);
        return status === gl.FRAMEBUFFER_COMPLETE;
    };

    // ===== Shader infrastructure definitions =====
    FS.compileShader = function (type, source, keywords) {
        source = FS.addKeywords(source, keywords);
        var shader = FS.gl.createShader(type);
        FS.gl.shaderSource(shader, source);
        FS.gl.compileShader(shader);
        if (!FS.gl.getShaderParameter(shader, FS.gl.COMPILE_STATUS)) {
            console.trace(FS.gl.getShaderInfoLog(shader));
        }
        return shader;
    };

    FS.addKeywords = function (source, keywords) {
        if (!keywords) return source;
        var keywordsString = '';
        keywords.forEach(function (keyword) { keywordsString += '#define ' + keyword + '\n'; });
        return keywordsString + source;
    };

    FS.createProgram = function (vertexShader, fragmentShader) {
        var program = FS.gl.createProgram();
        FS.gl.attachShader(program, vertexShader);
        FS.gl.attachShader(program, fragmentShader);
        FS.gl.linkProgram(program);
        if (!FS.gl.getProgramParameter(program, FS.gl.LINK_STATUS))
            console.trace(FS.gl.getProgramInfoLog(program));
        return program;
    };

    FS.getUniforms = function (program) {
        var uniforms = [];
        var uniformCount = FS.gl.getProgramParameter(program, FS.gl.ACTIVE_UNIFORMS);
        for (var i = 0; i < uniformCount; i++) {
            var uniform = FS.gl.getActiveUniform(program, i);
            uniforms[uniform.name] = FS.gl.getUniformLocation(program, uniform.name);
        }
        return uniforms;
    };

    // Material class
    FS.Material = class {
        constructor(vertexShader, fragmentShaderSource) {
            this.vertexShader = vertexShader;
            this.fragmentShaderSource = fragmentShaderSource;
            this.programs = [];
            this.activeProgram = null;
            this.uniforms = [];
        }
        setKeywords(keywords) {
            var hash = 0;
            for (var i = 0; i < keywords.length; i++)
                hash += FS.hashCode(keywords[i]);
            var program = this.programs[hash];
            if (!program) {
                var fragmentShader = FS.compileShader(FS.gl.FRAGMENT_SHADER, this.fragmentShaderSource, keywords);
                program = FS.createProgram(this.vertexShader, fragmentShader);
                this.programs[hash] = program;
            }
            if (program === this.activeProgram) return;
            this.uniforms = FS.getUniforms(program);
            this.activeProgram = program;
        }
        bind() {
            FS.gl.useProgram(this.activeProgram);
        }
    };

    // Program class
    FS.Program = class {
        constructor(vertexShader, fragmentShader) {
            this.uniforms = {};
            this.program = FS.createProgram(vertexShader, fragmentShader);
            this.uniforms = FS.getUniforms(this.program);
        }
        bind() {
            FS.gl.useProgram(this.program);
        }
    };

    // ===== FBO utility definitions =====
    FS.CHECK_FRAMEBUFFER_STATUS = function () {
        var status = FS.gl.checkFramebufferStatus(FS.gl.FRAMEBUFFER);
        if (status !== FS.gl.FRAMEBUFFER_COMPLETE) {
            console.trace('Framebuffer error: ' + status);
        }
    };

    FS.createFBO = function (w, h, internalFormat, format, type, param) {
        FS.gl.activeTexture(FS.gl.TEXTURE0);
        var texture = FS.gl.createTexture();
        FS.gl.bindTexture(FS.gl.TEXTURE_2D, texture);
        FS.gl.texParameteri(FS.gl.TEXTURE_2D, FS.gl.TEXTURE_MIN_FILTER, param);
        FS.gl.texParameteri(FS.gl.TEXTURE_2D, FS.gl.TEXTURE_MAG_FILTER, param);
        FS.gl.texParameteri(FS.gl.TEXTURE_2D, FS.gl.TEXTURE_WRAP_S, FS.gl.CLAMP_TO_EDGE);
        FS.gl.texParameteri(FS.gl.TEXTURE_2D, FS.gl.TEXTURE_WRAP_T, FS.gl.CLAMP_TO_EDGE);
        FS.gl.texImage2D(FS.gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
        var fbo = FS.gl.createFramebuffer();
        FS.gl.bindFramebuffer(FS.gl.FRAMEBUFFER, fbo);
        FS.gl.framebufferTexture2D(FS.gl.FRAMEBUFFER, FS.gl.COLOR_ATTACHMENT0, FS.gl.TEXTURE_2D, texture, 0);
        FS.gl.viewport(0, 0, w, h);
        FS.gl.clear(FS.gl.COLOR_BUFFER_BIT);
        var texelSizeX = 1 / w;
        var texelSizeY = 1 / h;
        return { texture: texture, fbo: fbo, width: w, height: h, texelSizeX: texelSizeX, texelSizeY: texelSizeY, attach: function (id) { FS.gl.activeTexture(FS.gl.TEXTURE0 + id); FS.gl.bindTexture(FS.gl.TEXTURE_2D, texture); return id; } };
    };

    FS.createDoubleFBO = function (w, h, internalFormat, format, type, param) {
        var fbo1 = FS.createFBO(w, h, internalFormat, format, type, param);
        var fbo2 = FS.createFBO(w, h, internalFormat, format, type, param);
        return {
            width: w, height: h,
            texelSizeX: fbo1.texelSizeX, texelSizeY: fbo1.texelSizeY,
            get read() { return fbo1; },
            set read(value) { fbo1 = value; },
            get write() { return fbo2; },
            set write(value) { fbo2 = value; },
            swap: function () { var tmp = fbo1; fbo1 = fbo2; fbo2 = tmp; }
        };
    };

    FS.resizeFBO = function (target, w, h, internalFormat, format, type, param) {
        var newFBO = FS.createFBO(w, h, internalFormat, format, type, param);
        FS.copyProgram.bind();
        FS.gl.uniform1i(FS.copyProgram.uniforms.uTexture, target.attach(0));
        FS.blit(newFBO);
        return newFBO;
    };

    FS.resizeDoubleFBO = function (target, w, h, internalFormat, format, type, param) {
        if (target.width === w && target.height === h) return target;
        target.read = FS.resizeFBO(target.read, w, h, internalFormat, format, type, param);
        target.write = FS.createFBO(w, h, internalFormat, format, type, param);
        target.width = w;
        target.height = h;
        target.texelSizeX = 1 / w;
        target.texelSizeY = 1 / h;
        return target;
    };

    FS.createTextureAsync = function (url) {
        var texture = FS.gl.createTexture();
        FS.gl.bindTexture(FS.gl.TEXTURE_2D, texture);
        FS.gl.texParameteri(FS.gl.TEXTURE_2D, FS.gl.TEXTURE_MIN_FILTER, FS.gl.LINEAR);
        FS.gl.texParameteri(FS.gl.TEXTURE_2D, FS.gl.TEXTURE_MAG_FILTER, FS.gl.LINEAR);
        FS.gl.texParameteri(FS.gl.TEXTURE_2D, FS.gl.TEXTURE_WRAP_S, FS.gl.CLAMP_TO_EDGE);
        FS.gl.texParameteri(FS.gl.TEXTURE_2D, FS.gl.TEXTURE_WRAP_T, FS.gl.CLAMP_TO_EDGE);
        FS.gl.texImage2D(FS.gl.TEXTURE_2D, 0, FS.gl.RGBA, 1, 1, 0, FS.gl.RGBA, FS.gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
        var img = new Image();
        img.onload = function () {
            FS.gl.bindTexture(FS.gl.TEXTURE_2D, texture);
            FS.gl.texImage2D(FS.gl.TEXTURE_2D, 0, FS.gl.RGBA, FS.gl.RGBA, FS.gl.UNSIGNED_BYTE, img);
        };
        img.src = url;
        return texture;
    };

    // ===== NOW initialize WebGL context =====
    var glExt = FS.getWebGLContext(FS.canvas);
    FS.gl = glExt.gl;
    FS.ext = glExt.ext;

    // WebGL context event listeners
    FS.canvas.addEventListener('webglcontextlost', function (event) {
        event.preventDefault();
        console.warn('WebGL context lost');
        if (FS.statusIndicator) {
            FS.statusIndicator.textContent = 'WebGL context lost — recovering...';
            FS.statusIndicator.className = 'error';
            FS.statusIndicator.style.display = 'block';
        }
    });

    FS.canvas.addEventListener('webglcontextrestored', function () {
        console.log('WebGL context restored, reinitializing');
        FS.updateKeywords();
        FS.initFramebuffers();
        FS.ditheringTexture = FS.createTextureAsync('LDR_LLL1_0.png');
        if (FS.hideCameraStatus) FS.hideCameraStatus();
    });

    // Mobile/fallback adjustments
    if (FS.isMobile()) {
        FS.config.DYE_RESOLUTION = 512;
    }
    if (!FS.ext.supportLinearFiltering) {
        FS.config.DYE_RESOLUTION = 512;
        FS.config.SHADING = false;
        FS.config.BLOOM = false;
        FS.config.SUNRAYS = false;
    }

    // ===== blit function =====
    var blitInitialized = false;
    var blitVertexBuffer, blitIndexBuffer;
    FS.blit = function (target) {
        if (!blitInitialized) {
            blitVertexBuffer = FS.gl.createBuffer();
            FS.gl.bindBuffer(FS.gl.ARRAY_BUFFER, blitVertexBuffer);
            FS.gl.bufferData(FS.gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), FS.gl.STATIC_DRAW);
            blitIndexBuffer = FS.gl.createBuffer();
            FS.gl.bindBuffer(FS.gl.ELEMENT_ARRAY_BUFFER, blitIndexBuffer);
            FS.gl.bufferData(FS.gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), FS.gl.STATIC_DRAW);
            blitInitialized = true;
        }
        FS.gl.bindBuffer(FS.gl.ARRAY_BUFFER, blitVertexBuffer);
        FS.gl.vertexAttribPointer(0, 2, FS.gl.FLOAT, false, 0, 0);
        FS.gl.enableVertexAttribArray(0);
        FS.gl.bindBuffer(FS.gl.ELEMENT_ARRAY_BUFFER, blitIndexBuffer);
        if (!target) {
            FS.gl.viewport(0, 0, FS.gl.drawingBufferWidth, FS.gl.drawingBufferHeight);
            FS.gl.bindFramebuffer(FS.gl.FRAMEBUFFER, null);
        } else {
            FS.gl.viewport(0, 0, target.width, target.height);
            FS.gl.bindFramebuffer(FS.gl.FRAMEBUFFER, target.fbo);
        }
        FS.gl.drawElements(FS.gl.TRIANGLES, 6, FS.gl.UNSIGNED_SHORT, 0);
    };

    // ===== Base shaders (compiled now that FS.gl is available) =====
    FS.baseVertexShader = FS.compileShader(FS.gl.VERTEX_SHADER,
        'precision highp float;\n' +
        'attribute vec2 aPosition;\n' +
        'varying vec2 vUv;\n' +
        'varying vec2 vL;\n' +
        'varying vec2 vR;\n' +
        'varying vec2 vT;\n' +
        'varying vec2 vB;\n' +
        'uniform vec2 texelSize;\n' +
        'void main () {\n' +
        '    vUv = aPosition * 0.5 + 0.5;\n' +
        '    vL = vUv - vec2(texelSize.x, 0.0);\n' +
        '    vR = vUv + vec2(texelSize.x, 0.0);\n' +
        '    vT = vUv + vec2(0.0, texelSize.y);\n' +
        '    vB = vUv - vec2(0.0, texelSize.y);\n' +
        '    gl_Position = vec4(aPosition, 0.0, 1.0);\n' +
        '}'
    );

    FS.blurVertexShader = FS.compileShader(FS.gl.VERTEX_SHADER,
        'precision highp float;\n' +
        'attribute vec2 aPosition;\n' +
        'varying vec2 vUv;\n' +
        'varying vec2 vL;\n' +
        'varying vec2 vR;\n' +
        'uniform vec2 texelSize;\n' +
        'void main () {\n' +
        '    vUv = aPosition * 0.5 + 0.5;\n' +
        '    float offset = 1.33333333;\n' +
        '    vL = vUv - texelSize * offset;\n' +
        '    vR = vUv + texelSize * offset;\n' +
        '    gl_Position = vec4(aPosition, 0.0, 1.0);\n' +
        '}'
    );

    FS.blurShader = FS.compileShader(FS.gl.FRAGMENT_SHADER,
        'precision mediump float;\n' +
        'precision mediump sampler2D;\n' +
        'varying vec2 vUv;\n' +
        'varying vec2 vL;\n' +
        'varying vec2 vR;\n' +
        'uniform sampler2D uTexture;\n' +
        'void main () {\n' +
        '    vec4 sum = texture2D(uTexture, vUv) * 0.29411764;\n' +
        '    sum += texture2D(uTexture, vL) * 0.35294117;\n' +
        '    sum += texture2D(uTexture, vR) * 0.35294117;\n' +
        '    gl_FragColor = sum;\n' +
        '}'
    );

    FS.copyShader = FS.compileShader(FS.gl.FRAGMENT_SHADER,
        'precision mediump float;\n' +
        'precision mediump sampler2D;\n' +
        'varying highp vec2 vUv;\n' +
        'uniform sampler2D uTexture;\n' +
        'void main () {\n' +
        '    gl_FragColor = texture2D(uTexture, vUv);\n' +
        '}'
    );

    FS.clearShader = FS.compileShader(FS.gl.FRAGMENT_SHADER,
        'precision mediump float;\n' +
        'precision mediump sampler2D;\n' +
        'varying highp vec2 vUv;\n' +
        'uniform sampler2D uTexture;\n' +
        'uniform float value;\n' +
        'void main () {\n' +
        '    gl_FragColor = value * texture2D(uTexture, vUv);\n' +
        '}'
    );

    FS.colorShader = FS.compileShader(FS.gl.FRAGMENT_SHADER,
        'precision mediump float;\n' +
        'uniform vec4 color;\n' +
        'void main () {\n' +
        '    gl_FragColor = color;\n' +
        '}'
    );

    FS.checkerboardShader = FS.compileShader(FS.gl.FRAGMENT_SHADER,
        'precision highp float;\n' +
        'precision highp sampler2D;\n' +
        'varying vec2 vUv;\n' +
        'uniform sampler2D uTexture;\n' +
        'uniform float aspectRatio;\n' +
        '#define SQRT2 1.41421356\n' +
        'void main () {\n' +
        '    vec2 uv = vUv;\n' +
        '    uv.x *= aspectRatio;\n' +
        '    float size = 100.0;\n' +
        '    vec2 p = mod(uv, 1.0 / size);\n' +
        '    vec2 q = p - 0.5 / size;\n' +
        '    float c = (step(0.0, q.x * q.y) * 2.0 - 1.0);\n' +
        '    gl_FragColor = vec4(vec3(0.1 + c * 0.03), 1.0);\n' +
        '}'
    );

    // Display shader source (compiled later with keywords via Material class)
    FS.displayShaderSource =
        'precision highp float;\n' +
        'precision highp sampler2D;\n' +
        'varying vec2 vUv;\n' +
        'varying vec2 vL;\n' +
        'varying vec2 vR;\n' +
        'varying vec2 vT;\n' +
        'varying vec2 vB;\n' +
        'uniform sampler2D uTexture;\n' +
        'uniform sampler2D uBloom;\n' +
        'uniform sampler2D uSunrays;\n' +
        'uniform sampler2D uDithering;\n' +
        'uniform vec2 ditherScale;\n' +
        'uniform vec2 texelSize;\n' +
        'vec3 linearToGamma (vec3 color) {\n' +
        '    color = max(color, vec3(0));\n' +
        '    return max(1.055 * pow(color, vec3(0.416666667)) - 0.055, vec3(0));\n' +
        '}\n' +
        'void main () {\n' +
        '    vec3 c = texture2D(uTexture, vUv).rgb;\n' +
        '#ifdef SHADING\n' +
        '    vec3 r = texture2D(uTexture, vR).rgb;\n' +
        '    vec3 l = texture2D(uTexture, vL).rgb;\n' +
        '    vec3 t = texture2D(uTexture, vT).rgb;\n' +
        '    vec3 b = texture2D(uTexture, vB).rgb;\n' +
        '    float dx = length(r) - length(l);\n' +
        '    float dy = length(t) - length(b);\n' +
        '    vec3 n = normalize(vec3(dx, dy, 0.01));\n' +
        '    vec3 L = vec3(0.0, 0.0, 1.0);\n' +
        '    float diffuse = clamp(dot(n, L) + 0.7, 0.7, 1.0);\n' +
        '    c *= diffuse;\n' +
        '#endif\n' +
        '#ifdef BLOOM\n' +
        '    c = mix(c, texture2D(uBloom, vUv).rgb, 0.17);\n' +
        '#endif\n' +
        '#ifdef SUNRAYS\n' +
        '    float sunrays = texture2D(uSunrays, vUv).r;\n' +
        '    c *= sunrays;\n' +
        '#endif\n' +
        '#ifdef BLOOM\n' +
        '    c = linearToGamma(c);\n' +
        '#endif\n' +
        '    vec3 d = texture2D(uDithering, vUv * ditherScale).rgb;\n' +
        '    c += d.r / 255.0 - 0.5 / 255.0;\n' +
        '    gl_FragColor = vec4(c, 1.0);\n' +
        '}';

    // ===== Base programs =====
    FS.blurProgram = new FS.Program(FS.blurVertexShader, FS.blurShader);
    FS.copyProgram = new FS.Program(FS.baseVertexShader, FS.copyShader);
    FS.clearProgram = new FS.Program(FS.baseVertexShader, FS.clearShader);
    FS.colorProgram = new FS.Program(FS.baseVertexShader, FS.colorShader);
    FS.checkerboardProgram = new FS.Program(FS.baseVertexShader, FS.checkerboardShader);

})(window.FluidSim = window.FluidSim || {});
