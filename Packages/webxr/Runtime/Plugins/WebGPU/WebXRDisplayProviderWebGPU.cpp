#include "WebXRDisplayProviderWebGPU.h"
#include "../WebGL/UnityHeaders/IUnityXRDisplay.h"

#include <cmath>
#include <cstdio>

#define NUM_RENDER_PASSES_WEBGPU 2

// BEGIN WORKAROUND: skip first frame since we get invalid data.
static bool s_SkipFrameWebGPU = true;
#define WORKAROUND_SKIP_FIRST_FRAME_WEBGPU()        \
    if (s_SkipFrameWebGPU)                          \
    {                                               \
        s_SkipFrameWebGPU = false;                  \
        return kUnitySubsystemErrorCodeSuccess;     \
    }
#define WORKAROUND_RESET_SKIP_FIRST_FRAME_WEBGPU() s_SkipFrameWebGPU = true;
// END WORKAROUND

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

UnitySubsystemErrorCode WebXRDisplayProviderWebGPU::Initialize()
{
    return kUnitySubsystemErrorCodeSuccess;
}

UnitySubsystemErrorCode WebXRDisplayProviderWebGPU::Start()
{
    m_ViewsDataArray = WebXRGetViewsDataArray();

    m_ViewWidth          = *(m_ViewsDataArray + 46);
    m_ViewHeight         = *(m_ViewsDataArray + 47);
    m_HasMultipleViews   = *(m_ViewsDataArray + 54) > 1;

    if (m_HasMultipleViews)
    {
        float dx = *(m_ViewsDataArray + 40) - *(m_ViewsDataArray + 43);
        float dy = *(m_ViewsDataArray + 41) - *(m_ViewsDataArray + 44);
        float dz = *(m_ViewsDataArray + 42) - *(m_ViewsDataArray + 45);
        float halfIPD = 0.5f * sqrtf(dx*dx + dy*dy + dz*dz);
        m_EyeSeparationHalf[0] = -halfIPD;
        m_EyeSeparationHalf[1] =  halfIPD;
    }
    else
    {
        m_EyeSeparationHalf[0] = 0.0f;
        m_EyeSeparationHalf[1] = 0.0f;
    }

    m_TransparentBackground = *(m_ViewsDataArray + 55) > 0;
    m_InXRSession = true;
    return kUnitySubsystemErrorCodeSuccess;
}

void WebXRDisplayProviderWebGPU::Stop()
{
    m_InXRSession = false;
}

void WebXRDisplayProviderWebGPU::Shutdown()
{
    DestroyTextures();
}

// ---------------------------------------------------------------------------
// Graphics thread
// ---------------------------------------------------------------------------

UnitySubsystemErrorCode WebXRDisplayProviderWebGPU::GfxThread_Start(UnityXRRenderingCapabilities& renderingCaps)
{
    // Multi-pass stereo: one pass per eye, each into its own texture.
    // Single-pass instanced (texture array) is left for a future iteration.
    renderingCaps.noSinglePassRenderingSupport = true;
    renderingCaps.invalidateRenderStateAfterEachCallback = false;

    // Do NOT set skipPresentToMainScreen: GfxThread_Start fires once and Unity
    // latches the flag with no API to update it later. Setting it true causes a
    // permanent white screen after session exit. Unity presenting its WebGPU
    // canvas during XR is a minor overhead; the XR compositor gets its content
    // from the JS blit into XRGPUSubImage textures regardless.
    renderingCaps.skipPresentToMainScreen = false;

    return kUnitySubsystemErrorCodeSuccess;
}

UnitySubsystemErrorCode WebXRDisplayProviderWebGPU::GfxThread_SubmitCurrentFrame()
{
    return kUnitySubsystemErrorCodeSuccess;
}

