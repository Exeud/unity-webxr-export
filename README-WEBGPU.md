# WebXR Export — WebGL/WebGPU Display Provider
## Overview

Unity 6's WebGL build can target either WebGL2 or WebGPU as its graphics backend. The upstream `unity-webxr-export` package was written exclusively for the WebGL2 path. This extension adds:

- A **second C++ XR display provider** (`WebXRDisplayProviderWebGPU`) for the WebGPU render path
- **Runtime detection** — the correct provider is selected at startup without any compile-time flag
- A **`UseWebGPU` setting** in `WebXRSettings` to control the session request strategy
- **Session lifecycle robustness** — correct enter, frame, and exit behaviour for both render paths
- **Automatic WebGL fallback** — when `XRGPUBinding` is unavailable (e.g. browser emulator, pre-135 Chrome), the session transparently switches to a WebGL layer without restarting

---

## Browser Requirements

| Feature | Requirement |
|---------|-------------|
| **WebGPU path (full)** | Chrome 135+ with WebGPU enabled; `XRGPUBinding` available |
| **WebGL path (native)** | Any WebXR browser — Wolvic, Firefox with emulator extension, Chrome |
| **WebGPU→WebGL fallback** | Any WebXR browser with WebGL2 — activates automatically when `XRGPUBinding` is absent |

---

## Architecture

### Layer overview

```
C# / Unity Editor
  └─ WebXRSettings.cs         UseWebGPU toggle, serialised to JSON for JS
  └─ WebXRLoader.cs           XR subsystem bootstrap → RegisterWebXRPlugin() → UnityPluginLoad

JavaScript (webxr.jspre — Emscripten pre-JS)
  ├─ requestAdapter patch      Intercepts navigator.gpu.requestAdapter, forces xrCompatible:true
  │                            Captures GPUDevice; calls WebXRSetIsWebGPU(1) immediately
  ├─ GPUCanvasContext patch     Adds COPY_SRC to every canvas configure() call for blit path
  ├─ setGameModule              Runtime isWebGPUMode detection; handles deferred flag
  ├─ onRequestVRSession         Builds requiredFeatures/optionalFeatures; uses _nativeXR for WebGPU
  ├─ onSessionStarted           Creates XRGPUBinding + XRProjectionLayer; or applyWebGLFallback
  ├─ animate()                  Per-frame: pose → HEAPF32; acquires XRGPUSubImage textures
  └─ onEndSession               Cleans up binding, layer, fallback ctx; restores canvas

C++ (Emscripten/WASM)
  ├─ WebXRMain.cpp              UnityPluginLoad — selects display provider via s_IsWebGPU flag
  ├─ WebXRDisplayProvider.cpp   WebGL SIDE_BY_SIDE display provider (unchanged, upstream)
  └─ WebXRDisplayProviderWebGPU.cpp  New: per-eye multi-pass provider for WebGPU

HTML template
  └─ index.html                 Inline script saves window._nativeXR before any extension loads
```

### How the blit path works

Unity renders into its WebGPU canvas swap chain as normal. In `animate()`, before Unity's main loop tick, the JS layer calls `xrGpuBinding.getViewSubImage()` per eye, acquiring `XRGPUSubImage` objects valid for the current `XRFrame`. The JS blit function (`_xrBlitToCompositor`) then executes a `copyTextureToTexture` from the canvas texture into each eye's subimage texture, delivering the rendered frame to the XR compositor.

This is the **Option B (blit)** strategy from the original plan. Option A (render pass redirection) was evaluated but not pursued: Unity's WebGPU encoder does not route final render passes through a JS-interceptable `beginRenderPass` on the canvas texture in a reliable way.

---

## File Inventory

### New files

| File | Role |
|------|------|
| `Packages/webxr/Runtime/Plugins/WebGPU/WebXRDisplayProviderWebGPU.h` | Class declaration: per-eye textures, session state, IPD calculation |
| `Packages/webxr/Runtime/Plugins/WebGPU/WebXRDisplayProviderWebGPU.cpp` | Full implementation: lifecycle, texture management, pose/projection helpers, C-API binding |

### Modified files

| File | Change summary |
|------|---------------|
| `Packages/webxr/Runtime/Plugins/WebGL/WebXRMain.cpp` | Added `WebXRSetIsWebGPU` C export; runtime `s_IsWebGPU` flag selects provider in `UnityPluginLoad` |
| `Packages/webxr/Runtime/Plugins/WebGL/WebXRProviderContext.h` | Added `ProviderImpl` base class; `displayProvider` field is `ProviderImpl*` (holds either provider) |
| `Packages/webxr/Runtime/Plugins/WebGL/WebXRDisplayProvider.cpp` | `static_cast<WebXRDisplayProvider*>` for GfxThread calls; public inheritance for `ProviderImpl` |
| `Packages/webxr/Runtime/Plugins/WebGL/webxr.jspre` | All JS changes — see below |
| `Packages/webxr/Runtime/XRPlugin/WebXRSettings.cs` | Added `UseWebGPU` bool; serialised in `ToJson()` |

