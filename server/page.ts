/**
 * The kernel page (SPEC §2.1): visually empty, black, full viewport, boots
 * immediately.
 *
 * `pin` (T1/D6) is the engine `/` is pinned to by DEFAULT_ENGINE, or ''. It is
 * stamped on `<body data-engine>` because the kernel's `chooseEngine` prefers
 * `auto` on `/` whenever /api/engines lists it, and a server-side default alone
 * therefore cannot take `/` off the router — one attribute the kernel can read
 * is the smallest honest seam for that. A kernel that does not read it ignores
 * the attribute, so this is safe to ship ahead of the kernel half. Never
 * stamped on the bake-off run page: there the engine is the judge's query.
 */
export function kernelPage(mode: 'plain' | 'bakeoff', buildId: string, pin = ''): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>&nbsp;</title>
<style>
  /* black and empty (SPEC §2.1). No colour opinion beyond that: the desktop is
     mounted into this document, so anything set here would be inherited by it. */
  html,body{margin:0;padding:0;height:100%;background:#000;overflow:hidden}
  #os-root{position:fixed;inset:0;overflow:hidden}
  #os-boot,#os-desk{position:absolute;inset:0}
  #os-boot iframe{border:0;width:100%;height:100%;display:block;background:#000}
  .os-kernel-screen{position:absolute;inset:0;background:#000;color:#c8c8c8;font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;padding:16px;z-index:2147483000}
</style>
</head>
<body data-mode="${mode}" data-build="${buildId}"${pin ? ` data-engine="${esc(pin)}"` : ''}>
<div id="os-root"></div>
<script src="/kernel.js?b=${buildId}"></script>
</body>
</html>
`;
}

/** Engine ids are `[a-z0-9-]` by construction; this is belt, not braces. */
const esc = (s: string) => s.replace(/[^a-zA-Z0-9_.:-]/g, '');

export const ROBOTS = `User-agent: *\nDisallow: /\n`;