UnitySubsystemErrorCode WebXRDisplayProviderWebGPU::GfxThread_PopulateNextFrameDesc(
    const UnityXRFrameSetupHints& frameHints, UnityXRNextFrameDesc& nextFrame)
{
    // Guard: don't allocate or render into textures after the session has ended.
    if (!m_InXRSession)
        return kUnitySubsystemErrorCodeSuccess;

    WORKAROUND_SKIP_FIRST_FRAME_WEBGPU();

    bool reallocateTextures = (m_UnityTextures.size() == 0);
    if ((kUnityXRFrameSetupHintsChangedSinglePassRendering & frameHints.changedFlags) != 0)
        reallocateTextures = true;
    if ((kUnityXRFrameSetupHintsChangedTextureResolutionScale & frameHints.changedFlags) != 0)
        reallocateTextures = true;

    if (reallocateTextures)
    {
        DestroyTextures();
        // One texture per eye, each at per-eye resolution.
        int numTextures = m_HasMultipleViews ? NUM_RENDER_PASSES_WEBGPU : 1;
        CreateTextures(numTextures, 0, frameHints.appSetup.textureResolutionScale);
    }

    // Multi-pass: one render pass per eye.
    nextFrame.renderPassesCount = m_HasMultipleViews ? NUM_RENDER_PASSES_WEBGPU : 1;

    for (int pass = 0; pass < nextFrame.renderPassesCount; ++pass)
    {
        auto& renderPass = nextFrame.renderPasses[pass];

        // Each eye renders into its own dedicated texture.
        renderPass.textureId       = m_UnityTextures[pass];
        renderPass.renderParamsCount = 1;
        renderPass.cullingPassIndex  = pass;

        auto& cullingPass = nextFrame.cullingPasses[pass];
        cullingPass.separation =
            fabsf(m_EyeSeparationHalf[1]) + fabsf(m_EyeSeparationHalf[0]);

        auto& renderParams = renderPass.renderParams[0];
        renderParams.deviceAnchorToEyePose =
            cullingPass.deviceAnchorToCullingPose = GetPose(pass);
        renderParams.projection =
            cullingPass.projection = GetProjection(pass);

        // Full viewport — each texture is exactly one eye's resolution.
        renderParams.viewportRect = frameHints.appSetup.renderViewport;
    }

    return kUnitySubsystemErrorCodeSuccess;
}

UnitySubsystemErrorCode WebXRDisplayProviderWebGPU::GfxThread_Stop()
{
    WORKAROUND_RESET_SKIP_FIRST_FRAME_WEBGPU();
    // Do NOT call DestroyTextures() here: GfxThread_Stop fires on the gfx thread
    // while PopulateNextFrameDesc may still be in the same dispatch cycle. Destroying
    // textures mid-cycle causes Unity to immediately re-create them with zero or
    // stale dimensions, producing 'size is zero' WebGPU validation errors.
    // Textures are destroyed in Shutdown() which fires after the gfx thread is done.
    return kUnitySubsystemErrorCodeSuccess;
}

UnitySubsystemErrorCode WebXRDisplayProviderWebGPU::GfxThread_FinalBlitToGameViewBackBuffer(
    const UnityXRMirrorViewBlitInfo* /*mirrorBlitInfo*/)
{
    // Suppress mirror-view blit during XR: the compositor reads directly from
    // XRGPUSubImage textures that the JS blit has already populated.
    return kUnitySubsystemErrorCodeSuccess;
}

UnitySubsystemErrorCode WebXRDisplayProviderWebGPU::UpdateDisplayState(UnityXRDisplayState* state)
{
    state->displayIsTransparent = m_TransparentBackground;
    return kUnitySubsystemErrorCodeSuccess;
}

// ---------------------------------------------------------------------------
// Texture management
// ---------------------------------------------------------------------------

