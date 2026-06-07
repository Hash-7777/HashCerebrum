import { useMemo } from 'react';

// Best-effort WebGL + GPU-quality probe. A missing context or a software
// renderer (SwiftShader / llvmpipe / "software") means no usable GPU.
function gpuIsWeakOrAbsent(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return true;
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '';
    return /swiftshader|llvmpipe|software|basic render/i.test(renderer);
  } catch {
    return true;
  }
}

/**
 * Heuristic: should this machine avoid the heavy 3D scene? True when the device
 * reports ≤ 4 GB RAM, has no usable GPU (or a software renderer), or is a
 * low-core machine that also asks for reduced motion. Used to default the app
 * into a lightweight 2D "Lite mode" so it runs full-speed on weak hardware.
 * Evaluated once per mount (hardware does not change mid-session).
 */
export function useLowEndDevice(): boolean {
  return useMemo(() => {
    if (typeof navigator === 'undefined') return false;
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    const cores = navigator.hardwareConcurrency;
    const reduced =
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const lowMem = typeof mem === 'number' && mem <= 4;
    const lowCores = typeof cores === 'number' && cores <= 4;
    return lowMem || gpuIsWeakOrAbsent() || (lowCores && reduced);
  }, []);
}
