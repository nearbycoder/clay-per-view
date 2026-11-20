// Small enhancements for the website. Everything on the page works without this file: the pictures are
// plain links, the trailer has its own controls and the cast line-up is ordinary anchors.

/** Opens the stills in a viewer instead of leaving the page. */
function setUpViewer(): void {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('.shot a'));
  if (links.length === 0 || typeof HTMLDialogElement === 'undefined') { return; }

  const dialog = document.createElement('dialog');
  dialog.className = 'lightbox';
  dialog.setAttribute('aria-label', 'Picture viewer');
  dialog.innerHTML = `
    <figure>
      <img alt="" width="1600" height="900">
      <div class="lightbox-bar">
        <button type="button" data-step="-1" aria-label="Previous picture">&larr;</button>
        <figcaption></figcaption>
        <button type="button" data-step="1" aria-label="Next picture">&rarr;</button>
        <button type="button" data-close>Close</button>
      </div>
    </figure>`;
  document.body.append(dialog);
  const image = dialog.querySelector('img') as HTMLImageElement;
  const caption = dialog.querySelector('figcaption') as HTMLElement;
  let index = 0;

  const show = (next: number): void => {
    index = (next + links.length) % links.length;
    const link = links[index];
    image.src = link.href;
    image.alt = link.querySelector('img')?.alt ?? '';
    caption.textContent = link.closest('figure')?.querySelector('figcaption')?.textContent ?? '';
  };

  links.forEach((link, i) => {
    link.addEventListener('click', (event) => {
      // Leave "open in a new tab" clicks alone.
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) { return; }
      event.preventDefault();
      show(i);
      dialog.showModal();
    });
  });
  dialog.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    const step = target.closest<HTMLElement>('[data-step]')?.dataset.step;
    if (step) {
      show(index + Number(step));
    } else if (target === dialog || target.closest('[data-close]')) {
      dialog.close(); // a click on the dimmed backdrop lands on the dialog itself
    }
  });
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') { show(index - 1); }
    if (event.key === 'ArrowRight') { show(index + 1); }
  });
}

/** The trailer: drop the decorative "live" bug once it plays, and stop playing when scrolled away. */
function setUpTrailer(): void {
  const video = document.querySelector<HTMLVideoElement>('#trailer-video');
  const frame = video?.closest('.tv');
  if (!video || !frame) { return; }
  video.addEventListener('play', () => frame.classList.add('is-playing'));
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((entries) => {
      if (entries.some((entry) => !entry.isIntersecting) && !video.paused) { video.pause(); }
    }, { threshold: 0.15 }).observe(video);
  }
}

/** On narrow screens the stills become a strip that scrolls sideways; make that strip reachable by keyboard. */
function setUpStrip(): void {
  const strip = document.querySelector<HTMLElement>('.shots');
  if (!strip) { return; }
  const narrow = window.matchMedia('(max-width: 639px)');
  const update = (): void => {
    if (narrow.matches) {
      strip.tabIndex = 0;
      strip.setAttribute('role', 'group');
      strip.setAttribute('aria-label', 'Pictures from the game. Scroll sideways for more.');
    } else {
      strip.removeAttribute('tabindex');
      strip.removeAttribute('role');
      strip.removeAttribute('aria-label');
    }
  };
  narrow.addEventListener('change', update);
  update();
}

setUpViewer();
setUpTrailer();
setUpStrip();