### Host project (not in submodule)

| File | Role |
|------|------|
| `Assets/WebGLTemplates/ExeudVR/index.html` | Saves `window._nativeXR` before extensions load |

---

## JavaScript Changes (`webxr.jspre`)

### Top-of-file patches (before Unity initialises)

**`requestAdapter` intercept** — wraps `navigator.gpu.requestAdapter` to force `xrCompatible: true` on every adapter request. When Unity's device is created, the callback stores it as `Module['WebXR'].gpuDevice` and calls `WebXRSetIsWebGPU(1)` via `ccall`. This is the earliest reliable detection point — before `UnityPluginLoad`.

**`GPUCanvasContext.configure` intercept** — adds `GPUTextureUsage.COPY_SRC` to every canvas configure call so `copyTextureToTexture` can read from the swap chain texture during the blit.

### `setGameModule`

`isWebGPUMode` detection uses an affirmative check:

```js
var isWebGPUMode = !thisXRMananger.ctx
  || (typeof GPUCanvasContext !== 'undefined' && thisXRMananger.ctx instanceof GPUCanvasContext);
```

Negated `instanceof` checks were deliberately avoided — they incorrectly classify unknown/proxied contexts (such as Wolvic's wrapped GL context) as WebGPU.

The `BrowserObject.requestAnimationFrame` intercept routes XR frames through `session.requestAnimationFrame` while `xrSession.isInSession` is true, keeping Unity's main loop synchronised with the XR compositor cadence.

### `onRequestVRSession`

When `UseWebGPU` is true, `'webgpu'` is added to `vrOptionalFeatures`. The session request uses `window._nativeXR` (saved in the HTML template before any extension can replace `navigator.xr`) to bypass the WebXR emulator's synthetic session, which is incompatible with `XRGPUBinding`.

### `onSessionStarted` — WebGPU path

1. Pre-XR canvas dimensions are saved for restoration on exit.
2. `isWebGPUFallback` is cleared.
3. If `gpuDevice` is absent or `XRGPUBinding` is undefined, `applyWebGLFallback()` is called.
4. Otherwise, `new XRGPUBinding(session, gpuDevice)` and `binding.createProjectionLayer()` are attempted. Any exception triggers `applyWebGLFallback()`.
5. Layer format uses `navigator.gpu.getPreferredCanvasFormat()` (not `binding.getPreferredColorFormat()`) to ensure `copyTextureToTexture` format compatibility.
6. `session.updateRenderState({ layers: [projectionLayer] })` replaces `baseLayer`.

**WebGL fallback (`applyWebGLFallback`):** creates a dedicated offscreen canvas (the main canvas cannot provide WebGL2 while a WebGPU context is active), acquires a `webgl2` context with `xrCompatible: true`, creates `XRWebGLLayer`, sets `isWebGPUMode = false`, and marks `isWebGPUFallback = true`. The main canvas is not resized — Unity continues rendering to its WebGPU swap chain.

### `animate` — WebGPU path

Per-frame subimage acquisition runs before Unity's tick:

```js
if (this.isWebGPUMode && this.xrGpuBinding && this.xrGpuProjectionLayer) {
  for (var si = 0; si < pose.views.length; si++) {
    var subImg = this.xrGpuBinding.getViewSubImage(this.xrGpuProjectionLayer, pose.views[si]);
    // stored as xrSubImageLeft / xrSubImageRight
  }
}
```

These `XRGPUSubImage` objects are only valid within the current `XRFrame` callback. They are consumed by `_xrBlitToCompositor` which runs after Unity's render commands have been submitted.

### `onEndSession` — three-way exit state

| State | `isWebGPUFallback` | `ctx` | Action |
|-------|--------------------|-------|--------|
| True WebGPU mode | `false` | `null` | Nothing to unbind |
| WebGPU→WebGL fallback | `true` | offscreen GL ctx | Null `ctx`; restore `isWebGPUMode = true` |
| Native WebGL session | `false` | Unity GL ctx | `bindFramebuffer(FRAMEBUFFER, null)` |

Canvas dimensions are restored from the saved `preXRCanvasWidth`/`preXRCanvasHeight` inside a `setTimeout`, deferring the resize until after the DOM has reflowed post-XR (reading `clientWidth`/`clientHeight` synchronously during the `'end'` event returns zero height on some browsers).

---

## C++ Changes

### `WebXRDisplayProviderWebGPU`

A new `ProviderImpl` subclass registered via `Load_Display_WebGPU()`.

**Key design decisions:**

- **Multi-pass per-eye, not SIDE_BY_SIDE.** The WebGL provider renders both eyes into one texture with viewport halving. The WebGPU provider allocates one texture per eye at full per-eye resolution, eliminating the half-width split. `GfxThread_PopulateNextFrameDesc` issues `NUM_RENDER_PASSES_WEBGPU = 2` passes.

- **IPD from pose data.** Eye separation is computed from the actual view position vectors in `m_ViewsDataArray`, not a hardcoded constant.

- **`skipPresentToMainScreen = false`.** `GfxThread_Start` fires once; Unity latches this flag permanently. Setting it `true` causes a white screen after session exit with no API to recover. The minor overhead of Unity presenting its canvas during XR is considered acceptable — the XR compositor reads from the subimage textures, not the canvas.

- **`DestroyTextures()` in `Shutdown()`, not `GfxThread_Stop()`.** `GfxThread_Stop` fires on the graphics thread while `PopulateNextFrameDesc` may still be in the same dispatch cycle. Destroying textures mid-cycle triggers Unity to reallocate them at zero/stale dimensions. `Shutdown()` fires after the graphics thread is fully wound down.

- **`m_InXRSession` guard in `PopulateNextFrameDesc`.** `Stop()` (main thread) sets `m_InXRSession = false` before `GfxThread_Stop` fires. The guard prevents any trailing `PopulateNextFrameDesc` dispatch from allocating textures with stale dimensions.

### `WebXRMain.cpp`

```cpp
extern "C" void UNITY_INTERFACE_EXPORT WebXRSetIsWebGPU(int isWebGPU)
{
    s_IsWebGPU = (isWebGPU != 0);
}

// In UnityPluginLoad:
if (s_IsWebGPU)
    Load_Display_WebGPU(*ctx);
else
    Load_Display(*ctx);
```

`WebXRSetIsWebGPU` is callable from JS via `Module.ccall` at device-creation time, before `RegisterWebXRPlugin` → `UnityPluginLoad` fires.

### `WebXRProviderContext.h`

`ProviderImpl` base class introduced so `WebXRProviderContext::displayProvider` can hold either provider type without a union or `void*`. Both providers inherit `ProviderImpl` publicly so `static_cast` in `WebXRDisplayProvider.cpp`'s GfxThread lambdas remains valid.

---

## Session Enter/Exit Sequence

```
User clicks "Enter VR"
  JS: onRequestVRSession
    → session.requestSession('immersive-vr', { requiredFeatures: ['webgpu', ...] })
    → onSessionStarted(session)
      → save preXRCanvasWidth / preXRCanvasHeight
      → clear isWebGPUFallback
      → attempt XRGPUBinding + XRProjectionLayer
        ← success → session.updateRenderState({ layers: [projectionLayer] })
        ← failure → applyWebGLFallback() → XRWebGLLayer → isWebGPUFallback = true
      → session.addEventListener('end', onEndSession)
      → poseRaf loop: wait for first valid pose
      → BrowserObject.mainLoop.resume()

Per frame (BrowserObject.requestAnimationFrame intercept)
  → session.requestAnimationFrame → animate(xrFrame)
  → pose → HEAPF32 shared arrays
  → (WebGPU) getViewSubImage → xrSubImageLeft / xrSubImageRight
  → Unity main loop tick (renders to canvas / per-eye textures)
  → (WebGPU) _xrBlitToCompositor: copyTextureToTexture canvas → subimage

User exits VR (headset menu or emulator button → session 'end' event)
  JS: onEndSession
    → OnEndXR() → C# WebXRManager.OnEndXR
    → clear xrGpuBinding, xrGpuProjectionLayer, xrGpuCanvasCtx, subimage refs
    → branch on isWebGPUFallback / ctx / isWebGPUMode
    → setTimeout: restore canvas to preXRCanvasWidth / preXRCanvasHeight
    → BrowserObject.mainLoop.resume()
  C++: Stop() → m_InXRSession = false
       GfxThread_Stop() → reset skip-first-frame flag
       Shutdown() → DestroyTextures()
```

---

## Configuration

In the Unity Editor, open **Project Settings → XR Plug-in Management → WebXR**:

| Setting | Effect |
|---------|--------|
| `UseWebGPU` | Adds `'webgpu'` to optional XR session features; activates WebGPU display provider at runtime |
| `VRRequiredReferenceSpace` | Reference space type for immersive-vr (default: `local-floor`) |
| `UseFramebufferScaleFactor` | Override render resolution (applies to both WebGL and WebGPU fallback layer) |

`UseWebGPU = false` completely bypasses all WebGPU code paths. The project will build and run identically to the upstream package.

---

## Known Limitations

- **`XRGPUBinding` requires a native `XRSession`.** The Firefox WebXR emulator extension provides a synthetic session that is rejected by `XRGPUBinding`. The fallback to `XRWebGLLayer` is automatic and transparent to the user.
- **Depth texture not delivered to compositor.** `XRGPUSubImage.depthStencilTexture` is not currently used. The compositor performs no depth-based reprojection.
- **Single-pass instanced rendering not supported.** The WebGPU provider uses multi-pass (one pass per eye). Texture array instanced rendering is a future iteration.
- **`skipPresentToMainScreen` is permanently false.** Unity presents its WebGPU canvas to the HTML page during XR sessions. This is a minor visual and performance overhead with no correctness impact.
