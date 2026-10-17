/**
 * The one visual opinion the kernel is allowed about a picture it injected: it
 * appears rather than pops.
 *
 * BAKEOFF-2: "the desktop is revealed with grey empty icon tiles and no
 * wallpaper, and the pictures land 2-7 s later". They land on a desktop someone
 * is already looking at, and a hard cut is read as a glitch. This is an opacity
 * transition on the element carrying the kernel's own background and nothing
 * else — no colour, no size, no position, and nothing that can reflow a
 * launcher (opacity never does).
 *
 * The inline styles are removed when the transition is over, so whatever the
 * model chose is what stays.
 */
export const FADE_MS = 420;

export function fadeIn(el: HTMLElement, ms: number = FADE_MS): void {
  const prevTransition = el.style.transition;
  const prevOpacity = el.style.opacity;
  try {
    el.style.transition = `opacity ${ms}ms ease-out`;
    el.style.opacity = '0';
    const run = () => {
      el.style.opacity = '1';
      // a timer, not `transitionend`: a slot inside a collapsed or hidden
      // subtree never fires the event and would be left invisible for ever
      setTimeout(() => {
        el.style.transition = prevTransition;
        el.style.opacity = prevOpacity;
      }, ms + 120);
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => requestAnimationFrame(run));
    else run();
  } catch {
    el.style.transition = prevTransition;
    el.style.opacity = prevOpacity;
  }
}
