Module['WebXR'] = Module['WebXR'] || {};
Module['WebXR'].gpuDevice = null;

// Patch navigator.gpu.requestAdapter BEFORE Unity creates its device.
// This mirrors the WebGL GL.createContext xrCompatible patch, ensuring Unity's
// GPUDevice is flagged xrCompatible so XRGPUBinding can be constructed with it.
if (typeof navigator !== 'undefined' && navigator.gpu && typeof navigator.gpu.requestAdapter === 'function') {
  (function () {
    var _origRequestAdapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
    navigator.gpu.requestAdapter = function (options) {
      var xrOptions = Object.assign({}, options || {}, { xrCompatible: true });
      return _origRequestAdapter(xrOptions).then(function (adapter) {
        if (adapter) {
          var _origRequestDevice = adapter.requestDevice.bind(adapter);
          adapter.requestDevice = function (descriptor) {
            return _origRequestDevice(descriptor || {}).then(function (device) {
              if (device && !Module['WebXR'].gpuDevice) {
                Module['WebXR'].gpuDevice = device;
                console.log('[WebXR/WebGPU] Captured Unity GPUDevice (xrCompatible:true)');
                // Signal the C plugin before RegisterWebXRPlugin/UnityPluginLoad runs.
                // This is the earliest point WebGPU is confirmed; setGameModule fires too late.
                if (typeof Module.ccall === 'function') {
                  try {
                    Module.ccall('WebXRSetIsWebGPU', null, ['number'], [1]);
                    console.log('[WebXR/WebGPU] WebXRSetIsWebGPU(1) called');
                  } catch (e) {
                    console.warn('[WebXR/WebGPU] WebXRSetIsWebGPU ccall failed: ' + e);
                  }
                } else {
                  Module['WebXR']._pendingSetIsWebGPU = true;
                  console.log('[WebXR/WebGPU] Module.ccall not ready; deferred WebXRSetIsWebGPU');
                }
              }
              return device;
            });
          };
        }
        return adapter;
      });
    };
  })();
}

// Patch GPUCanvasContext.configure to add COPY_SRC usage so copyTextureToTexture
// can read from the canvas swap chain texture during the XR compositor blit.
if (typeof GPUCanvasContext !== 'undefined' && GPUCanvasContext.prototype &&
    typeof GPUCanvasContext.prototype.configure === 'function') {
  (function () {
    var _origConfigure = GPUCanvasContext.prototype.configure;
    GPUCanvasContext.prototype.configure = function (config) {
      if (config && typeof config === 'object') {
        var usage = (config.usage !== undefined) ? config.usage : GPUTextureUsage.RENDER_ATTACHMENT;
        config = Object.assign({}, config, { usage: usage | GPUTextureUsage.COPY_SRC });
      }
      return _origConfigure.call(this, config);
    };
  })();
}

