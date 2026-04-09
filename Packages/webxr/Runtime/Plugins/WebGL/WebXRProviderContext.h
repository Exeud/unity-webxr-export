#pragma once
#include "UnityHeaders/IUnityInterface.h"
#include "UnityHeaders/IUnityXRTrace.h"
#include "UnityHeaders/UnitySubsystemTypes.h"

#include <cassert>

extern "C"
{
  extern float *WebXRGetViewsDataArray();
}

struct IUnityXRTrace;
struct IUnityXRDisplayInterface;
struct IUnityXRInputInterface;

class WebXRDisplayProvider;
class WebXRDisplayProviderWebGPU;
class WebXRTrackingProvider;

// Forward-declare WebXRProviderContext so ProviderImpl can hold a reference to it.
struct WebXRProviderContext;

class ProviderImpl
{
public:
    ProviderImpl(WebXRProviderContext& ctx, UnitySubsystemHandle handle)
        : m_Ctx(ctx)
        , m_Handle(handle)
    {
    }
    virtual ~ProviderImpl() {}

    virtual UnitySubsystemErrorCode Initialize() = 0;
    virtual UnitySubsystemErrorCode Start() = 0;

    virtual void Stop() = 0;
    virtual void Shutdown() = 0;

protected:
    WebXRProviderContext& m_Ctx;
    UnitySubsystemHandle m_Handle;
};

struct WebXRProviderContext
{
    IUnityInterfaces* interfaces;
    IUnityXRTrace* trace;

    IUnityXRDisplayInterface* display;
    ProviderImpl* displayProvider;

    IUnityXRInputInterface* input;
    WebXRTrackingProvider* trackingProvider;
};

inline WebXRProviderContext& GetWebXRProviderContext(void* data)
{
    assert(data != NULL);
    return *static_cast<WebXRProviderContext*>(data);
}