void WebXRDisplayProviderWebGPU::CreateTextures(
    int numTextures, int textureArrayLength, float requestedTextureScale)
{
    const int texWidth  = (int)(m_ViewWidth  * requestedTextureScale);
    const int texHeight = (int)(m_ViewHeight * requestedTextureScale);

    m_UnityTextures.resize(numTextures);

    for (int i = 0; i < numTextures; ++i)
    {
        UnityXRRenderTextureDesc uDesc{};
        uDesc.color.nativePtr  = (void*)kUnityXRRenderTextureIdDontCare;
        uDesc.width            = texWidth  > 0 ? texWidth  : (int)m_ViewWidth;
        uDesc.height           = texHeight > 0 ? texHeight : (int)m_ViewHeight;
        uDesc.textureArrayLength = textureArrayLength;

        UnityXRRenderTextureId uTexId;
        m_Ctx.display->CreateTexture(m_Handle, &uDesc, &uTexId);
        m_UnityTextures[i] = uTexId;
    }
}

void WebXRDisplayProviderWebGPU::DestroyTextures()
{
    for (int i = 0; i < (int)m_UnityTextures.size(); ++i)
    {
        if (m_UnityTextures[i] != 0)
            m_Ctx.display->DestroyTexture(m_Handle, m_UnityTextures[i]);
    }
    m_UnityTextures.clear();
}

// ---------------------------------------------------------------------------
// Pose / projection helpers
// ---------------------------------------------------------------------------

UnityXRPose WebXRDisplayProviderWebGPU::GetPose(int eye)
{
    UnityXRPose pose{};
    pose.position.x = m_EyeSeparationHalf[eye < 2 ? eye : 0];
    pose.position.y = 0.0f;
    pose.position.z = 0.0f;
    pose.rotation.x = 0.0f;
    pose.rotation.y = 0.0f;
    pose.rotation.z = 0.0f;
    pose.rotation.w = 1.0f;
    return pose;
}

UnityXRProjection WebXRDisplayProviderWebGPU::GetProjection(int eye)
{
    UnityXRProjection ret;
    ret.type = kUnityXRProjectionTypeMatrix;
    int start = eye * 16;
    ret.data.matrix.columns[0].x = *(m_ViewsDataArray + start);
    ret.data.matrix.columns[0].y = *(m_ViewsDataArray + start + 1);
    ret.data.matrix.columns[0].z = *(m_ViewsDataArray + start + 2);
    ret.data.matrix.columns[0].w = *(m_ViewsDataArray + start + 3);
    ret.data.matrix.columns[1].x = *(m_ViewsDataArray + start + 4);
    ret.data.matrix.columns[1].y = *(m_ViewsDataArray + start + 5);
    ret.data.matrix.columns[1].z = *(m_ViewsDataArray + start + 6);
    ret.data.matrix.columns[1].w = *(m_ViewsDataArray + start + 7);
    ret.data.matrix.columns[2].x = *(m_ViewsDataArray + start + 8);
    ret.data.matrix.columns[2].y = *(m_ViewsDataArray + start + 9);
    ret.data.matrix.columns[2].z = *(m_ViewsDataArray + start + 10);
    ret.data.matrix.columns[2].w = *(m_ViewsDataArray + start + 11);
    ret.data.matrix.columns[3].x = *(m_ViewsDataArray + start + 12);
    ret.data.matrix.columns[3].y = *(m_ViewsDataArray + start + 13);
    ret.data.matrix.columns[3].z = *(m_ViewsDataArray + start + 14);
    ret.data.matrix.columns[3].w = *(m_ViewsDataArray + start + 15);
    return ret;
}

// ---------------------------------------------------------------------------
// C-API binding — mirrors the WebGL Load_Display pattern
// ---------------------------------------------------------------------------

