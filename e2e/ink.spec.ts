import { test, expect } from '@playwright/test';
import { MAIN, boot } from './helpers.js';
import { routeGen, identityOnlyBoot } from './fakes.js';

/**
 * SEAM H3 — ink is not paint, and the boot floor belongs to a boot screen that
 * exists.
 *
 * HANDOFF-4's headline: on `cerebras-oss120` roughly one boot generation in
 * three spends its whole budget on reasoning and emits the identity comment and
 * no document at all. Two instruments then hid it in opposite directions — the
 * kernel called the first chunk a "first paint" and reported 4,176 ms for a
 * frame that was black for its whole life, while the harness's text probe
 * reported nothing for boot screens that were fine. So the runtime now reports
 * INK (the first element with a box) as distinct from PAINT (the first chunk),
 * telemetry calls ink the first paint, and §12.3's 2.5 s floor holds a frame
 * only when there is something in it.
 *
 * The rule this file exists to hold: **a visitor waits for black exactly never.**
 */

test.describe('ink, and the reveal that does not hold black', () => {
  test('a boot stream that is only the identity comment reveals the desktop at once', async ({ page }) => {
    // `boot-ink-none`, faked at the network layer: the comment, then EOF
    const asked = await routeGen(page, { body: (req) => (req.kind === 'boot' ? identityOnlyBoot() : null) });
    await boot(page, MAIN + '/');

    // the identity still came out of the boot stream: no rescue round trip
    expect(asked[0].kind).toBe('boot');
    expect(asked.filter((a) => a.kind === 'identity')).toHaveLength(0);
    expect(asked.some((a) => a.kind === 'desktop')).toBe(true);

    const marks = await page.evaluate(() => ({
      ink: document.documentElement.getAttribute('data-os-boot-ink'),
      hold: document.documentElement.getAttribute('data-os-boot-hold-ms'),
      desktop: Number(document.documentElement.getAttribute('data-os-desktop-ms')),
      revealed: Number(document.documentElement.getAttribute('data-os-revealed-ms')),
    }));
    // the frame never inked, the kernel knows it, and nothing was held
    expect(marks.ink).toBe('none');
    expect(marks.hold).toBe('0');
    expect(marks.desktop).toBeGreaterThan(0);
    // the reveal is the desktop becoming interactive, not 2.5 s later
    expect(marks.revealed - marks.desktop).toBeLessThan(500);

    // and it really is gone, with a live desktop behind it
    await expect(page.locator('[data-os-boot]')).toHaveCount(0);
    await expect(page.locator('[data-os-taskbar]')).toHaveCount(1);
  });

  /**
   * The other half of the rule, and the reason it is not simply "reveal as soon
   * as the desktop is ready": a boot screen somebody can read still gets its
   * §12.3 floor, measured from ink rather than from the first chunk.
   */
  test('a boot screen that inks keeps its 2.5 s floor, measured from the ink', async ({ page }) => {
    await boot(page, MAIN + '/');
    const marks = await page.evaluate(() => ({
      ink: document.documentElement.getAttribute('data-os-boot-ink'),
      hold: Number(document.documentElement.getAttribute('data-os-boot-hold-ms')),
      revealed: Number(document.documentElement.getAttribute('data-os-revealed-ms')),
    }));
    expect(marks.ink).not.toBe('none');
    expect(Number(marks.ink)).toBeGreaterThan(0);
    // the mock's desktop is quick, so the floor is what decides the reveal
    expect(marks.revealed).toBeGreaterThanOrEqual(Number(marks.ink) + marks.hold - 200);
    expect(marks.revealed).toBeGreaterThan(2000);
  });

  /**
   * The runtime's side of it, watched directly: a document made only of a
   * `<style>` block has painted and has not inked, and one with a box has both.
   * This is the distinction the reveal rule stands on, so it is asserted on the
   * message stream rather than only through its consequences.
   */
  test('the runtime reports paint for a styleless chunk and ink only for a box', async ({ page }) => {
    await page.goto(MAIN + '/');
    await page.waitForSelector('[data-os-boot] iframe', { timeout: 30_000 });
    const seen = await page.evaluate(async () => {
      const msgs: string[] = [];
      // only OUR frame's messages: the real boot frame is streaming beside it
      // and reports a paint and an ink of its own
      const onMsg = (e: MessageEvent) => {
        const m: any = e.data;
        if (!m || m.__os !== 1 || e.source !== probe.contentWindow) return;
        if (m.t === 'paint' || m.t === 'ink') msgs.push(m.t);
      };
      // a frame of our own, wired the way the kernel wires one: the bootstrap
      // document plus chunks over postMessage
      const host = document.querySelector('[data-os-boot] iframe') as HTMLIFrameElement;
      const probe = document.createElement('iframe');
      probe.setAttribute('sandbox', 'allow-scripts');
      probe.style.cssText = 'position:fixed;left:0;top:0;width:300px;height:200px;opacity:0';
      probe.srcdoc = host.srcdoc;
      document.body.appendChild(probe);
      window.addEventListener('message', onMsg);
      const post = (m: any) => probe.contentWindow?.postMessage({ __os: 1, ...m }, '*');
      await new Promise<void>((r) => {
        const wait = (e: MessageEvent) => {
          if (e.source === probe.contentWindow && (e.data as any)?.t === 'ready') {
            window.removeEventListener('message', wait);
            r();
          }
        };
        window.addEventListener('message', wait);
        setTimeout(r, 5000);
      });
      post({ t: 'init', role: 'app', url: '', state: {} });
      post({ t: 'reset' });
      post({ t: 'chunk', d: '<style>body{background:#111}</style>' });
      await new Promise((r) => setTimeout(r, 400));
      const afterStyle = msgs.slice();
      post({ t: 'chunk', d: '<div style="width:80px;height:20px">now there is a box</div>' });
      post({ t: 'end' });
      await new Promise((r) => setTimeout(r, 600));
      const afterBox = msgs.slice();
      window.removeEventListener('message', onMsg);
      probe.remove();
      return { afterStyle, afterBox };
    });
    // a style block is a paint and not a pixel
    expect(seen.afterStyle).toContain('paint');
    expect(seen.afterStyle).not.toContain('ink');
    // the box is
    expect(seen.afterBox).toContain('ink');
    // and ink is reported exactly once per document
    expect(seen.afterBox.filter((t) => t === 'ink')).toHaveLength(1);
  });
});
