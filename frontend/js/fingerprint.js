/**
 * 设备指纹收集器
 * 用于追踪和唯一标识访问设备
 */

class DeviceFingerprint {
    constructor() {
        this.fingerprint = null;
    }

    async collect() {
        const data = {
            canvas: this.getCanvasFingerprint(),
            webgl: this.getWebGLInfo(),
            screen: this.getScreenInfo(),
            timezone: this.getTimezone(),
            language: this.getLanguage(),
            plugins: this.getPlugins(),
            fonts: this.getFonts(),
            hardware: this.getHardwareInfo(),
            userAgent: navigator.userAgent
        };

        // 生成唯一指纹哈希
        const fingerprintString = JSON.stringify(data);
        this.fingerprint = await this.sha256(fingerprintString);

        return {
            fingerprint_hash: this.fingerprint,
            canvas_fingerprint: data.canvas,
            webgl_info: data.webgl,
            screen_info: data.screen,
            timezone: data.timezone,
            language: data.language,
            user_agent: data.userAgent
        };
    }

    getCanvasFingerprint() {
        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            
            canvas.width = 200;
            canvas.height = 50;
            
            // 绘制文本
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.fillStyle = '#f60';
            ctx.fillRect(125, 1, 62, 20);
            ctx.fillStyle = '#069';
            ctx.fillText('Hello, world! 你好世界', 2, 15);
            ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
            ctx.fillText('Hello, world! 你好世界', 4, 17);
            
            // 绘制图形
            ctx.beginPath();
            ctx.arc(50, 25, 20, 0, Math.PI * 2);
            ctx.fillStyle = 'rgb(255,0,0)';
            ctx.fill();
            
            return canvas.toDataURL();
        } catch (e) {
            return 'canvas-error';
        }
    }

    getWebGLInfo() {
        try {
            const canvas = document.createElement('canvas');
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            
            if (!gl) return { supported: false };

            const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
            
            return {
                supported: true,
                vendor: gl.getParameter(gl.VENDOR),
                renderer: gl.getParameter(gl.RENDERER),
                unmaskedVendor: debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 'unknown',
                unmaskedRenderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'unknown',
                version: gl.getParameter(gl.VERSION),
                shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
                maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
                maxViewportDims: gl.getParameter(gl.MAX_VIEWPORT_DIMS)
            };
        } catch (e) {
            return { supported: false, error: e.message };
        }
    }

    getScreenInfo() {
        return {
            width: window.screen.width,
            height: window.screen.height,
            availWidth: window.screen.availWidth,
            availHeight: window.screen.availHeight,
            colorDepth: window.screen.colorDepth,
            pixelRatio: window.devicePixelRatio || 1
        };
    }

    getTimezone() {
        try {
            return Intl.DateTimeFormat().resolvedOptions().timeZone;
        } catch (e) {
            return new Date().getTimezoneOffset().toString();
        }
    }

    getLanguage() {
        return navigator.language || navigator.userLanguage || 'unknown';
    }

    getPlugins() {
        const plugins = [];
        if (navigator.plugins) {
            for (let i = 0; i < navigator.plugins.length; i++) {
                const plugin = navigator.plugins[i];
                plugins.push({
                    name: plugin.name,
                    description: plugin.description
                });
            }
        }
        return plugins;
    }

    getFonts() {
        // 常见字体检测
        const testFonts = [
            'Arial', 'Verdana', 'Times New Roman', 'Courier New', 'Georgia',
            'Palatino', 'Garamond', 'Bookman', 'Comic Sans MS', 'Trebuchet MS',
            'Arial Black', 'Impact', 'Microsoft YaHei', 'SimSun', 'SimHei'
        ];
        
        const detectedFonts = [];
        const testString = 'mmmmmmmmmmlli';
        const testSize = '72px';
        
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        testFonts.forEach(font => {
            ctx.font = testSize + ' ' + font;
            const width = ctx.measureText(testString).width;
            if (width > 0) {
                detectedFonts.push(font);
            }
        });
        
        return detectedFonts;
    }

    getHardwareInfo() {
        return {
            cores: navigator.hardwareConcurrency || 'unknown',
            memory: navigator.deviceMemory || 'unknown',
            platform: navigator.platform || 'unknown'
        };
    }

    async sha256(message) {
        const msgBuffer = new TextEncoder().encode(message);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        return hashHex;
    }

    getFingerprint() {
        return this.fingerprint;
    }
}

// 导出
window.DeviceFingerprint = DeviceFingerprint;
