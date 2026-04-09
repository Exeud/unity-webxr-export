#include "UnityHeaders/IUnityInterface.h"
#include "UnityHeaders/IUnityXRTrace.h"
#include "UnityHeaders/UnitySubsystemTypes.h"

#include <stdio.h>

#include "WebXRProviderContext.h"

static WebXRProviderContext* s_Context{};

UnitySubsystemErrorCode Load_Display(WebXRProviderContext&);
UnitySubsystemErrorCode Load_Display_WebGPU(WebXRProviderContext&);
UnitySubsystemErrorCode Load_Input(WebXRProviderContext&);

// Set by JS (webxr.jspre) via Module.ccall('WebXRSetIsWebGPU') before the
// XR plugin registers its lifecycle providers.  Avoids any compile-time define.
static bool s_IsWebGPU = false;

extern "C" void UNITY_INTERFACE_EXPORT WebXRSetIsWebGPU(int isWebGPU)
{
    s_IsWebGPU = (isWebGPU != 0);
    printf("[WebXR] WebXRSetIsWebGPU: %d\n", isWebGPU);
}

static bool ReportError(const char* name, UnitySubsystemErrorCode err)
{
    if (err != kUnitySubsystemErrorCodeSuccess)
    {
        XR_TRACE_ERROR(s_Context->trace, "Error loading subsystem: %s (%d)\n", name, err);
        return true;
    }
    return false;
}

extern "C" void UNITY_INTERFACE_EXPORT UNITY_INTERFACE_API
UnityPluginLoad(IUnityInterfaces* unityInterfaces)
{
    auto* ctx = s_Context = new WebXRProviderContext;

    ctx->interfaces = unityInterfaces;
    ctx->trace = unityInterfaces->Get<IUnityXRTrace>();

    if (s_IsWebGPU)
    {
        if (ReportError("Display", Load_Display_WebGPU(*ctx)))
            return;
    }
    else
    {
        if (ReportError("Display", Load_Display(*ctx)))
            return;
    }

    if (ReportError("Input", Load_Input(*ctx)))
        return;
}

extern "C" void UNITY_INTERFACE_EXPORT UNITY_INTERFACE_API
UnityPluginUnload()
{
    delete s_Context;
}

typedef void    (UNITY_INTERFACE_API * PluginLoadFunc)(IUnityInterfaces* unityInterfaces);
typedef void    (UNITY_INTERFACE_API * PluginUnloadFunc)();
extern "C" void UnityRegisterRenderingPlugin(PluginLoadFunc loadPlugin, PluginUnloadFunc unloadPlugin);

extern "C" void UNITY_INTERFACE_EXPORT UNITY_INTERFACE_API RegisterWebXRPlugin()
{
    printf("RegisterWebXRPlugin\n");
    UnityRegisterRenderingPlugin(UnityPluginLoad, UnityPluginUnload);
}