UnitySubsystemErrorCode Load_Display_WebGPU(WebXRProviderContext& ctx)
{
    ctx.display = ctx.interfaces->Get<IUnityXRDisplayInterface>();
    if (ctx.display == nullptr)
        return kUnitySubsystemErrorCodeFailure;

    UnityLifecycleProvider displayLifecycleHandler{};
    displayLifecycleHandler.userData = &ctx;

    displayLifecycleHandler.Initialize = [](UnitySubsystemHandle handle, void* userData) -> UnitySubsystemErrorCode
    {
        auto& ctx = GetWebXRProviderContext(userData);
        ctx.displayProvider = new WebXRDisplayProviderWebGPU(ctx, handle);

        UnityXRDisplayGraphicsThreadProvider gfxThreadProvider{};
        gfxThreadProvider.userData = &ctx;

        gfxThreadProvider.Start = [](UnitySubsystemHandle handle, void* userData, UnityXRRenderingCapabilities* renderingCaps) -> UnitySubsystemErrorCode
        {
            auto& ctx = GetWebXRProviderContext(userData);
            return static_cast<WebXRDisplayProviderWebGPU*>(ctx.displayProvider)->GfxThread_Start(*renderingCaps);
        };

        gfxThreadProvider.SubmitCurrentFrame = [](UnitySubsystemHandle handle, void* userData) -> UnitySubsystemErrorCode
        {
            auto& ctx = GetWebXRProviderContext(userData);
            return static_cast<WebXRDisplayProviderWebGPU*>(ctx.displayProvider)->GfxThread_SubmitCurrentFrame();
        };

        gfxThreadProvider.PopulateNextFrameDesc = [](UnitySubsystemHandle handle, void* userData, const UnityXRFrameSetupHints* frameHints, UnityXRNextFrameDesc* nextFrame) -> UnitySubsystemErrorCode
        {
            auto& ctx = GetWebXRProviderContext(userData);
            return static_cast<WebXRDisplayProviderWebGPU*>(ctx.displayProvider)->GfxThread_PopulateNextFrameDesc(*frameHints, *nextFrame);
        };

        gfxThreadProvider.Stop = [](UnitySubsystemHandle handle, void* userData) -> UnitySubsystemErrorCode
        {
            auto& ctx = GetWebXRProviderContext(userData);
            return static_cast<WebXRDisplayProviderWebGPU*>(ctx.displayProvider)->GfxThread_Stop();
        };

        gfxThreadProvider.BlitToMirrorViewRenderTarget = [](UnitySubsystemHandle handle, void* userData, const UnityXRMirrorViewBlitInfo mirrorBlitInfo) -> UnitySubsystemErrorCode
        {
            auto& ctx = GetWebXRProviderContext(userData);
            return static_cast<WebXRDisplayProviderWebGPU*>(ctx.displayProvider)->GfxThread_FinalBlitToGameViewBackBuffer(&mirrorBlitInfo);
        };

        ctx.display->RegisterProviderForGraphicsThread(handle, &gfxThreadProvider);

        UnityXRDisplayProvider provider{&ctx, nullptr, nullptr};
        provider.UpdateDisplayState = [](UnitySubsystemHandle handle, void* userData, UnityXRDisplayState* state) -> UnitySubsystemErrorCode
        {
            auto& ctx = GetWebXRProviderContext(userData);
            return static_cast<WebXRDisplayProviderWebGPU*>(ctx.displayProvider)->UpdateDisplayState(state);
        };

        ctx.display->RegisterProvider(handle, &provider);
        return static_cast<WebXRDisplayProviderWebGPU*>(ctx.displayProvider)->Initialize();
    };

    displayLifecycleHandler.Start = [](UnitySubsystemHandle handle, void* userData) -> UnitySubsystemErrorCode
    {
        auto& ctx = GetWebXRProviderContext(userData);
        return ctx.displayProvider->Start();
    };

    displayLifecycleHandler.Stop = [](UnitySubsystemHandle handle, void* userData) -> void
    {
        auto& ctx = GetWebXRProviderContext(userData);
        ctx.displayProvider->Stop();
    };

    displayLifecycleHandler.Shutdown = [](UnitySubsystemHandle handle, void* userData) -> void
    {
        auto& ctx = GetWebXRProviderContext(userData);
        ctx.displayProvider->Shutdown();
        delete ctx.displayProvider;
        ctx.displayProvider = nullptr;
    };

    return ctx.display->RegisterLifecycleProvider("WebXR Export", "WebXR Display", &displayLifecycleHandler);
}
