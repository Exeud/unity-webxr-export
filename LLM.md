# 📘 LLM Context — WebXR Export (WebGPU)

## 📌 Project Overview

**WebXR Export** is a Unity Engine XR Package/Provider for building immersive WebXR experiences using Unity 6 LTS. It integrates the WebXR JavaScript API into Unity Web (WebGPU) builds, allowing developers to create and export virtual and augmented reality content that runs in compatible web browsers.

This repo also includes sample projects and packages for added interactivity, such as XR Interaction Toolkit support and Mixed Reality Capture.

---

## 🎯 Purpose

This file is meant for **AI tools, contributors, and documentation generators** to understand the scope, structure, and usage of the repository, beyond the standard README. It’s designed to clarify key details that may not be fully obvious from code or folder names alone.

## 🧠 High-Level Functionality

* Exports Unity scenes and projects to WebGPU that support **WebXR immersive sessions**.
* Allows development using standard Unity workflows and C# scripting.
* Provides sample scenes and demos for reference and testing.

## 📦 Project Structure

Below are high-level directory purposes:

```
.github/                   – GitHub configs, workflows
ArtSources/                – Source art assets (if any)
Build/                     – Legacy demo
DebugProjects/             – Debug/test projects
Documentation/             – Docs and guides
MainProject/               – Core Unity project
Packages/                  – UPM packages (WebXR Export)
```

## 🛠 Tech Stack & Compatibility

* **Unity**: Supports Editor versions 6.3 LTS and up
* **WebXR**: Outputs WebGL/WebGPU builds compatible with WebXR APIs
* **Languages**: C# (Unity), JavaScript (WebXR glue code)
* **Key APIs**:

  * WebXR Device API
  * WebXR Hand Input & Gamepad Modules
  * Fallback WebXR Polyfill for unsupported browsers

## 🧾 Key Concepts for LLMs

**Immersive Session** – A WebXR session, accessed from VR, PC or mobile.

**UPM Packages** – Unity Package Manager packages; use OpenUPM registry or Git UPM import to include in projects.

**WebGLTemplates** – Provided templates that are required to build WebXR-compatible Unity Web output.

## 🚀 Getting Started (Basic Workflow)

1. **Import Packages**

   * Install `ExeudVR` and `WebXR Export` via OpenUPM.

2. **Configure WebXR**

   * Enable WebXR Export in **Project Settings → XR Plug-in Management → WebGL** and check `Use Web GPU` in the WebXR menu.

3. **Configure ExeudVR**

   * Use **Exeud → ExeudVRSetup** to add dependencies, add SDS and configure the editor.

4. **Load Sample Scene**

   * Choose a scene from `Assets/ExeudVR/Scenes`.

5. **Build & Serve**

   * Build to WebGPU/WebGL and host via HTTPS to enable WebXR (secure context required).

## 📚 Coding Conventions (General)

* Use consistent Unity coding standards.
* Keep platform-specific configuration in dedicated folders.
* Test WebGL builds often during development.
* Document any WebXR API changes in comments or issues.

## 🧪 How to Run (Example Steps)

In Unity:

* Import packages via Package Manager.
* Use provided templates and settings.
* Build for WebGL and test on a secure server (HTTPS).

## 🧩 Common Issues & Notes

* Some platforms (like certain iOS browsers) may have limited or no WebXR support.
* WebXR requires secure contexts (HTTPS).
* Projects may require manual configuration to enable specific features like hand tracking or hit tests.
* Unity XR SDK support is limited on web. Prefer Disable XR Display Subsystem in the WebXR Settings window, and use WebXRCamera component instead of the WebXRCameraSettings component.

## 🤝 Contribution Guidelines

* Open issues for bugs or feature requests using the templates.
* Follow Unity version compatibility notes.
* Reference documentation in PRs when adding features.
* Be aware this is an experimental project with evolving API support.

## 🏷 License

This project is licensed under the **Apache License, Version 2.0**.
