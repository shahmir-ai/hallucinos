/**
 * The only screens the kernel draws itself (SPEC §2.2): the over-capacity queue
 * and the error state. Plain monospace text on black. No styling opinions.
 */
function screen(text: string): HTMLElement {
  const el = document.createElement('pre');
  el.className = 'os-kernel-screen';
  el.setAttribute('data-os-kernel-screen', '');
  el.textContent = text;
  return el;
}

let current: HTMLElement | null = null;

export function clearScreen(): void {
  if (current && current.parentNode) current.parentNode.removeChild(current);
  current = null;
}

export function showQueue(retryAfter: number, onRetry: () => void): void {
  clearScreen();
  let left = Math.max(1, Math.round(retryAfter));
  const el = screen('');
  el.setAttribute('data-os-queue', '');
  const paint = () => {
    el.textContent =
      'the operating system is over capacity, retry in ' + left + ' s\n\n' + 'nothing is saved. when it comes back it will be a different machine.';
  };
  paint();
  document.body.appendChild(el);
  current = el;
  const timer = window.setInterval(() => {
    left -= 1;
    if (left <= 0) {
      window.clearInterval(timer);
      clearScreen();
      onRetry();
      return;
    }
    paint();
  }, 1000);
}

export function showError(message: string, onRetry?: () => void): void {
  clearScreen();
  const el = screen('the operating system failed to start\n\n' + message + '\n\n' + (onRetry ? 'press any key to try again' : ''));
  el.setAttribute('data-os-error', '');
  document.body.appendChild(el);
  current = el;
  if (onRetry) {
    const once = () => {
      window.removeEventListener('keydown', once);
      el.removeEventListener('click', once);
      clearScreen();
      onRetry();
    };
    window.addEventListener('keydown', once);
    el.addEventListener('click', once);
  }
}
