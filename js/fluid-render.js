(function (FS) {
    'use strict';

    // ===== Bloom & Sunrays shader sources =====
    const bloomPrefilterShader = FS.compileShader(FS.gl.FRAGMENT_SHADER, `
        precision mediump float;
        precision mediump sampler2D;

        varying vec2 vUv;
        uniform sampler2D uTexture;
        uniform vec3 curve;
        uniform float threshold;

        void main () {
            vec3 c = texture2D(uTexture, vUv).rgb;
            float br = max(c.r, max(c.g, c.b));
            float rq = clamp(br - curve.x, 0.0, curve.y);
            rq = curve.z * rq * rq;
            c *= max(rq, br - threshold) / max(br, 0.0001);
            gl_FragColor = vec4(c, 0.0);
        }
    `);

    const bloomBlurShader = FS.compileShader(FS.gl.FRAGMENT_SHADER, `
        precision mediump float;
        precision mediump sampler2D;

        varying vec2 vL;
        varying vec2 vR;
        varying vec2 vT;
        varying vec2 vB;
        uniform sampler2D uTexture;

        void main () {
            vec4 sum = vec4(0.0);
            sum += texture2D(uTexture, vL);
            sum += texture2D(uTexture, vR);
            sum += texture2D(uTexture, vT);
            sum += texture2D(uTexture, vB);
            sum *= 0.25;
            gl_FragColor = sum;
        }
    `);

    const bloomFinalShader = FS.compileShader(FS.gl.FRAGMENT_SHADER, `
        precision mediump float;
        precision mediump sampler2D;

        varying vec2 vL;
        varying vec2 vR;
        varying vec2 vT;
        varying vec2 vB;
        uniform sampler2D uTexture;
        uniform float intensity;

        void main () {
            vec4 sum = vec4(0.0);
            sum += texture2D(uTexture, vL);
            sum += texture2D(uTexture, vR);
            sum += texture2D(uTexture, vT);
            sum += texture2D(uTexture, vB);
            sum *= 0.25;
            gl_FragColor = sum * intensity;
        }
    `);

    const sunraysMaskShader = FS.compileShader(FS.gl.FRAGMENT_SHADER, `
        precision highp float;
        precision highp sampler2D;

        varying vec2 vUv;
        uniform sampler2D uTexture;

        void main () {
            vec4 c = texture2D(uTexture, vUv);
            float br = max(c.r, max(c.g, c.b));
            c.a = 1.0 - min(max(br * 20.0, 0.0), 0.8);
            gl_FragColor = c;
        }
    `);

    const sunraysShader = FS.compileShader(FS.gl.FRAGMENT_SHADER, `
        precision highp float;
        precision highp sampler2D;

        varying vec2 vUv;
        uniform sampler2D uTexture;
        uniform float weight;

        #define ITERATIONS 16

        void main () {
            float Density = 0.3;
            float Decay = 0.95;
            float Exposure = 0.7;

            vec2 coord = vUv;
            vec2 dir = vUv - 0.5;

            dir *= 1.0 / float(ITERATIONS) * Density;
            float illuminationDecay = 1.0;

            float color = texture2D(uTexture, vUv).a;

            for (int i = 0; i < ITERATIONS; i++)
            {
                coord -= dir;
                float col = texture2D(uTexture, coord).a;
                color += col * illuminationDecay * weight;
                illuminationDecay *= Decay;
            }

            gl_FragColor = vec4(color * Exposure, 0.0, 0.0, 1.0);
        }
    `);

    // ===== Render Program instances =====
    FS.bloomPrefilterProgram  = new FS.Program(FS.baseVertexShader, bloomPrefilterShader);
    FS.bloomBlurProgram       = new FS.Program(FS.baseVertexShader, bloomBlurShader);
    FS.bloomFinalProgram      = new FS.Program(FS.baseVertexShader, bloomFinalShader);
    FS.sunraysMaskProgram     = new FS.Program(FS.baseVertexShader, sunraysMaskShader);
    FS.sunraysProgram         = new FS.Program(FS.baseVertexShader, sunraysShader);

    FS.displayMaterial = new FS.Material(FS.baseVertexShader, FS.displayShaderSource);

    // ===== FBO variables =====
    FS.bloom = null;
    FS.bloomFramebuffers = [];
    FS.sunrays = null;
    FS.sunraysTemp = null;

    // ===== Dithering texture =====
    FS.ditheringTexture = (function () {
        var texture = FS.gl.createTexture();
        FS.gl.bindTexture(FS.gl.TEXTURE_2D, texture);
        FS.gl.texParameteri(FS.gl.TEXTURE_2D, FS.gl.TEXTURE_MIN_FILTER, FS.gl.LINEAR);
        FS.gl.texParameteri(FS.gl.TEXTURE_2D, FS.gl.TEXTURE_MAG_FILTER, FS.gl.LINEAR);
        FS.gl.texParameteri(FS.gl.TEXTURE_2D, FS.gl.TEXTURE_WRAP_S, FS.gl.REPEAT);
        FS.gl.texParameteri(FS.gl.TEXTURE_2D, FS.gl.TEXTURE_WRAP_T, FS.gl.REPEAT);
        FS.gl.texImage2D(FS.gl.TEXTURE_2D, 0, FS.gl.RGB, 1, 1, 0, FS.gl.RGB, FS.gl.UNSIGNED_BYTE,
            new Uint8Array([255, 255, 255]));

        var obj = {
            texture: texture,
            width: 1,
            height: 1,
            attach: function (id) {
                FS.gl.activeTexture(FS.gl.TEXTURE0 + id);
                FS.gl.bindTexture(FS.gl.TEXTURE_2D, texture);
                return id;
            }
        };

        var image = new Image();
        image.onload = function () {
            obj.width = image.width;
            obj.height = image.height;
            FS.gl.bindTexture(FS.gl.TEXTURE_2D, texture);
            FS.gl.texImage2D(FS.gl.TEXTURE_2D, 0, FS.gl.RGB, FS.gl.RGB, FS.gl.UNSIGNED_BYTE, image);
        };
        image.src = 'LDR_LLL1_0.png';

        return obj;
    })();

    // ===== Functions =====

    FS.initBloomFramebuffers = function () {
        var res = FS.getResolution(FS.config.BLOOM_RESOLUTION);

        var texType = FS.ext.halfFloatTexType;
        var rgba = FS.ext.formatRGBA;
        var filtering = FS.ext.supportLinearFiltering ? FS.gl.LINEAR : FS.gl.NEAREST;

        FS.bloom = FS.createFBO(res.width, res.height, rgba.internalFormat, rgba.format, texType, filtering);

        FS.bloomFramebuffers.length = 0;
        for (var i = 0; i < FS.config.BLOOM_ITERATIONS; i++)
        {
            var width = res.width >> (i + 1);
            var height = res.height >> (i + 1);

            if (width < 2 || height < 2) break;

            var fbo = FS.createFBO(width, height, rgba.internalFormat, rgba.format, texType, filtering);
            FS.bloomFramebuffers.push(fbo);
        }
    };

    FS.initSunraysFramebuffers = function () {
        var res = FS.getResolution(FS.config.SUNRAYS_RESOLUTION);

        var texType = FS.ext.halfFloatTexType;
        var r = FS.ext.formatR;
        var filtering = FS.ext.supportLinearFiltering ? FS.gl.LINEAR : FS.gl.NEAREST;

        FS.sunrays     = FS.createFBO(res.width, res.height, r.internalFormat, r.format, texType, filtering);
        FS.sunraysTemp = FS.createFBO(res.width, res.height, r.internalFormat, r.format, texType, filtering);
    };

    FS.updateKeywords = function () {
        var displayKeywords = [];
        if (FS.config.SHADING) displayKeywords.push("SHADING");
        if (FS.config.BLOOM)   displayKeywords.push("BLOOM");
        if (FS.config.SUNRAYS) displayKeywords.push("SUNRAYS");
        FS.displayMaterial.setKeywords(displayKeywords);
    };

    FS.drawColor = function (target, color) {
        FS.colorProgram.bind();
        FS.gl.uniform4f(FS.colorProgram.uniforms.color, color.r, color.g, color.b, 1);
        FS.blit(target);
    };

    FS.drawCheckerboard = function (target) {
        FS.checkerboardProgram.bind();
        FS.gl.uniform1f(FS.checkerboardProgram.uniforms.aspectRatio, FS.canvas.width / FS.canvas.height);
        FS.blit(target);
    };

    FS.drawDisplay = function (target) {
        var width = target == null ? FS.gl.drawingBufferWidth : target.width;
        var height = target == null ? FS.gl.drawingBufferHeight : target.height;

        FS.displayMaterial.bind();
        if (FS.config.SHADING)
            FS.gl.uniform2f(FS.displayMaterial.uniforms.texelSize, 1.0 / width, 1.0 / height);
        FS.gl.uniform1i(FS.displayMaterial.uniforms.uTexture, FS.dye.read.attach(0));
        if (FS.config.BLOOM)
            FS.gl.uniform1i(FS.displayMaterial.uniforms.uBloom, FS.bloom.attach(1));
        FS.gl.uniform1i(FS.displayMaterial.uniforms.uDithering, FS.ditheringTexture.attach(2));
        var scale = FS.getTextureScale(FS.ditheringTexture, width, height);
        FS.gl.uniform2f(FS.displayMaterial.uniforms.ditherScale, scale.x, scale.y);
        if (FS.config.SUNRAYS)
            FS.gl.uniform1i(FS.displayMaterial.uniforms.uSunrays, FS.sunrays.attach(3));
        FS.blit(target);
    };

    FS.applyBloom = function (source, destination) {
        if (FS.bloomFramebuffers.length < 2)
            return;

        var last = destination;

        FS.gl.disable(FS.gl.BLEND);
        FS.bloomPrefilterProgram.bind();
        var knee = FS.config.BLOOM_THRESHOLD * FS.config.BLOOM_SOFT_KNEE + 0.0001;
        var curve0 = FS.config.BLOOM_THRESHOLD - knee;
        var curve1 = knee * 2;
        var curve2 = 0.25 / knee;
        FS.gl.uniform3f(FS.bloomPrefilterProgram.uniforms.curve, curve0, curve1, curve2);
        FS.gl.uniform1f(FS.bloomPrefilterProgram.uniforms.threshold, FS.config.BLOOM_THRESHOLD);
        FS.gl.uniform1i(FS.bloomPrefilterProgram.uniforms.uTexture, source.attach(0));
        FS.blit(last);

        FS.bloomBlurProgram.bind();
        for (var i = 0; i < FS.bloomFramebuffers.length; i++) {
            var dest = FS.bloomFramebuffers[i];
            FS.gl.uniform2f(FS.bloomBlurProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
            FS.gl.uniform1i(FS.bloomBlurProgram.uniforms.uTexture, last.attach(0));
            FS.blit(dest);
            last = dest;
        }

        FS.gl.blendFunc(FS.gl.ONE, FS.gl.ONE);
        FS.gl.enable(FS.gl.BLEND);

        for (var i = FS.bloomFramebuffers.length - 2; i >= 0; i--) {
            var baseTex = FS.bloomFramebuffers[i];
            FS.gl.uniform2f(FS.bloomBlurProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
            FS.gl.uniform1i(FS.bloomBlurProgram.uniforms.uTexture, last.attach(0));
            FS.gl.viewport(0, 0, baseTex.width, baseTex.height);
            FS.blit(baseTex);
            last = baseTex;
        }

        FS.gl.disable(FS.gl.BLEND);
        FS.bloomFinalProgram.bind();
        FS.gl.uniform2f(FS.bloomFinalProgram.uniforms.texelSize, last.texelSizeX, last.texelSizeY);
        FS.gl.uniform1i(FS.bloomFinalProgram.uniforms.uTexture, last.attach(0));
        FS.gl.uniform1f(FS.bloomFinalProgram.uniforms.intensity, FS.config.BLOOM_INTENSITY);
        FS.blit(destination);
    };

    FS.applySunrays = function (source, mask, destination) {
        FS.gl.disable(FS.gl.BLEND);
        FS.sunraysMaskProgram.bind();
        FS.gl.uniform1i(FS.sunraysMaskProgram.uniforms.uTexture, source.attach(0));
        FS.blit(mask);

        FS.sunraysProgram.bind();
        FS.gl.uniform1f(FS.sunraysProgram.uniforms.weight, FS.config.SUNRAYS_WEIGHT);
        FS.gl.uniform1i(FS.sunraysProgram.uniforms.uTexture, mask.attach(0));
        FS.blit(destination);
    };

    FS.blur = function (target, temp, iterations) {
        FS.blurProgram.bind();
        for (var i = 0; i < iterations; i++) {
            FS.gl.uniform2f(FS.blurProgram.uniforms.texelSize, target.texelSizeX, 0.0);
            FS.gl.uniform1i(FS.blurProgram.uniforms.uTexture, target.attach(0));
            FS.blit(temp);

            FS.gl.uniform2f(FS.blurProgram.uniforms.texelSize, 0.0, target.texelSizeY);
            FS.gl.uniform1i(FS.blurProgram.uniforms.uTexture, temp.attach(0));
            FS.blit(target);
        }
    };

    FS.render = function (target) {
        if (FS.config.BLOOM)
            FS.applyBloom(FS.dye.read, FS.bloom);
        if (FS.config.SUNRAYS) {
            FS.applySunrays(FS.dye.read, FS.dye.write, FS.sunrays);
            FS.blur(FS.sunrays, FS.sunraysTemp, 1);
        }

        if (target == null || !FS.config.TRANSPARENT) {
            FS.gl.blendFunc(FS.gl.ONE, FS.gl.ONE_MINUS_SRC_ALPHA);
            FS.gl.enable(FS.gl.BLEND);
        }
        else {
            FS.gl.disable(FS.gl.BLEND);
        }

        if (!FS.config.TRANSPARENT)
            FS.drawColor(target, FS.normalizeColor(FS.config.BACK_COLOR));
        if (target == null && FS.config.TRANSPARENT)
            FS.drawCheckerboard(target);
        FS.drawDisplay(target);
    };

    FS.captureScreenshot = function () {
        var res = FS.getResolution(FS.config.CAPTURE_RESOLUTION);
        var target = FS.createFBO(res.width, res.height,
            FS.ext.formatRGBA.internalFormat, FS.ext.formatRGBA.format,
            FS.ext.halfFloatTexType, FS.gl.NEAREST);
        FS.render(target);

        var texture = FS.framebufferToTexture(target);
        texture = FS.normalizeTexture(texture, target.width, target.height);

        var captureCanvas = FS.textureToCanvas(texture, target.width, target.height);
        var datauri = captureCanvas.toDataURL();
        FS.downloadURI('fluid.png', datauri);
        URL.revokeObjectURL(datauri);
    };

    FS.framebufferToTexture = function (target) {
        FS.gl.bindFramebuffer(FS.gl.FRAMEBUFFER, target.fbo);
        var length = target.width * target.height * 4;
        var texture = new Float32Array(length);
        FS.gl.readPixels(0, 0, target.width, target.height, FS.gl.RGBA, FS.gl.FLOAT, texture);
        return texture;
    };

    FS.normalizeTexture = function (texture, width, height) {
        var result = new Uint8Array(texture.length);
        var id = 0;
        for (var i = height - 1; i >= 0; i--) {
            for (var j = 0; j < width; j++) {
                var nid = i * width * 4 + j * 4;
                result[nid + 0] = FS.clamp01(texture[id + 0]) * 255;
                result[nid + 1] = FS.clamp01(texture[id + 1]) * 255;
                result[nid + 2] = FS.clamp01(texture[id + 2]) * 255;
                result[nid + 3] = FS.clamp01(texture[id + 3]) * 255;
                id += 4;
            }
        }
        return result;
    };

    FS.textureToCanvas = function (texture, width, height) {
        var captureCanvas = document.createElement('canvas');
        var ctx = captureCanvas.getContext('2d');
        captureCanvas.width = width;
        captureCanvas.height = height;

        var imageData = ctx.createImageData(width, height);
        imageData.data.set(texture);
        ctx.putImageData(imageData, 0, 0);

        return captureCanvas;
    };

    FS.downloadURI = function (filename, uri) {
        var link = document.createElement('a');
        link.download = filename;
        link.href = uri;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

})(window.FluidSim = window.FluidSim || {});