setTimeout(function () {
    if (GL && GL.createContext)
    {
        GL.createContextOld = GL.createContext;
        GL.createContext = function (canvas, webGLContextAttributes)
        {
            var contextAttributes = {
                xrCompatible: true
            };

            if (webGLContextAttributes) {
                for (var attribute in webGLContextAttributes) {
                    contextAttributes[attribute] = webGLContextAttributes[attribute];
                }
            }
            
            return GL.createContextOld(canvas, contextAttributes);
        }

        const shaderBug = `#version 300 es

#define HLSLCC_ENABLE_UNIFORM_BUFFERS 1
#if HLSLCC_ENABLE_UNIFORM_BUFFERS
#define UNITY_UNIFORM
#else
#define UNITY_UNIFORM uniform
#endif
#define UNITY_SUPPORTS_UNIFORM_LOCATION 0
#if UNITY_SUPPORTS_UNIFORM_LOCATION
#define UNITY_LOCATION(x) layout(location = x)
#define UNITY_BINDING(x) layout(binding = x, std140)
#else
#define UNITY_LOCATION(x)
#define UNITY_BINDING(x) layout(std140)
#endif
uniform 	vec4 _ScaleBias;
uniform 	vec4 _ScaleBiasRt;
out highp vec2 vs_TEXCOORD0;
vec4 u_xlat0;
int u_xlati0;
uvec2 u_xlatu0;
vec4 u_xlat1;
int u_xlati4;
void main()
{
    u_xlati0 = int(uint(uint(gl_VertexID) & 1u));
    u_xlatu0.y = uint(uint(gl_VertexID) >> 1u);
    u_xlati4 = (-u_xlati0) + (-int(u_xlatu0.y));
    u_xlati0 = u_xlati0 + int(u_xlatu0.y);
    u_xlatu0.x = uint(uint(u_xlati0) & 1u);
    u_xlat1.xw = vec2(u_xlatu0.yx);
    vs_TEXCOORD0.xy = u_xlat1.xw * _ScaleBias.xy + _ScaleBias.zw;
    u_xlati0 = u_xlati4 + 1;
    u_xlatu0.x = uint(uint(u_xlati0) & 1u);
    u_xlat1.y = float(u_xlatu0.x);
    u_xlat0.xy = u_xlat1.xy * _ScaleBiasRt.xy + _ScaleBiasRt.zw;
    u_xlat0.z = float(-1.0);
    u_xlat0.w = float(1.0);
    gl_Position = u_xlat0 * vec4(2.0, -2.0, 1.0, 1.0) + vec4(-1.0, 1.0, 0.0, 0.0);
    return;
}`
        GL.getSourceOld = GL.getSource;
        // Fix for an issue of wrong values in draw display shader
        GL.getSource = function (shader, count, string, length) {
          var source = GL.getSourceOld(shader, count, string, length);
          if (shaderBug == source) {
            source = source.replace("vs_TEXCOORD0.xy = u_xlat1.xw * _ScaleBias.xy + _ScaleBias.zw;",
              "vs_TEXCOORD0.xy = u_xlat1.xw * vec2(1.0, 1.0);");
          }
          return source
        }

    }

    // dynCall fallbacks: defined outside the GL check so they work in WebGPU mode too.
    Module.dynCall_v = Module.dynCall_v || function (cb) {
      return getWasmTableEntry(cb)();
    };
    Module.dynCall_vi = Module.dynCall_vi || function (cb, arg1) {
      return getWasmTableEntry(cb)(arg1);
    };
    Module.dynCall_vii = Module.dynCall_vii || function (cb, arg1, arg2) {
      return getWasmTableEntry(cb)(arg1, arg2);
    };
    Module.dynCall_viffffffff = Module.dynCall_viffffffff || function (cb, arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9) {
      return getWasmTableEntry(cb)(arg1, arg2, arg3, arg4, arg5, arg6, arg7, arg8, arg9);
    };

    (function () {
      'use strict';
    
      function XRData() {
        this.leftViewRotation =  [0, 0, 0, 1];
        this.rightViewRotation = [0, 0, 0, 1];
        this.leftViewPosition =  [0, 0, 0];
        this.rightViewPosition = [0, 0, 0];
        this.gamepads = [];
        this.controllerA = new XRControllerData();
        this.controllerB = new XRControllerData();
        this.handLeft = new XRHandData();
        this.handRight = new XRHandData();
        this.viewerHitTestPose = new XRHitPoseData();
        this.frameNumber = 0;
        this.touchIDs = [];
        this.touches = [];
        this.eventsNamesToIDs = {};
        this.CreateTouch = function (pageElement, xPercentage, yPercentage) {
          var touchID = 0;
          while (this.touchIDs.includes(touchID))
          {
            touchID++;
          }
          var touch = new XRTouch(touchID, pageElement, xPercentage, yPercentage);
          this.touchIDs.push(touchID);
          this.touches.push(touch);
          return touch;
        }
        this.RemoveTouch = function (touch) {
          touch.ended = true;
          this.touchIDs = this.touchIDs.filter(function(item) {
            return item !== touch.identifier
          });
          this.touches = this.touches.filter(function(item) {
            return item !== touch
          });
        }
        this.SendTouchEvent = function(JSEventsObject, eventName, target, changedTouches) {
          var touchEvent = new XRTouchEvent(eventName, target, this.touches, this.touches, changedTouches);
          JSEventsObject.eventHandlers[this.eventsNamesToIDs[eventName]].eventListenerFunc(touchEvent);
        }
      }
      
      function XRControllerData() {
        this.frameIndex = 0;
        this.enabledIndex = 0;
        this.handIndex = 0;
        this.positionXIndex = 0;
        this.positionYIndex = 0;
        this.positionZIndex = 0;
        this.rotationXIndex = 0;
        this.rotationYIndex = 0;
        this.rotationZIndex = 0;
        this.rotationWIndex = 0;
        this.gripPositionXIndex = 0;
        this.gripPositionYIndex = 0;
        this.gripPositionZIndex = 0;
        this.gripRotationXIndex = 0;
        this.gripRotationYIndex = 0;
        this.gripRotationZIndex = 0;
        this.gripRotationWIndex = 0;
        this.triggerIndex = 0;
        this.squeezeIndex = 0;
        this.thumbstickIndex = 0;
        this.thumbstickXIndex = 0;
        this.thumbstickYIndex = 0;
        this.touchpadIndex = 0;
        this.touchpadXIndex = 0;
        this.touchpadYIndex = 0;
        this.buttonAIndex = 0;
        this.buttonBIndex = 0;
        this.updatedGripIndex = 0;
        this.gamepad = null;
        this.profiles = [];
        this.updatedProfiles = 0;

        this.setIndices = function(index) {
          this.frameIndex = index++;
          this.enabledIndex = index++;
          this.handIndex = index++;
          this.positionXIndex = index++;
          this.positionYIndex = index++;
          this.positionZIndex = index++;
          this.rotationXIndex = index++;
          this.rotationYIndex = index++;
          this.rotationZIndex = index++;
          this.rotationWIndex = index++;
          this.triggerIndex = index++;
          this.triggerTouchedIndex = index++;
          this.squeezeIndex = index++;
          this.squeezeTouchedIndex = index++;
          this.thumbstickIndex = index++;
          this.thumbstickTouchedIndex = index++;
          this.thumbstickXIndex = index++;
          this.thumbstickYIndex = index++;
          this.touchpadIndex = index++;
          this.touchpadTouchedIndex = index++;
          this.touchpadXIndex = index++;
          this.touchpadYIndex = index++;
          this.buttonAIndex = index++;
          this.buttonATouchedIndex = index++;
          this.buttonBIndex = index++;
          this.buttonBTouchedIndex = index++;
          this.updatedGripIndex = index++;
          this.gripPositionXIndex = index++;
          this.gripPositionYIndex = index++;
          this.gripPositionZIndex = index++;
          this.gripRotationXIndex = index++;
          this.gripRotationYIndex = index++;
          this.gripRotationZIndex = index++;
          this.gripRotationWIndex = index;
        }
      }
    
      function XRHandData() {
        this.frameIndex = 0;
        this.enabledIndex = 0;
        this.handIndex = 0;
        this.triggerIndex = 0;
        this.squeezeIndex = 0;
        this.pointerPositionXIndex = 0;
        this.pointerPositionYIndex = 0;
        this.pointerPositionZIndex = 0;
        this.pointerRotationXIndex = 0;
        this.pointerRotationYIndex = 0;
        this.pointerRotationZIndex = 0;
        this.pointerRotationWIndex = 0;
        this.jointsStartIndex = 0;
        this.poses = new Float32Array(16 * 25);
        this.radii = new Float32Array(25);
        this.jointQuaternion = new Float32Array(4);
        this.jointIndex = 0;
        this.bufferJointIndex = 0;
        this.handValuesType = 0;
        this.hasRadii = false;
        this.pinchSelectDistanceStart = 0.014;
        this.pinchSelectDistanceEnd = 0.015;
        this.pinchDistance = 1;
        this.thumbTip = 4 * 16;
        this.indexTip = 9 * 16;

        this.setIndices = function(index) {
          this.frameIndex = index++;
          this.enabledIndex = index++;
          this.handIndex = index++;
          this.triggerIndex = index++;
          this.squeezeIndex = index++;
          this.pointerPositionXIndex = index++;
          this.pointerPositionYIndex = index++;
          this.pointerPositionZIndex = index++;
          this.pointerRotationXIndex = index++;
          this.pointerRotationYIndex = index++;
          this.pointerRotationZIndex = index++;
          this.pointerRotationWIndex = index++;
          this.jointsStartIndex = index;
        }
      }
    
      function XRHitPoseData() {
        this.frameIndex = 0;
        this.availableIndex = 0;
        this.positionIndices = [0, 0, 0];
        this.rotationIndices = [0, 0, 0, 0];

        this.setIndices = function(index) {
          this.frameIndex = index++;
          this.availableIndex = index++;
          this.positionIndices[0] = index++;
          this.positionIndices[1] = index++;
          this.positionIndices[2] = index++;
          this.rotationIndices[0] = index++;
          this.rotationIndices[1] = index++;
          this.rotationIndices[2] = index++;
          this.rotationIndices[3] = index;
        }
      }
    
      function lerp(start, end, percentage)
      {
        return start + (end - start) * percentage;
      }
    
      function XRTouch(touchID, pageElement, xPercentage, yPercentage) {
        this.identifier = touchID;
        this.ended = false;
        var rect = pageElement.getBoundingClientRect();
        // It was pageElement.size / window.devicePixelRatio, but now we treat devicePixelRatio in XR session as 1
        this.clientX = lerp(rect.left, rect.left + pageElement.width / 1, xPercentage);
        this.clientY = lerp(rect.top, rect.top + pageElement.height / 1, yPercentage);
        this.layerX = this.clientX;
        this.layerY = this.clientY;
        this.offsetX = this.clientX;
        this.offsetY = this.clientY;
        this.pageX = this.clientX;
        this.pageY = this.clientY;
        this.x = this.clientX;
        this.y = this.clientY;
        this.screenX = this.clientX;
        this.screenY = this.clientY;
        this.movementX = 0; // diff between movements
        this.movementY = 0; // diff between movements
        this.UpdateTouch = function (pageElement, xPercentage, yPercentage) {
          var rect = pageElement.getBoundingClientRect();
          var newClientX = lerp(rect.left, rect.left + pageElement.width / 1, xPercentage);
          var newClientY = lerp(rect.top, rect.top + pageElement.height / 1, yPercentage);
          this.movementX = newClientX-this.clientX;
          this.movementY = newClientY-this.clientY;
          this.clientX = newClientX;
          this.clientY = newClientY;
          this.layerX = this.clientX;
          this.layerY = this.clientY;
          this.offsetX = this.clientX;
          this.offsetY = this.clientY;
          this.pageX = this.clientX;
          this.pageY = this.clientY;
          this.x = this.clientX;
          this.y = this.clientY;
          this.screenX = this.clientX;
          this.screenY = this.clientY;
        }
        this.HasMovement = function () {
          return (this.movementX != 0 || this.movementY != 0);
        }
        this.ResetMovement = function () {
          this.movementX = 0;
          this.movementY = 0;
        }
      }
      
      function XRTouchEvent(eventName, target, touches, targetTouchs, changedTouches) {
        this.type = eventName;
        this.target = target;
        this.touches = touches;
        this.targetTouches = targetTouchs;
        this.changedTouches = changedTouches;
        this.ctrlKey = false;
        this.altKey = false;
        this.metaKey = false;
        this.shiftKey = false;
        this.preventDefault = function () {};
      }
    
      function XRManager() {
        this.xrSession = null;
        this.viewerSpace = null;
        this.viewerHitTestSource = null;
        this.xrData = new XRData();
        this.canvas = null;
        this.ctx = null;
        this.gpuDevice = null;
        this.xrGpuBinding = null;
        this.xrGpuProjectionLayer = null;
        this.xrSubImageLeft = null;
        this.xrSubImageRight = null;
        this.gameModule = null;
        this.polyfill = null;
        this.didNotifyUnity = false;
        this.isARSupported = false;
        this.isVRSupported = false;
        this.onInputEvent = null;
        this.onSessionVisibilityEvent = null;
        this.BrowserObject = null;
        this.JSEventsObject = null;
        this.init();
      }
    
      XRManager.prototype.init = function () {
        if (window.WebXRPolyfill) {
          if (window.WebXRPolyfillConfig) {
            // Configuration options can be found at https://github.com/immersive-web/webxr-polyfill#new-webxrpolyfillconfig
            // Added WebXR Polyfill Config option in the WebGLTemplates setting.
            // Can add there "window.WebXRPolyfillConfig = {...}" with the desired configuration.
            this.polyfill = new WebXRPolyfill(window.WebXRPolyfillConfig);
          } else {
            this.polyfill = new WebXRPolyfill();
          }
        }
        
        this.attachEventListeners();
        var thisXRMananger = this;
        navigator.xr.isSessionSupported('immersive-vr').then(function (supported) {
          thisXRMananger.isVRSupported = supported;
          if (Module.WebXR.unityLoaded)
          {
            document.dispatchEvent(new CustomEvent('onVRSupportedCheck', { detail:{supported:thisXRMananger.isVRSupported} }));
            thisXRMananger.UpdateXRCapabilities();
          }
        });
    
        navigator.xr.isSessionSupported('immersive-ar').then(function (supported) {
          thisXRMananger.isARSupported = supported;
          if (Module.WebXR.unityLoaded)
          {
            document.dispatchEvent(new CustomEvent('onARSupportedCheck', { detail:{supported:thisXRMananger.isARSupported} }));
            thisXRMananger.UpdateXRCapabilities();
          }
        });
      }
    
    
      XRManager.prototype.attachEventListeners = function () {
        var onToggleAr = this.toggleAr.bind(this);
        var onToggleVr = this.toggleVr.bind(this);
        var onUnityLoaded = this.unityLoaded.bind(this);
        var onToggleHitTest = this.toggleHitTest.bind(this);
        var onCallHapticPulse = this.hapticPulse.bind(this);

        Module.WebXR.onUnityLoaded = onUnityLoaded;
        Module.WebXR.toggleAR = onToggleAr;
        Module.WebXR.toggleVR = onToggleVr;
        Module.WebXR.toggleHitTest = onToggleHitTest;
        Module.WebXR.callHapticPulse = onCallHapticPulse;
      }
    
      XRManager.prototype.onRequestARSession = function () {
        if (!this.isARSupported) return;
        if (this.BrowserObject.pauseAsyncCallbacks) {
          this.BrowserObject.pauseAsyncCallbacks();
        }
        this.BrowserObject.mainLoop.pause();
        var thisXRMananger = this;
        var tempRender = function () {
          if (thisXRMananger.ctx) {
            thisXRMananger.ctx.clearColor(0, 0, 0, 0);
            thisXRMananger.ctx.clear(thisXRMananger.ctx.COLOR_BUFFER_BIT | thisXRMananger.ctx.DEPTH_BUFFER_BIT);
          }
        }
        window.requestAnimationFrame( tempRender );
        navigator.xr.requestSession('immersive-ar', {
          requiredFeatures: thisXRMananger.gameModule.WebXR.Settings.ARRequiredReferenceSpace,
          optionalFeatures: thisXRMananger.gameModule.WebXR.Settings.AROptionalFeatures
        }).then(function (session) {
          session.isImmersive = true;
          session.isInSession = true;
          session.isAR = true;
          Module.WebXR.xrSession = session;
          thisXRMananger.xrSession = session;
          thisXRMananger.onSessionStarted(session);
        }).catch(function (error) {
          if (thisXRMananger.BrowserObject.resumeAsyncCallbacks) {
            thisXRMananger.BrowserObject.resumeAsyncCallbacks();
          }
          thisXRMananger.BrowserObject.mainLoop.resume();
        });
      }
    
      XRManager.prototype.onRequestVRSession = function () {
        console.log('[WebXR] onRequestVRSession: isVRSupported=' + this.isVRSupported + ' isWebGPUMode=' + this.isWebGPUMode);
        if (!this.isVRSupported) return;
        if (this.BrowserObject.pauseAsyncCallbacks) {
          this.BrowserObject.pauseAsyncCallbacks();
        }
        this.BrowserObject.mainLoop.pause();
        var thisXRMananger = this;
        var tempRender = function () {
          if (thisXRMananger.ctx) {
            thisXRMananger.ctx.clearColor(0, 0, 0, 0);
            thisXRMananger.ctx.clear(thisXRMananger.ctx.COLOR_BUFFER_BIT | thisXRMananger.ctx.DEPTH_BUFFER_BIT);
          }
        }
        window.requestAnimationFrame( tempRender );
        var vrOptionalFeatures = (thisXRMananger.gameModule.WebXR.Settings.VROptionalFeatures || []).slice();
        if (thisXRMananger.isWebGPUMode && vrOptionalFeatures.indexOf('webgpu') === -1) {
          vrOptionalFeatures.push('webgpu');
        }
        // For WebGPU mode use window._nativeXR, saved by an inline <script> in
        // index.html before any extension/polyfill can replace navigator.xr.
        // The emulator extension's synthetic session is not a native XRSession
        // and XRGPUBinding will reject it.
        var xrApi = (thisXRMananger.isWebGPUMode && window._nativeXR)
          ? window._nativeXR : navigator.xr;
        console.log('[WebXR] requestSession immersive-vr xrApi=' +
          (xrApi === window._nativeXR ? 'native' : 'navigator.xr(polyfill)') +
          ' required=' + JSON.stringify(thisXRMananger.gameModule.WebXR.Settings.VRRequiredReferenceSpace) +
          ' optional=' + JSON.stringify(vrOptionalFeatures));
        xrApi.requestSession('immersive-vr', {
          requiredFeatures: thisXRMananger.gameModule.WebXR.Settings.VRRequiredReferenceSpace,
          optionalFeatures: vrOptionalFeatures
        }).then(function (session) {
          session.isImmersive = true;
          session.isInSession = true;
          session.isAR = false;
          Module.WebXR.xrSession = session;
          thisXRMananger.xrSession = session;
          thisXRMananger.onSessionStarted(session);
        }).catch(function (error) {
          console.error('[WebXR] requestSession immersive-vr failed: ' + error);
          if (thisXRMananger.BrowserObject.resumeAsyncCallbacks) {
            thisXRMananger.BrowserObject.resumeAsyncCallbacks();
          }
          thisXRMananger.BrowserObject.mainLoop.resume();
        });
      }
    
      XRManager.prototype.exitXRSession = function () {
        if (!this.xrSession || !this.xrSession.isInSession) {
          console.warn('No XR display to exit XR mode');
          return;
        }
    
        this.xrSession.end();
      }
    
      XRManager.prototype._xrBlitToCompositor = function () {
        if (!this.xrSubImageLeft || !this.xrSubImageRight) return;
        var device = Module['WebXR'] && Module['WebXR'].gpuDevice;
        if (!device) return;
        var canvasCtx = this.xrGpuCanvasCtx;
        if (!canvasCtx) return;
        var canvasTex = canvasCtx.getCurrentTexture();
        if (!canvasTex) return;
        var leftTex  = this.xrSubImageLeft.colorTexture;
        var rightTex = this.xrSubImageRight.colorTexture;
        if (!leftTex || !rightTex) return;
        // C++ WebGPU provider allocates one texture per eye at viewWidth x viewHeight.
        // Canvas is still laid out SBS (left eye left half, right eye right half) because
        // that is what Unity renders; the XR textures are per-eye at half-canvas width.
        var halfW   = Math.floor(canvasTex.width / 2);
        var height  = canvasTex.height;
        var leftW   = Math.min(halfW, leftTex.width);
        var leftH   = Math.min(height, leftTex.height);
        var rightW  = Math.min(halfW, rightTex.width);
        var rightH  = Math.min(height, rightTex.height);
        try {
          var encoder = device.createCommandEncoder();
          // Left eye: copy canvas [0 .. halfW] -> leftTex [0 .. leftW]
          encoder.copyTextureToTexture(
            { texture: canvasTex, origin: { x: 0,     y: 0, z: 0 } },
            { texture: leftTex,   origin: { x: 0,     y: 0, z: 0 } },
            { width: leftW, height: leftH, depthOrArrayLayers: 1 }
          );
          // Right eye: copy canvas [halfW .. W] -> rightTex [0 .. rightW]
          encoder.copyTextureToTexture(
            { texture: canvasTex, origin: { x: halfW, y: 0, z: 0 } },
            { texture: rightTex,  origin: { x: 0,     y: 0, z: 0 } },
            { width: rightW, height: rightH, depthOrArrayLayers: 1 }
          );
          device.queue.submit([encoder.finish()]);
        } catch (e) {
          console.error('[WebXR/WebGPU] _xrBlitToCompositor: ' + e);
        }
        this.xrSubImageLeft  = null;
        this.xrSubImageRight = null;
      };

      XRManager.prototype.onEndSession = function (xrSessionEvent) {
        if (xrSessionEvent.session) {
          xrSessionEvent.session.isInSession = false;
          xrSessionEvent.session.removeEventListener('select', this.onInputEvent);
          xrSessionEvent.session.removeEventListener('selectstart', this.onInputEvent);
          xrSessionEvent.session.removeEventListener('selectend', this.onInputEvent);
          xrSessionEvent.session.removeEventListener('squeeze', this.onInputEvent);
          xrSessionEvent.session.removeEventListener('squeezestart', this.onInputEvent);
          xrSessionEvent.session.removeEventListener('squeezeend', this.onInputEvent);
          xrSessionEvent.session.removeEventListener('visibilitychange', this.onSessionVisibilityEvent);
        }
    
        if (this.viewerHitTestSource) {
          this.viewerHitTestSource.cancel();
          this.viewerHitTestSource = null;
        }
        
        this.removeRemainingTouches();

        Module.HEAPF32[this.xrData.controllerA.frameIndex] = -1; // XRControllerData.frame
        Module.HEAPF32[this.xrData.controllerB.frameIndex] = -1; // XRControllerData.frame
        Module.HEAPF32[this.xrData.controllerA.enabledIndex] = 0; // XRControllerData.enabled
        Module.HEAPF32[this.xrData.controllerB.enabledIndex] = 0; // XRControllerData.enabled

        Module.HEAPF32[this.xrData.handLeft.frameIndex] = -1; // XRHandData.frame
        Module.HEAPF32[this.xrData.handRight.frameIndex] = -1; // XRHandData.frame
        Module.HEAPF32[this.xrData.handLeft.enabledIndex] = 0; // XRHandData.enabled
        Module.HEAPF32[this.xrData.handRight.enabledIndex] = 0; // XRHandData.enabled

        this.gameModule.WebXR.OnEndXR();
        this.didNotifyUnity = false;
        this.xrSubImageLeft       = null;
        this.xrSubImageRight      = null;
        this.xrGpuBinding         = null;
        this.xrGpuProjectionLayer = null;
        this.xrGpuCanvasCtx       = null;

        if (this.isWebGPUFallback) {
          // WebGPU build that fell back to an offscreen GL ctx: null it so the
          // next session re-evaluates and attempts XRGPUBinding again. Do NOT
          // call bindFramebuffer — ctx is a detached offscreen canvas context,
          // not Unity's render surface.
          this.ctx = null;
          this.isWebGPUMode = true;
          this.isWebGPUFallback = false;
        } else if (this.ctx) {
          // Native WebGL session: unbind XR framebuffer before resuming.
          this.ctx.dontClearAlphaOnly = false;
          this.ctx.bindFramebuffer(this.ctx.FRAMEBUFFER, null);
        }
        // If ctx is null and isWebGPUFallback is false we are in true WebGPU
        // mode — nothing to unbind, canvas is managed by the WebGPU swap chain.

        if (this.BrowserObject.pauseAsyncCallbacks) {
          this.BrowserObject.pauseAsyncCallbacks();
        }
        this.BrowserObject.mainLoop.pause();
        var thisXRMananger = this;
        window.setTimeout(function () {
          // Restore canvas to its pre-XR dimensions. Reading clientWidth/clientHeight
          // here is unreliable — the XR overlay is still transitioning and the layout
          // may not have reflowed yet (e.g. height=0), producing a zero-size WebGPU
          // swap-chain texture. Use the values saved at session start instead.
          if (thisXRMananger.preXRCanvasWidth > 0 && thisXRMananger.preXRCanvasHeight > 0) {
            thisXRMananger.canvas.width  = thisXRMananger.preXRCanvasWidth;
            thisXRMananger.canvas.height = thisXRMananger.preXRCanvasHeight;
          } else {
            console.warn('[WebXR] onEndSession: no saved pre-XR canvas size, skipping resize');
          }
          if (thisXRMananger.BrowserObject.resumeAsyncCallbacks) {
            thisXRMananger.BrowserObject.resumeAsyncCallbacks();
          }
          thisXRMananger.BrowserObject.mainLoop.resume();
        });
      }
      
      XRManager.prototype.removeRemainingTouches = function () {
        while (this.xrData.touches.length > 0)
        {
          var touch = this.xrData.touches[0];
          this.xrData.RemoveTouch(touch);
          this.xrData.SendTouchEvent(this.JSEventsObject, "touchend", this.canvas, [touch]);
        }
      }
      
      XRManager.prototype.onInputSourceEvent = function (xrInputSourceEvent) {
        if (xrInputSourceEvent.type && xrInputSourceEvent.inputSource
            && xrInputSourceEvent.inputSource.handedness != 'none') {
          var hand = 0;
          var inputSource = xrInputSourceEvent.inputSource;
          var xrData = this.xrData;
          var controller = this.xrData.controllerA;
          if (inputSource.handedness == 'left') {
              hand = 1;
              controller = this.xrData.controllerB;
          } else if (inputSource.handedness == 'right') {
              hand = 2;
          }
          
          Module.HEAPF32[controller.enabledIndex] = 1; // XRControllerData.enabled
          Module.HEAPF32[controller.handIndex] = hand; // XRControllerData.hand
          
          switch (xrInputSourceEvent.type) {
            case "select":
              Module.HEAPF32[controller.triggerIndex] = 1; // XRControllerData.trigger
              break;
            case "selectstart":
              Module.HEAPF32[controller.triggerIndex] = 1; // XRControllerData.trigger
              break;
            case "selectend":
              Module.HEAPF32[controller.triggerIndex] = 0; // XRControllerData.trigger
              break;
            case "squeeze":
              Module.HEAPF32[controller.squeezeIndex] = 1; // XRControllerData.squeeze
              break;
            case "squeezestart":
              Module.HEAPF32[controller.squeezeIndex] = 1; // XRControllerData.squeeze
              break;
            case "squeezeend":
              Module.HEAPF32[controller.squeezeIndex] = 0; // XRControllerData.squeeze
              break;
          }
          
          if (hand == 0 || hand == 2) {
            Module.HEAPF32[xrData.handRight.squeezeIndex] = Module.HEAPF32[controller.squeezeIndex]; // XRHandData.squeeze
          } else {
            Module.HEAPF32[xrData.handLeft.squeezeIndex] = Module.HEAPF32[controller.squeezeIndex]; // XRHandData.squeeze
          }
        } else {
          var xPercentage = 0.5;
          var yPercentage = 0.5;
          var inputSource = xrInputSourceEvent.inputSource;
          if (inputSource) {
            if (inputSource.gamepad &&
                inputSource.gamepad.axes) {
              xPercentage = (inputSource.gamepad.axes[0] + 1.0) * 0.5;
              yPercentage = (inputSource.gamepad.axes[1] + 1.0) * 0.5;
            }
            switch (xrInputSourceEvent.type) {
              case "select": // 9 touchmove
                // no need to call touchmove here
                break;
              case "selectstart": // 7 touchstart
                inputSource.xrTouchObject = this.xrData.CreateTouch(this.canvas, xPercentage, yPercentage);
                this.xrData.SendTouchEvent(this.JSEventsObject, "touchstart", this.canvas, [inputSource.xrTouchObject])
                break;
              case "selectend": // 8 touchend
                this.xrData.RemoveTouch(inputSource.xrTouchObject);
                this.xrData.SendTouchEvent(this.JSEventsObject, "touchend", this.canvas, [inputSource.xrTouchObject]);
                inputSource.xrTouchObject = null;
                break;
            }
          }
        }
      }

      XRManager.prototype.onVisibilityChange = function (event) {
        this.gameModule.WebXR.OnVisibilityChange(this.xrSession.visibilityState);
      }

      XRManager.prototype.toggleAr = function () {
        if (!this.gameModule)
        {
          return;
        }
        if (this.xrSession && this.xrSession.isInSession) {
          this.exitXRSession();
        } else {
          this.onRequestARSession();
        }
      }
    
      XRManager.prototype.toggleVr = function () {
        if (!this.gameModule)
        {
          return;
        }
        if (this.xrSession && this.xrSession.isInSession) {
          this.exitXRSession();
        } else {
          this.onRequestVRSession();
        }
      }
    
      XRManager.prototype.toggleHitTest = function () {
        if (!this.gameModule)
        {
          return;
        }
        if (this.xrSession && this.xrSession.isInSession && this.xrSession.isAR) {
          if (this.viewerHitTestSource) {
            this.viewerHitTestSource.cancel();
            this.viewerHitTestSource = null;
          } else {
            var thisXRMananger = this;
            this.xrSession.requestReferenceSpace('local').then(function (refSpace) {
              thisXRMananger.xrSession.localRefSpace = refSpace;
            });
            this.xrSession.requestReferenceSpace('viewer').then(function (refSpace) {
              thisXRMananger.viewerSpace = refSpace;
              thisXRMananger.xrSession.requestHitTestSource({space: thisXRMananger.viewerSpace}).then(function (hitTestSource) {
                thisXRMananger.viewerHitTestSource = hitTestSource;
              });
            });
          }
        }
      }
      
      XRManager.prototype.hapticPulse = function (hapticPulseAction) {
        var controller = null;
        switch(hapticPulseAction.detail.controller)
        {
          case 0:
          case 2:
            controller = this.xrData.controllerA;
            break;
          case 1:
            controller = this.xrData.controllerB;
            break;
        }
        if (controller && Module.HEAPF32[controller.enabledIndex] == 1 && controller.gamepad && controller.gamepad.hapticActuators && controller.gamepad.hapticActuators.length > 0)
        {
          controller.gamepad.hapticActuators[0].pulse(hapticPulseAction.detail.intensity, hapticPulseAction.detail.duration);
        }
      }
    
      XRManager.prototype.setGameModule = function (gameModule) {
        if (gameModule && !this.gameModule) {
          this.gameModule = gameModule;
          this.canvas = this.gameModule.canvas;
          this.ctx = this.gameModule.ctx;
    
          var thisXRMananger = this;
          this.JSEventsObject = this.gameModule.WebXR.GetJSEventsObject();
          for (var i = 0; i < this.JSEventsObject.eventHandlers.length; i++) {
            this.xrData.eventsNamesToIDs[this.JSEventsObject.eventHandlers[i].eventTypeString] = i;
          }
          this.BrowserObject = this.gameModule.WebXR.GetBrowserObject();
          this.BrowserObject.requestAnimationFrame = function (func) {
            if (thisXRMananger.xrSession && thisXRMananger.xrSession.isInSession) {
              return thisXRMananger.xrSession.requestAnimationFrame(function (time, xrFrame) {
                thisXRMananger.animate(xrFrame);
                func(time);
                // Fix for an issue of switch to setTimeout instead of rAF
                if (thisXRMananger.BrowserObject.mainLoop.timingMode == 0) {
                  _emscripten_set_main_loop_timing(1, 1);
                }
              });
            } else {
              window.requestAnimationFrame(func);
            }
          };

          // Detect WebGPU mode: ctx is null (Unity WebGPU builds don't set a GL ctx)
          // OR ctx is explicitly a GPUCanvasContext.
          // Do NOT use negated instanceof checks — any unknown/proxied context type
          // (e.g. Wolvic's wrapped GL context) would incorrectly read as WebGPU mode,
          // loading the wrong C++ display provider and hanging the loading screen.
          var isWebGPUMode = !thisXRMananger.ctx
            || (typeof GPUCanvasContext !== 'undefined' && thisXRMananger.ctx instanceof GPUCanvasContext);
          thisXRMananger.isWebGPUMode = isWebGPUMode;
          console.log('[WebXR] setGameModule: ctx type = ' + (thisXRMananger.ctx ? Object.prototype.toString.call(thisXRMananger.ctx) : 'null') + ', isWebGPUMode = ' + isWebGPUMode);

          // In WebGPU mode, WebXRSetIsWebGPU(1) was already called inside the
          // requestAdapter patch when the GPUDevice was captured (before UnityPluginLoad).
          // Handle the rare edge case where ccall wasn't ready at that point.
          if (isWebGPUMode && Module['WebXR']._pendingSetIsWebGPU) {
            Module['WebXR']._pendingSetIsWebGPU = false;
            if (typeof Module.ccall === 'function') {
              try {
                Module.ccall('WebXRSetIsWebGPU', null, ['number'], [1]);
                console.warn('[WebXR/WebGPU] WebXRSetIsWebGPU(1) called late from setGameModule');
              } catch (e) {
                console.warn('[WebXR/WebGPU] WebXRSetIsWebGPU late ccall failed: ' + e);
              }
            }
          }

          if (!isWebGPUMode) {
            Module.WebXR.startRenderSpectatorCamera = function () {
              Module.WebXR.isSpectatorCameraRendering = true;
              thisXRMananger.ctx.bindFramebuffer(thisXRMananger.ctx.FRAMEBUFFER, null);
            }

            // bindFramebuffer frameBufferObject null in XRSession should use XRWebGLLayer FBO instead
            thisXRMananger.ctx.oldBindFramebuffer = thisXRMananger.ctx.bindFramebuffer;
            thisXRMananger.ctx.bindFramebuffer = function (target, fbo) {
              if (!fbo && !Module.WebXR.isSpectatorCameraRendering) {
                if (thisXRMananger.xrSession && thisXRMananger.xrSession.isInSession) {
                  if (thisXRMananger.xrSession.renderState.baseLayer) {
                    fbo = thisXRMananger.xrSession.renderState.baseLayer.framebuffer
                  }
                }
              }
              return thisXRMananger.ctx.oldBindFramebuffer(target, fbo)
            };
          } else {
            console.log('[WebXR/WebGPU] setGameModule: WebGPU mode — skipping bindFramebuffer hijack');
            Module.WebXR.gpuDevice = Module['WebXR'].gpuDevice;
          }
        }
      }
    
      XRManager.prototype.unityLoaded = function (event) {
        Module.WebXR.unityLoaded = 'true';
    
        this.setGameModule(event.detail.module);
    
        document.dispatchEvent(new CustomEvent('onARSupportedCheck', { detail:{supported:this.isARSupported} }));
        document.dispatchEvent(new CustomEvent('onVRSupportedCheck', { detail:{supported:this.isVRSupported} }));
    
        this.UpdateXRCapabilities();
        
        this.onInputEvent = this.onInputSourceEvent.bind(this);
        this.onSessionVisibilityEvent = this.onVisibilityChange.bind(this);
      }
    
      XRManager.prototype.UpdateXRCapabilities = function() {
        // Send browser capabilities to Unity.
        this.gameModule.WebXR.OnXRCapabilities(this.isARSupported, this.isVRSupported);
      }
      
      // http://answers.unity.com/answers/11372/view.html
      XRManager.prototype.quaternionFromMatrix = function(offset, matrix, quaternion) {
        quaternion[3] = Math.sqrt( Math.max( 0, 1 + matrix[offset+0] + matrix[offset+5] + matrix[offset+10] ) ) / 2; 
        quaternion[0] = Math.sqrt( Math.max( 0, 1 + matrix[offset+0] - matrix[offset+5] - matrix[offset+10] ) ) / 2; 
        quaternion[1] = Math.sqrt( Math.max( 0, 1 - matrix[offset+0] + matrix[offset+5] - matrix[offset+10] ) ) / 2; 
        quaternion[2] = Math.sqrt( Math.max( 0, 1 - matrix[offset+0] - matrix[offset+5] + matrix[offset+10] ) ) / 2; 
        quaternion[0] *= Math.sign( quaternion[0] * ( matrix[offset+6] - matrix[offset+9] ) );
        quaternion[1] *= Math.sign( quaternion[1] * ( matrix[offset+8] - matrix[offset+2] ) );
        quaternion[2] *= Math.sign( quaternion[2] * ( matrix[offset+1] - matrix[offset+4] ) );
      }

      XRManager.prototype.vector3Distance = function(ax, ay, az, bx, by, bz) {
        return Math.sqrt(
          Math.pow(ax - bx, 2) +
          Math.pow(ay - by, 2) +
          Math.pow(az - bz, 2));
      }

      XRManager.prototype.getXRControllersData = function(frame, inputSources, refSpace, xrData) {
        Module.HEAPF32[xrData.handLeft.frameIndex] = xrData.frameNumber; // XRHandData.frame
        Module.HEAPF32[xrData.handRight.frameIndex] = xrData.frameNumber; // XRHandData.frame
        Module.HEAPF32[xrData.handLeft.enabledIndex] = 0; // XRHandData.enabled
        Module.HEAPF32[xrData.handRight.enabledIndex] = 0; // XRHandData.enabled
        Module.HEAPF32[xrData.controllerA.frameIndex] = xrData.frameNumber; // XRControllerData.frame
        Module.HEAPF32[xrData.controllerB.frameIndex] = xrData.frameNumber; // XRControllerData.frame
        Module.HEAPF32[xrData.controllerA.enabledIndex] = 0; // XRControllerData.enabled
        Module.HEAPF32[xrData.controllerB.enabledIndex] = 0; // XRControllerData.enabled
        if (!inputSources || !inputSources.length || inputSources.length == 0) {
          this.removeRemainingTouches();
          return;
        }
        var touchesToSend = [];
        for (var i = 0; i < inputSources.length; i++) {
          var inputSource = inputSources[i];
          // Show the input source if it has a grip space
          if (inputSource.hand) {
            var xrHand = xrData.handLeft;
            Module.HEAPF32[xrHand.handIndex] = 1; // XRHandData.hand
            if (inputSource.handedness == 'right') {
              xrHand = xrData.handRight;
              Module.HEAPF32[xrHand.handIndex] = 2; // XRHandData.hand
            }
            Module.HEAPF32[xrHand.enabledIndex] = 1; // XRHandData.enabled

            if (xrHand.handValuesType == 0) {
              if (inputSource.hand.values) {
                xrHand.handValuesType = 1
              } else {
                xrHand.handValuesType = 2
              }
            }
            if (!frame.fillPoses(
                xrHand.handValuesType == 1 ? inputSource.hand.values() : inputSource.hand,
                refSpace,
                xrHand.poses)) {
              Module.HEAPF32[xrHand.enabledIndex] = 0; // XRHandData.enabled
              continue;
            }
            if (!xrHand.hasRadii)
            {
              xrHand.hasRadii = frame.fillJointRadii(
                xrHand.handValuesType == 1 ? inputSource.hand.values() : inputSource.hand,
                xrHand.radii);
            }
            xrHand.bufferJointIndex = xrHand.jointsStartIndex;
            for (var j = 0; j < 25; j++) {
              xrHand.jointIndex = j*16;
              if (!isNaN(xrHand.poses[xrHand.jointIndex])) {
                Module.HEAPF32[xrHand.bufferJointIndex++] = xrHand.poses[xrHand.jointIndex+12]; // XRJointData.position.x
                Module.HEAPF32[xrHand.bufferJointIndex++] = xrHand.poses[xrHand.jointIndex+13]; // XRJointData.position.y
                Module.HEAPF32[xrHand.bufferJointIndex++] = -xrHand.poses[xrHand.jointIndex+14]; // XRJointData.position.z
                this.quaternionFromMatrix(xrHand.jointIndex, xrHand.poses, xrHand.jointQuaternion);
                Module.HEAPF32[xrHand.bufferJointIndex++] = -xrHand.jointQuaternion[0]; // XRJointData.rotation.x
                Module.HEAPF32[xrHand.bufferJointIndex++] = -xrHand.jointQuaternion[1]; // XRJointData.rotation.y
                Module.HEAPF32[xrHand.bufferJointIndex++] = xrHand.jointQuaternion[2]; // XRJointData.rotation.z
                Module.HEAPF32[xrHand.bufferJointIndex++] = xrHand.jointQuaternion[3]; // XRJointData.rotation.w
                if (!isNaN(xrHand.radii[j])) {
                  Module.HEAPF32[xrHand.bufferJointIndex] = xrHand.radii[j]; // XRJointData.radius
                }
                xrHand.bufferJointIndex++;
              }
            }
            // Get pointer pose for hand
            var inputRayPose = frame.getPose(inputSource.targetRaySpace, refSpace);
            if (inputRayPose) {
              var position = inputRayPose.transform.position;
              var orientation = inputRayPose.transform.orientation;
              Module.HEAPF32[xrHand.pointerPositionXIndex] = position.x; // XRHandData.pointerPositionX
              Module.HEAPF32[xrHand.pointerPositionYIndex] = position.y; // XRHandData.pointerPositionY
              Module.HEAPF32[xrHand.pointerPositionZIndex] = -position.z; // XRHandData.pointerPositionZ
              Module.HEAPF32[xrHand.pointerRotationXIndex] = -orientation.x; // XRHandData.pointerRotationX
              Module.HEAPF32[xrHand.pointerRotationYIndex] = -orientation.y; // XRHandData.pointerRotationY
              Module.HEAPF32[xrHand.pointerRotationZIndex] = orientation.z; // XRHandData.pointerRotationZ
              Module.HEAPF32[xrHand.pointerRotationWIndex] = orientation.w; // XRHandData.pointerRotationW
            }
            xrHand.pinchDistance = 1;
            if (!isNaN(xrHand.poses[xrHand.thumbTip])
                && !isNaN(xrHand.poses[xrHand.indexTip])) {
              xrHand.pinchDistance = this.vector3Distance(xrHand.poses[xrHand.thumbTip + 12],
                xrHand.poses[xrHand.thumbTip + 13],
                xrHand.poses[xrHand.thumbTip + 14],
                xrHand.poses[xrHand.indexTip + 12],
                xrHand.poses[xrHand.indexTip + 13],
                xrHand.poses[xrHand.indexTip + 14]);
            }
            if (Module.HEAPF32[xrHand.triggerIndex] === 0) {
              Module.HEAPF32[xrHand.triggerIndex] = xrHand.pinchDistance <= xrHand.pinchSelectDistanceStart ? 1 : 0;
            } else {
              Module.HEAPF32[xrHand.triggerIndex] = xrHand.pinchDistance > xrHand.pinchSelectDistanceEnd ? 0 : 1;
            }
          } else if (inputSource.gripSpace) {
            var inputRayPose = frame.getPose(inputSource.targetRaySpace, refSpace);
            if (inputRayPose) {
              var position = inputRayPose.transform.position;
              var orientation = inputRayPose.transform.orientation;
              var hand = 0;
              var controller = xrData.controllerA;
              if (inputSource.handedness == 'left') {
                hand = 1;
                controller = xrData.controllerB;
              } else if (inputSource.handedness == 'right') {
                hand = 2;
              }
              
              Module.HEAPF32[controller.enabledIndex] = 1; // XRControllerData.enabled
              Module.HEAPF32[controller.handIndex] = hand; // XRControllerData.hand

              if (controller.updatedProfiles == 0 && inputSource.profiles.length > 0) {
                controller.profiles = inputSource.profiles;
                controller.updatedProfiles = 1;
              }
              
              Module.HEAPF32[controller.positionXIndex] = position.x; // XRControllerData.positionX
              Module.HEAPF32[controller.positionYIndex] = position.y; // XRControllerData.positionY
              Module.HEAPF32[controller.positionZIndex] = -position.z; // XRControllerData.positionZ
              
              Module.HEAPF32[controller.rotationXIndex] = -orientation.x; // XRControllerData.rotationX
              Module.HEAPF32[controller.rotationYIndex] = -orientation.y; // XRControllerData.rotationY
              Module.HEAPF32[controller.rotationZIndex] = orientation.z; // XRControllerData.rotationZ
              Module.HEAPF32[controller.rotationWIndex] = orientation.w; // XRControllerData.rotationW

              if (inputSource.gripSpace) {
                var inputPose = frame.getPose(inputSource.gripSpace, refSpace);
                if (inputPose) {
                  var gripPosition = inputPose.transform.position;
                  var gripOrientation = inputPose.transform.orientation;

                  Module.HEAPF32[controller.gripPositionXIndex] = gripPosition.x; // XRControllerData.gripPositionX
                  Module.HEAPF32[controller.gripPositionYIndex] = gripPosition.y; // XRControllerData.gripPositionY
                  Module.HEAPF32[controller.gripPositionZIndex] = -gripPosition.z; // XRControllerData.gripPositionZ

                  Module.HEAPF32[controller.gripRotationXIndex] = -gripOrientation.x; // XRControllerData.gripRotationX
                  Module.HEAPF32[controller.gripRotationYIndex] = -gripOrientation.y; // XRControllerData.gripRotationY
                  Module.HEAPF32[controller.gripRotationZIndex] = gripOrientation.z; // XRControllerData.gripRotationZ
                  Module.HEAPF32[controller.gripRotationWIndex] = gripOrientation.w; // XRControllerData.gripRotationW

                  Module.HEAPF32[controller.updatedGripIndex] = 1; // XRControllerData.updatedGrip
                }
              }
              
              // if there's gamepad, use the xr-standard mapping
              if (inputSource.gamepad) {
                for (var j = 0; j < inputSource.gamepad.buttons.length; j++) {
                  switch (j) {
                    case 0:
                      Module.HEAPF32[controller.triggerIndex] = inputSource.gamepad.buttons[j].value; // XRControllerData.trigger
                      Module.HEAPF32[controller.triggerTouchedIndex] = inputSource.gamepad.buttons[j].touched; // XRControllerData.triggerTouched
                      break;
                    case 1:
                      Module.HEAPF32[controller.squeezeIndex] = inputSource.gamepad.buttons[j].value; // XRControllerData.squeeze
                      Module.HEAPF32[controller.squeezeTouchedIndex] = inputSource.gamepad.buttons[j].touched; // XRControllerData.squeezeTouched
                      break;
                    case 2:
                      Module.HEAPF32[controller.touchpadIndex] = inputSource.gamepad.buttons[j].value; // XRControllerData.touchpad
                      Module.HEAPF32[controller.touchpadTouchedIndex] = inputSource.gamepad.buttons[j].touched; // XRControllerData.touchpadTouched
                      break;
                    case 3:
                      Module.HEAPF32[controller.thumbstickIndex] = inputSource.gamepad.buttons[j].value; // XRControllerData.thumbstick
                      Module.HEAPF32[controller.thumbstickTouchedIndex] = inputSource.gamepad.buttons[j].touched; // XRControllerData.thumbstickTouched
                      break;
                    case 4:
                      Module.HEAPF32[controller.buttonAIndex] = inputSource.gamepad.buttons[j].value; // XRControllerData.buttonA
                      Module.HEAPF32[controller.buttonATouchedIndex] = inputSource.gamepad.buttons[j].touched; // XRControllerData.buttonATouched
                      break;
                    case 5:
                      Module.HEAPF32[controller.buttonBIndex] = inputSource.gamepad.buttons[j].value; // XRControllerData.buttonB
                      Module.HEAPF32[controller.buttonBTouchedIndex] = inputSource.gamepad.buttons[j].touched; // XRControllerData.buttonBTouched
                      break;
                  }
                }
                
                if (Module.HEAPF32[controller.triggerIndex] <= 0.02) {
                  Module.HEAPF32[controller.triggerIndex] = 0;
                } else if (Module.HEAPF32[controller.triggerIndex] >= 0.98) {
                  Module.HEAPF32[controller.triggerIndex] = 1;
                }
                
                if (Module.HEAPF32[controller.squeezeIndex] <= 0.02) {
                  Module.HEAPF32[controller.squeezeIndex] = 0;
                } else if (Module.HEAPF32[controller.squeezeIndex] >= 0.98) {
                  Module.HEAPF32[controller.squeezeIndex] = 1;
                }
                
                for (var j = 0; j < inputSource.gamepad.axes.length; j++) {
                  switch (j) {
                    case 0:
                      Module.HEAPF32[controller.touchpadXIndex] = inputSource.gamepad.axes[j]; // XRControllerData.touchpadX
                      break;
                    case 1:
                      Module.HEAPF32[controller.touchpadYIndex] = -inputSource.gamepad.axes[j]; // XRControllerData.touchpadY
                      break;
                    case 2:
                      Module.HEAPF32[controller.thumbstickXIndex] = inputSource.gamepad.axes[j]; // XRControllerData.thumbstickX
                      break;
                    case 3:
                      Module.HEAPF32[controller.thumbstickYIndex] = -inputSource.gamepad.axes[j]; // XRControllerData.thumbstickY
                      break;
                  }
                }
              }
              controller.gamepad = inputSource.gamepad;
            }
          } else if (inputSource.xrTouchObject && !inputSource.xrTouchObject.ended && inputSource.gamepad && inputSource.gamepad.axes) {
            inputSource.xrTouchObject.UpdateTouch( this.canvas,
                                                   (inputSource.gamepad.axes[0] + 1.0) * 0.5,
                                                   (inputSource.gamepad.axes[1] + 1.0) * 0.5);
            if (inputSource.xrTouchObject.HasMovement()) {
              touchesToSend.push(inputSource.xrTouchObject);
            }
          }
        }
        if (touchesToSend.length > 0) {
          this.xrData.SendTouchEvent(this.JSEventsObject, "touchmove", this.canvas, touchesToSend);
          for (var i = 0; i < touchesToSend.length; i++) {
            touchesToSend[i].ResetMovement();
          }
        }
      }
    
      XRManager.prototype.onSessionStarted = function (session) {
        var webXRSettings = this.gameModule.WebXR.Settings;
        console.log('[WebXR] onSessionStarted: isWebGPUMode = ' + this.isWebGPUMode);

        // Save canvas dimensions before XR modifies them (WebGL path resizes to
        // framebuffer size; WebGPU path leaves them unchanged). Restored on exit.
        this.preXRCanvasWidth  = this.canvas.width;
        this.preXRCanvasHeight = this.canvas.height;

        // Clear fallback flag — set exclusively by applyWebGLFallback() below.
        // Used by onEndSession to distinguish the WebGPU→WebGL fallback case
        // (offscreen ctx, must be nulled) from a native WebGL session (ctx must
        // be kept so the bindFramebuffer patch remains functional).
        this.isWebGPUFallback = false;

        var refSpaceType = 'viewer';
        if (!this.isWebGPUMode) {
          // ---- WebGL path ------------------------------------------------
          var glLayerOptions = {
            alpha: true,
            antialias: true,
            depth: true,
            stencil: true
          };
          if (webXRSettings.UseFramebufferScaleFactor) {
            var scaleFactor = webXRSettings.FramebufferScaleFactor;
            if (webXRSettings.UseNativeResolution && XRWebGLLayer.getNativeFramebufferScaleFactor) {
              scaleFactor = XRWebGLLayer.getNativeFramebufferScaleFactor(session);
            }
            glLayerOptions.framebufferScaleFactor = scaleFactor;
          }
          var glLayer = new XRWebGLLayer(session, this.ctx, glLayerOptions);
          session.updateRenderState({ baseLayer: glLayer });

          if (session.isImmersive) {
            refSpaceType = webXRSettings.VRRequiredReferenceSpace[0];
            if (session.isAR) {
              refSpaceType = webXRSettings.ARRequiredReferenceSpace[0];
              this.ctx.dontClearAlphaOnly = true;
            }
            this.canvas.width = glLayer.framebufferWidth;
            this.canvas.height = glLayer.framebufferHeight;
          }
        } else {
          // ---- WebGPU path -----------------------------------------------
          var thisXRMananger = this;

          // Shared WebGL fallback: used when XRGPUBinding is unavailable or fails.
          // A canvas with an active WebGPU context cannot also provide a WebGL context
          // (browsers enforce one context type per canvas), so we create a dedicated
          // offscreen canvas for the GL context. XRWebGLLayer only needs an
          // xrCompatible GL context — it does not need to be the Unity render canvas.
          var applyWebGLFallback = function (reason) {
            console.warn('[WebXR/WebGPU] Falling back to WebGL layer: ' + reason);
            var glCanvas = document.createElement('canvas');
            glCanvas.width  = thisXRMananger.canvas.width;
            glCanvas.height = thisXRMananger.canvas.height;
            var fallbackCtx = glCanvas.getContext('webgl2', { xrCompatible: true })
                           || glCanvas.getContext('webgl',  { xrCompatible: true });
            if (!fallbackCtx) {
              console.error('[WebXR/WebGPU] WebGL fallback failed: could not get WebGL2 context');
              return;
            }
            thisXRMananger.ctx = fallbackCtx;
            thisXRMananger.isWebGPUMode = false;
            thisXRMananger.isWebGPUFallback = true; // offscreen ctx, must be cleared on exit
            thisXRMananger.xrGpuCanvasCtx = null;
            var glLayerOptions = { alpha: true, antialias: true, depth: true, stencil: true };
            if (webXRSettings.UseFramebufferScaleFactor) {
              var scaleFactor = webXRSettings.FramebufferScaleFactor;
              if (webXRSettings.UseNativeResolution && XRWebGLLayer.getNativeFramebufferScaleFactor) {
                scaleFactor = XRWebGLLayer.getNativeFramebufferScaleFactor(session);
              }
              glLayerOptions.framebufferScaleFactor = scaleFactor;
            }
            var fallbackLayer = new XRWebGLLayer(session, fallbackCtx, glLayerOptions);
            session.updateRenderState({ baseLayer: fallbackLayer });
            // Do NOT resize thisXRMananger.canvas — Unity still renders to its
            // WebGPU swap chain; the offscreen GL framebuffer is internal only.
            console.log('[WebXR/WebGPU] WebGL fallback active. framebuffer=' +
              fallbackLayer.framebufferWidth + 'x' + fallbackLayer.framebufferHeight);
          };

          var gpuDevice = Module['WebXR'] && Module['WebXR'].gpuDevice;
          if (!gpuDevice) {
            applyWebGLFallback('no captured GPUDevice');
          } else if (typeof XRGPUBinding === 'undefined') {
            applyWebGLFallback('XRGPUBinding API not available in this browser');
          } else {
            // Cache the canvas WebGPU context once — getContext('webgpu') every frame
            // is wasteful, and if control is ever transferred the per-frame call returns null.
            thisXRMananger.xrGpuCanvasCtx = thisXRMananger.canvas.getContext('webgpu');
            if (!thisXRMananger.xrGpuCanvasCtx) {
              console.error('[WebXR/WebGPU] canvas.getContext(webgpu) returned null — COPY_SRC patch may not have run');
            }
            try {
              var binding = new XRGPUBinding(session, gpuDevice);
              thisXRMananger.xrGpuBinding = binding;

              // Use canvas format for XR layer so copyTextureToTexture format matches.
              // binding.getPreferredColorFormat() returns the compositor's preferred format
              // (e.g. rgba8unorm on Quest) which differs from the canvas (bgra8unorm on PC/Quest).
              // copyTextureToTexture requires identical src/dst formats, so we align to the
              // canvas. navigator.gpu.getPreferredCanvasFormat() is the authoritative source.
              var canvasFormat = (navigator.gpu && typeof navigator.gpu.getPreferredCanvasFormat === 'function')
                ? navigator.gpu.getPreferredCanvasFormat() : 'bgra8unorm';
              var eyeWidth  = Math.floor(thisXRMananger.canvas.width / 2);
              var eyeHeight = thisXRMananger.canvas.height;
              var layerInit = {
                colorFormat: canvasFormat,
                textureUsage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST | GPUTextureUsage.TEXTURE_BINDING,
              };
              if (eyeWidth > 0 && eyeHeight > 0) {
                layerInit.textureWidth  = eyeWidth;
                layerInit.textureHeight = eyeHeight;
              }
              var projectionLayer = binding.createProjectionLayer(layerInit);
              thisXRMananger.xrGpuProjectionLayer = projectionLayer;
              session.updateRenderState({ layers: [projectionLayer] });
              console.log('[WebXR/WebGPU] XRGPUBinding + XRProjectionLayer created. format=' +
                canvasFormat + ' eyeSize=' + eyeWidth + 'x' + eyeHeight);

              // Intercept session.requestAnimationFrame: Unity calls this after
              // submitting all GPU work for the frame — safe point to blit.
              var _origSessionRaf = session.requestAnimationFrame.bind(session);
              session.requestAnimationFrame = function (callback) {
                thisXRMananger._xrBlitToCompositor();
                return _origSessionRaf(callback);
              };
            } catch (e) {
              applyWebGLFallback(e);
            }
          }
          if (session.isImmersive) {
            // isWebGPUMode may have been flipped to false by applyWebGLFallback above.
            refSpaceType = webXRSettings.VRRequiredReferenceSpace[0];
          }
        }

        if (session.isImmersive) {
          
          session.addEventListener('select', this.onInputEvent);
          session.addEventListener('selectstart', this.onInputEvent);
          session.addEventListener('selectend', this.onInputEvent);
          session.addEventListener('squeeze', this.onInputEvent);
          session.addEventListener('squeezestart', this.onInputEvent);
          session.addEventListener('squeezeend', this.onInputEvent);
          session.addEventListener('visibilitychange', this.onSessionVisibilityEvent);
          session.addEventListener('end', this.onEndSession.bind(this));
    
          this.xrData.controllerA.setIndices(Module.ControllersArrayOffset);
          this.xrData.controllerB.setIndices(Module.ControllersArrayOffset + 34);
          this.xrData.handLeft.setIndices(Module.HandsArrayOffset);
          this.xrData.handRight.setIndices(Module.HandsArrayOffset + 212);
          this.xrData.viewerHitTestPose.setIndices(Module.ViewerHitTestPoseArrayOffset);
          this.xrData.controllerA.updatedProfiles = 0;
          this.xrData.controllerB.updatedProfiles = 0;
          this.xrData.controllerA.profiles = [];
          this.xrData.controllerB.profiles = [];
          Module.HEAPF32[this.xrData.controllerA.updatedGripIndex] = 0; // XRControllerData.updatedGrip
          Module.HEAPF32[this.xrData.controllerB.updatedGripIndex] = 0; // XRControllerData.updatedGrip
          Module.HEAPF32[this.xrData.viewerHitTestPose.frameIndex] = -1; // XRHitPoseData.frame
          Module.HEAPF32[this.xrData.viewerHitTestPose.availableIndex] = 0; // XRHitPoseData.available
        }
        var thisXRMananger = this;
        // Log what the session actually granted — critical for diagnosing polyfill vs native.
        if (session.enabledFeatures) {
          console.log('[WebXR] onSessionStarted: enabledFeatures=' + JSON.stringify(Array.from(session.enabledFeatures)));
        } else {
          console.log('[WebXR] onSessionStarted: enabledFeatures not available (polyfill session)');
        }
        session.requestReferenceSpace(refSpaceType).then(function (refSpace) {
          session.refSpace = refSpace;
          // poseRaf: fires XR frames until animate() returns true (first valid pose
          // received and OnStartVR called). After that, mainLoop.resume() hands
          // control back to Unity. Unity's own requestAnimationFrame calls are
          // already intercepted in setGameModule to route through xrSession.rAF,
          // so animate() keeps running every XR frame automatically — no manual
          // re-registration needed here after resume.
          var poseRaf = function (time, xrFrame) {
            var notified = thisXRMananger.animate(xrFrame);
            if (notified) {
              // First valid pose received. Resume Unity's loop — the setGameModule
              // BrowserObject.requestAnimationFrame intercept will drive animate()
              // on every subsequent Unity frame via xrSession.requestAnimationFrame.
              if (thisXRMananger.BrowserObject.resumeAsyncCallbacks) {
                thisXRMananger.BrowserObject.resumeAsyncCallbacks();
              }
              thisXRMananger.BrowserObject.mainLoop.resume();
            } else {
              // No valid pose yet — retry on next XR frame.
              session.requestAnimationFrame(poseRaf);
            }
          };
          session.requestAnimationFrame(poseRaf);
        });
      }
    
      XRManager.prototype.animate = function (frame) {
        var session = frame.session;
        if (!session) {
          return this.didNotifyUnity;
        }

        if (!this.isWebGPUMode) {
          // ---- WebGL path: bind XRWebGLLayer framebuffer -------------------
          var glLayer = session.renderState.baseLayer;
          if (!glLayer) {
            console.error('[WebXR] animate: no baseLayer in WebGL mode');
            return this.didNotifyUnity;
          }
          if (this.canvas.width != glLayer.framebufferWidth ||
              this.canvas.height != glLayer.framebufferHeight)
          {
            this.canvas.width = glLayer.framebufferWidth;
            this.canvas.height = glLayer.framebufferHeight;
          }
          Module.WebXR.isSpectatorCameraRendering = false;
          this.ctx.bindFramebuffer(this.ctx.FRAMEBUFFER, glLayer.framebuffer);
          if (session.isAR) {
            this.ctx.depthMask(false);
            this.ctx.clear(this.ctx.DEPTH_BUFFER_BIT);
            this.ctx.depthMask(true);
          } else {
            this.ctx.clear(this.ctx.COLOR_BUFFER_BIT | this.ctx.DEPTH_BUFFER_BIT);
          }
        }
        // WebGPU path: Unity renders to its own swap chain — no framebuffer bind needed here.
        
        var pose = frame.getViewerPose(session.refSpace);
        if (!pose) {
          return this.didNotifyUnity;
        }
    
        if (!session.isImmersive)
        {
          return this.didNotifyUnity;
        }
    
        var xrData = this.xrData;
        xrData.frameNumber++;
    
        for (var i = 0; i < pose.views.length; i++) {
          var view = pose.views[i];
          var transformMatrix = view.transform.matrix;
          if (view.eye === "left" || view.eye === "none") {
            Module.HEAPF32.set(view.projectionMatrix, Module.XRSharedArrayOffset); // leftProjectionMatrix
            this.quaternionFromMatrix(0, transformMatrix, xrData.leftViewRotation);
            xrData.leftViewRotation[0] = -xrData.leftViewRotation[0];
            xrData.leftViewRotation[1] = -xrData.leftViewRotation[1];
            xrData.leftViewPosition[0] = transformMatrix[12];
            xrData.leftViewPosition[1] = transformMatrix[13];
            xrData.leftViewPosition[2] = -transformMatrix[14];
            Module.HEAPF32.set(xrData.leftViewRotation, Module.XRSharedArrayOffset + 32); // leftViewRotation
            Module.HEAPF32.set(xrData.leftViewPosition, Module.XRSharedArrayOffset + 40); // leftViewPosition
          } else if (view.eye === 'right') {
            Module.HEAPF32.set(view.projectionMatrix, Module.XRSharedArrayOffset + 16); // rightProjectionMatrix
            this.quaternionFromMatrix(0, transformMatrix, xrData.rightViewRotation);
            xrData.rightViewRotation[0] = -xrData.rightViewRotation[0];
            xrData.rightViewRotation[1] = -xrData.rightViewRotation[1];
            xrData.rightViewPosition[0] = transformMatrix[12];
            xrData.rightViewPosition[1] = transformMatrix[13];
            xrData.rightViewPosition[2] = -transformMatrix[14];
            Module.HEAPF32.set(xrData.rightViewRotation, Module.XRSharedArrayOffset + 36); // rightViewRotation
            Module.HEAPF32.set(xrData.rightViewPosition, Module.XRSharedArrayOffset + 43); // rightViewPosition
          }
        }
    
        // WebGPU: acquire per-eye subimage textures while the XRFrame is valid.
        if (this.isWebGPUMode && this.xrGpuBinding && this.xrGpuProjectionLayer) {
          this.xrSubImageLeft  = null;
          this.xrSubImageRight = null;
          try {
            for (var si = 0; si < pose.views.length; si++) {
              var sView  = pose.views[si];
              var subImg = this.xrGpuBinding.getViewSubImage(this.xrGpuProjectionLayer, sView);
              if (sView.eye === 'left' || sView.eye === 'none') {
                this.xrSubImageLeft  = subImg;
              } else if (sView.eye === 'right') {
                this.xrSubImageRight = subImg;
              }
            }
          } catch (e) {
            console.error('[WebXR/WebGPU] getViewSubImage: ' + e);
          }
        }

        this.getXRControllersData(frame, session.inputSources, session.refSpace, xrData);
    
        if (session.isAR && this.viewerHitTestSource) {
          Module.HEAPF32[xrData.viewerHitTestPose.frameIndex] = xrData.frameNumber; // XRHitPoseData.frame
          var viewerHitTestResults = frame.getHitTestResults(this.viewerHitTestSource);
          if (viewerHitTestResults.length > 0) {
            var hitTestPose = viewerHitTestResults[0].getPose(session.localRefSpace);
            Module.HEAPF32[xrData.viewerHitTestPose.availableIndex] = 1; // XRHitPoseData.available
            Module.HEAPF32[xrData.viewerHitTestPose.positionIndices[0]] = hitTestPose.transform.position.x; // XRHitPoseData.position[0]
            var hitTestPoseBase = viewerHitTestResults[0].getPose(session.refSpace); // Ugly hack for y position on Samsung Internet
            Module.HEAPF32[xrData.viewerHitTestPose.positionIndices[1]] = hitTestPose.transform.position.y + Math.abs(hitTestPose.transform.position.y - hitTestPoseBase.transform.position.y); // XRHitPoseData.position[1]
            Module.HEAPF32[xrData.viewerHitTestPose.positionIndices[2]] = -hitTestPose.transform.position.z; // XRHitPoseData.position[2]
            Module.HEAPF32[xrData.viewerHitTestPose.rotationIndices[0]] = -hitTestPose.transform.orientation.x; // XRHitPoseData.rotation[0]
            Module.HEAPF32[xrData.viewerHitTestPose.rotationIndices[1]] = -hitTestPose.transform.orientation.y; // XRHitPoseData.rotation[1]
            Module.HEAPF32[xrData.viewerHitTestPose.rotationIndices[2]] = hitTestPose.transform.orientation.z; // XRHitPoseData.rotation[2]
            Module.HEAPF32[xrData.viewerHitTestPose.rotationIndices[3]] = hitTestPose.transform.orientation.w; // XRHitPoseData.rotation[3]
          } else {
            Module.HEAPF32[xrData.viewerHitTestPose.availableIndex] = 0; // XRHitPoseData.available
          }
        }
    
        if (xrData.controllerA.updatedProfiles == 1 || xrData.controllerB.updatedProfiles == 1)
        {
          var inputProfiles = {};
          inputProfiles.controller1 = xrData.controllerA.profiles;
          inputProfiles.controller2 = xrData.controllerB.profiles;
          if (xrData.controllerA.updatedProfiles == 1)
          {
            xrData.controllerA.updatedProfiles = 2;
          }
          if (xrData.controllerB.updatedProfiles == 1)
          {
            xrData.controllerB.updatedProfiles = 2;
          }
          this.gameModule.WebXR.OnInputProfiles(JSON.stringify(inputProfiles));
        }
        
        if (!this.didNotifyUnity)
        {
          var eyeCount = 1;
          var leftRect = { x:0, y:0, w:1, h:1 };
          var rightRect = { x:0.5, y:0, w:0.5, h:1 };

          if (!this.isWebGPUMode) {
            // ---- WebGL path: derive rects from XRWebGLLayer viewports ------
            var glLayer = session.renderState.baseLayer;
            for (var i = 0; i < pose.views.length; i++) {
              var view = pose.views[i];
              var viewport = glLayer.getViewport(view);
              if (view.eye === 'left') {
                if (viewport) {
                  leftRect.x = (viewport.x / glLayer.framebufferWidth) * (glLayer.framebufferWidth / this.canvas.width);
                  leftRect.y = (viewport.y / glLayer.framebufferHeight) * (glLayer.framebufferHeight / this.canvas.height);
                  leftRect.w = (viewport.width / glLayer.framebufferWidth) * (glLayer.framebufferWidth / this.canvas.width);
                  leftRect.h = (viewport.height / glLayer.framebufferHeight) * (glLayer.framebufferHeight / this.canvas.height);
                  Module.HEAPF32[Module.XRSharedArrayOffset + 46] = viewport.width;
                  Module.HEAPF32[Module.XRSharedArrayOffset + 47] = viewport.height;
                  Module.HEAPF32[Module.XRSharedArrayOffset + 48] = viewport.x;
                  Module.HEAPF32[Module.XRSharedArrayOffset + 49] = viewport.y;
                }
              } else if (view.eye === 'right' && viewport && viewport.width != 0 && viewport.height != 0 && viewport.x != 0) {
                eyeCount = 2;
                rightRect.x = (viewport.x / glLayer.framebufferWidth) * (glLayer.framebufferWidth / this.canvas.width);
                rightRect.y = (viewport.y / glLayer.framebufferHeight) * (glLayer.framebufferHeight / this.canvas.height);
                rightRect.w = (viewport.width / glLayer.framebufferWidth) * (glLayer.framebufferWidth / this.canvas.width);
                rightRect.h = (viewport.height / glLayer.framebufferHeight) * (glLayer.framebufferHeight / this.canvas.height);
                Module.HEAPF32[Module.XRSharedArrayOffset + 50] = viewport.width;
                Module.HEAPF32[Module.XRSharedArrayOffset + 51] = viewport.height;
                Module.HEAPF32[Module.XRSharedArrayOffset + 52] = viewport.x;
                Module.HEAPF32[Module.XRSharedArrayOffset + 53] = viewport.y;
              }
            }
            Module.HEAPF32[Module.XRSharedArrayOffset + 56] = glLayer.framebufferWidth;
            Module.HEAPF32[Module.XRSharedArrayOffset + 57] = glLayer.framebufferHeight;
          } else {
            // ---- WebGPU path: derive eye count from views; rects are full/half -----
            // No baseLayer viewport available. Use canvas dimensions as framebuffer size.
            // eyeCount from views array: stereo = 2 views with distinct eyes.
            for (var i = 0; i < pose.views.length; i++) {
              if (pose.views[i].eye === 'right') { eyeCount = 2; break; }
            }
            var fbW = this.canvas.width;
            var fbH = this.canvas.height;
            if (eyeCount === 2) {
              leftRect  = { x:0,   y:0, w:0.5, h:1 };
              rightRect = { x:0.5, y:0, w:0.5, h:1 };
              Module.HEAPF32[Module.XRSharedArrayOffset + 46] = fbW / 2;
              Module.HEAPF32[Module.XRSharedArrayOffset + 47] = fbH;
              Module.HEAPF32[Module.XRSharedArrayOffset + 48] = 0;
              Module.HEAPF32[Module.XRSharedArrayOffset + 49] = 0;
              Module.HEAPF32[Module.XRSharedArrayOffset + 50] = fbW / 2;
              Module.HEAPF32[Module.XRSharedArrayOffset + 51] = fbH;
              Module.HEAPF32[Module.XRSharedArrayOffset + 52] = fbW / 2;
              Module.HEAPF32[Module.XRSharedArrayOffset + 53] = 0;
            } else {
              leftRect = { x:0, y:0, w:1, h:1 };
              Module.HEAPF32[Module.XRSharedArrayOffset + 46] = fbW;
              Module.HEAPF32[Module.XRSharedArrayOffset + 47] = fbH;
              Module.HEAPF32[Module.XRSharedArrayOffset + 48] = 0;
              Module.HEAPF32[Module.XRSharedArrayOffset + 49] = 0;
            }
            Module.HEAPF32[Module.XRSharedArrayOffset + 56] = fbW;
            Module.HEAPF32[Module.XRSharedArrayOffset + 57] = fbH;
            console.log('[WebXR/WebGPU] OnStartVR: eyeCount=' + eyeCount + ' canvas=' + fbW + 'x' + fbH);
          }

          Module.HEAPF32[Module.XRSharedArrayOffset + 54] = eyeCount;
          Module.HEAPF32[Module.XRSharedArrayOffset + 55] = session.isAR ? 1 : 0;
          if (session.isAR)
          {
            this.gameModule.WebXR.OnStartAR(eyeCount, leftRect, rightRect);
          } else {
            this.gameModule.WebXR.OnStartVR(eyeCount, leftRect, rightRect);
          }
          this.gameModule.WebXR.OnVisibilityChange(session.visibilityState);
          this.didNotifyUnity = true;
        }
        return this.didNotifyUnity;
      }

      function initWebXRManager () {
        var xrManager = window.xrManager = new XRManager();
        return xrManager;
      }
    
      function init() {
        if (typeof(navigator.xr) == 'undefined') {
          var script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/webxr-polyfill@latest/build/webxr-polyfill.js';
          document.getElementsByTagName('head')[0].appendChild(script);
    
          script.addEventListener('load', function () {
            initWebXRManager();
          });
    
          script.addEventListener('error', function (err) {
            console.warn('Could not load the WebXR Polyfill script:', err);
          });
        }
        else
        {
          initWebXRManager();
        }
      }

      init();
    })();

}, 0);

