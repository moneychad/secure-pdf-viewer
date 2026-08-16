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
            hardware: this.getHardwareInfo(),
            userAgent: navigator.userAgent
        };

        // 生成唯一指纹哈希（兼容 HTTP 环境）
        const fingerprintString = JSON.stringify(data);
        this.fingerprint = await this.simpleHash(fingerprintString);

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

    // 简单哈希函数（兼容 HTTP 环境，不依赖 crypto.subtle）
    async simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        // 转为16进制字符串，并补充更多位
        const hash1 = Math.abs(hash).toString(16).padStart(8, '0');
        
        // 使用更多数据生成第二个哈希
        let hash2 = 5381;
        for (let i = 0; i < str.length; i++) {
            hash2 = ((hash2 << 5) + hash2) + str.charCodeAt(i);
            hash2 = hash2 & hash2;
        }
        const hash2Str = Math.abs(hash2).toString(16).padStart(8, '0');
        
        return hash1 + hash2Str + this.getCanvasFingerprint().substring(0, 16);
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
            ctx.fillText('Hello, world!', 2, 15);
            ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
            ctx.fillText('Hello, world!', 4, 17);
            
            return canvas.toDataURL();
        } catch (e) {
            return 'canvas-error-' + Date.now();
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
                unmaskedRenderer: debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'unknown'
            };
        } catch (e) {
            return { supported: false, error: e.message };
        }
    }

    getScreenInfo() {
        return {
            width: window.screen.width,
            height: window.screen.height,
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
            for (let i = 0; i < Math.min(navigator.plugins.length, 5); i++) {
                plugins.push(navigator.plugins[i].name);
            }
        }
        return plugins;
    }

    getHardwareInfo() {
        return {
            cores: navigator.hardwareConcurrency || 'unknown',
            memory: navigator.deviceMemory || 'unknown',
            platform: navigator.platform || 'unknown'
        };
    }

    getFingerprint() {
        return this.fingerprint;
    }
}

// 导出
window.DeviceFingerprint = DeviceFingerprint;
