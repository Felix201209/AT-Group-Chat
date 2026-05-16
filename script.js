/* AT Group Chat — Multi-page interactions */
(function () {
  'use strict';

  const nav = document.getElementById('nav');
  const navToggle = document.getElementById('nav-toggle');
  const navLinks = document.getElementById('nav-links');

  /* Nav scroll state */
  function updateNavScroll() {
    if (!nav) return;
    nav.classList.toggle('scrolled', window.scrollY > 10);
  }
  window.addEventListener('scroll', updateNavScroll, { passive: true });
  updateNavScroll();

  /* Mobile menu */
  if (navToggle && navLinks) {
    navToggle.addEventListener('click', () => {
      const expanded = navToggle.getAttribute('aria-expanded') === 'true';
      navToggle.setAttribute('aria-expanded', String(!expanded));
      navLinks.classList.toggle('mobile-open', !expanded);
      document.body.style.overflow = !expanded ? 'hidden' : '';
    });
    navLinks.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        navToggle.setAttribute('aria-expanded', 'false');
        navLinks.classList.remove('mobile-open');
        document.body.style.overflow = '';
      });
    });
  }

  /* Smooth scroll for same-page anchors */
  document.querySelectorAll('a[href^="#"]').forEach((anchor) => {
    anchor.addEventListener('click', (e) => {
      const href = anchor.getAttribute('href');
      if (!href || href === '#') return;
      const target = document.querySelector(href);
      if (!target) return;
      e.preventDefault();
      const offset = 80;
      const top = target.getBoundingClientRect().top + window.scrollY - offset;
      window.scrollTo({ top, behavior: 'smooth' });
    });
  });

  /* Active nav link based on current page */
  const currentPage = location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-links a, .docs-sidebar-nav a').forEach((link) => {
    const href = link.getAttribute('href');
    if (!href) return;
    const page = href.split('#')[0];
    if (page === currentPage || (currentPage === '' && page === 'index.html')) {
      link.classList.add('active');
    }
  });

  /* Copy utility */
  async function copyToClipboard(text, btn, successHtml) {
    try {
      await navigator.clipboard.writeText(text);
      const original = btn.innerHTML;
      btn.innerHTML = successHtml;
      btn.style.color = '#86efac';
      setTimeout(() => {
        btn.innerHTML = original;
        btn.style.color = '';
      }, 1600);
    } catch (err) { /* ignore */ }
  }

  /* CTA install copy */
  document.querySelectorAll('.cta-install .cta-copy').forEach((ctaCopy) => {
    ctaCopy.addEventListener('click', () => {
      const code = ctaCopy.closest('.cta-install')?.querySelector('code');
      if (!code) return;
      copyToClipboard(code.textContent, ctaCopy,
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
      );
    });
  });

  /* Code block copy buttons */
  document.querySelectorAll('.code-window, .docs-content pre').forEach((block) => {
    const code = block.querySelector('code');
    if (!code) return;
    const copyBtn = document.createElement('button');
    copyBtn.className = 'code-copy';
    copyBtn.setAttribute('aria-label', 'Copy code');
    copyBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
    copyBtn.addEventListener('click', () => {
      copyToClipboard(code.textContent, copyBtn,
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
      );
    });
    const header = block.querySelector('.code-header');
    if (header) {
      header.appendChild(copyBtn);
    } else {
      copyBtn.style.position = 'absolute';
      copyBtn.style.top = '8px';
      copyBtn.style.right = '8px';
      block.style.position = 'relative';
      block.appendChild(copyBtn);
    }
  });

  /* Reveal on scroll */
  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
  );

  document.querySelectorAll('.section-header, .feature-card, .step, .feature-detail, .tech-content, .tech-visual, .cta-block > *, .docs-content > *').forEach((el) => {
    el.classList.add('reveal');
    revealObserver.observe(el);
  });
})();