Module['WebXR'].GetBrowserObject = function () {
  return Browser;
}

Module['WebXR'].GetJSEventsObject = function () {
  return JSEvents;
}

Module['WebXR'].OnStartAR = function (views_count, left_rect, right_rect) {
  Module.WebXR.isInXR = true;
  Module.dynCall_viffffffff(Module.WebXR.onStartARPtr, views_count,
                          left_rect.x, left_rect.y, left_rect.w, left_rect.h,
                          right_rect.x, right_rect.y, right_rect.w, right_rect.h);
}

Module['WebXR'].OnStartVR = function (views_count, left_rect, right_rect) {
  Module.WebXR.isInXR = true;
  Module.dynCall_viffffffff(Module.WebXR.onStartVRPtr, views_count,
                          left_rect.x, left_rect.y, left_rect.w, left_rect.h,
                          right_rect.x, right_rect.y, right_rect.w, right_rect.h);
}

Module['WebXR'].OnVisibilityChange = function (visibility_state) {
  var visibility_state_int = 0;
  if (visibility_state == "visible-blurred") {
    visibility_state_int = 1;
  } else if (visibility_state == "hidden") {
    visibility_state_int = 2;
  }
  Module.dynCall_vi(Module.WebXR.onVisibilityChangePtr, visibility_state_int);
}

Module['WebXR'].OnEndXR = function () {
  Module.WebXR.isInXR = false;
  Module.dynCall_v(Module.WebXR.onEndXRPtr);
}

Module['WebXR'].OnXRCapabilities = function (isARSupported, isVRSupported) {
  Module.dynCall_vii(Module.WebXR.onXRCapabilitiesPtr, isARSupported, isVRSupported);
}

Module['WebXR'].OnInputProfiles = function (input_profiles) {
  var strBufferSize = lengthBytesUTF8(input_profiles) + 1;
  var strBuffer = _malloc(strBufferSize);
  stringToUTF8(input_profiles, strBuffer, strBufferSize);
  Module.dynCall_vi(Module.WebXR.onInputProfilesPtr, strBuffer);
  _free(strBuffer);
}
