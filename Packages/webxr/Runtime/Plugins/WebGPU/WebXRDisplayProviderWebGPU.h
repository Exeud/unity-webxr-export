#pragma once
#include "../WebGL/WebXRProviderContext.h"
#include "../WebGL/UnityHeaders/IUnityXRDisplay.h"
#include <vector>

// WebGPU-specific XR display provider.
// Key differences from the WebGL SIDE_BY_SIDE provider:
//   - Allocates one texture per eye at per-eye resolution (no side-by-side layout).
//   - Sets skipPresentToMainScreen during XR to prevent the redundant canvas blit.
//   - Uses correct real-IPD culling separation instead of the hardcoded 0.625 guess.
//   - Supports dynamic resolution via textureResolutionScale hint.

UnitySubsystemErrorCode Load_Display_WebGPU(WebXRProviderContext&);

class WebXRDisplayProviderWebGPU : public ProviderImpl
{
public:
    WebXRDisplayProviderWebGPU(WebXRProviderContext& ctx, UnitySubsystemHandle handle)
        : ProviderImpl(ctx, handle)
        , m_ViewsDataArray(nullptr)
        , m_ViewWidth(0)
        , m_ViewHeight(0)
        , m_HasMultipleViews(true)
        , m_TransparentBackground(false)
        , m_InXRSession(false)
    {
        m_EyeSeparationHalf[0] = -0.03125f;
        m_EyeSeparationHalf[1] =  0.03125f;
    }

    UnitySubsystemErrorCode Initialize() override;
    UnitySubsystemErrorCode Start() override;

    UnitySubsystemErrorCode GfxThread_Start(UnityXRRenderingCapabilities& renderingCaps);
    UnitySubsystemErrorCode GfxThread_SubmitCurrentFrame();
    UnitySubsystemErrorCode GfxThread_PopulateNextFrameDesc(const UnityXRFrameSetupHints& frameHints, UnityXRNextFrameDesc& nextFrame);
    UnitySubsystemErrorCode GfxThread_Stop();
    UnitySubsystemErrorCode GfxThread_FinalBlitToGameViewBackBuffer(const UnityXRMirrorViewBlitInfo* mirrorBlitInfo);

    UnitySubsystemErrorCode UpdateDisplayState(UnityXRDisplayState* state);

    void Stop() override;
    void Shutdown() override;

    void NotifyXRSessionActive(bool active) { m_InXRSession = active; }

private:
    void CreateTextures(int numTextures, int textureArrayLength, float requestedTextureScale);
    void DestroyTextures();

    UnityXRPose      GetPose(int eye);
    UnityXRProjection GetProjection(int eye);

private:
    std::vector<UnityXRRenderTextureId> m_UnityTextures;
    float*  m_ViewsDataArray;
    float   m_ViewWidth;
    float   m_ViewHeight;
    float   m_EyeSeparationHalf[2];
    bool    m_HasMultipleViews;
    bool    m_TransparentBackground;
    bool    m_InXRSession;
};
