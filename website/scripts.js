/* ============================================================
   RunBy — Global Scripts (2026 Redesign)
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {

  // ─────────────────────────────────────────
  // CURSOR GLOW EFFECT
  // ─────────────────────────────────────────
  const glow = document.querySelector('.cursor-glow');
  if (glow) {
    let mouseX = 0, mouseY = 0;
    let glowX = 0, glowY = 0;

    document.addEventListener('mousemove', (e) => {
      mouseX = e.clientX;
      mouseY = e.clientY;
      glow.classList.add('active');
    });

    document.addEventListener('mouseleave', () => {
      glow.classList.remove('active');
    });

    function animateGlow() {
      glowX += (mouseX - glowX) * 0.08;
      glowY += (mouseY - glowY) * 0.08;
      glow.style.left = glowX + 'px';
      glow.style.top = glowY + 'px';
      requestAnimationFrame(animateGlow);
    }
    animateGlow();
  }

  // ─────────────────────────────────────────
  // NAV SCROLL BEHAVIOR
  // ─────────────────────────────────────────
  const nav = document.querySelector('nav');
  if (nav) {
    let lastScroll = 0;
    window.addEventListener('scroll', () => {
      const currentScroll = window.scrollY;
      if (currentScroll > 50) {
        nav.classList.add('scrolled');
      } else {
        nav.classList.remove('scrolled');
      }
      lastScroll = currentScroll;
    }, { passive: true });
  }

  // ─────────────────────────────────────────
  // HAMBURGER MENU
  // ─────────────────────────────────────────
  const hamburger = document.querySelector('.nav-hamburger');
  const mobileNav = document.querySelector('.nav-mobile');
  if (hamburger && mobileNav) {
    hamburger.addEventListener('click', () => {
      hamburger.classList.toggle('open');
      mobileNav.classList.toggle('open');
      document.body.style.overflow = mobileNav.classList.contains('open') ? 'hidden' : '';
    });

    // Close on link click
    mobileNav.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        hamburger.classList.remove('open');
        mobileNav.classList.remove('open');
        document.body.style.overflow = '';
      });
    });
  }

  // ─────────────────────────────────────────
  // SCROLL REVEAL ANIMATIONS
  // ─────────────────────────────────────────
  const reveals = document.querySelectorAll('.reveal');
  if (reveals.length) {
    const observerOptions = {
      threshold: 0.1,
      rootMargin: '0px 0px -60px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, observerOptions);

    reveals.forEach(el => observer.observe(el));
  }

  // ─────────────────────────────────────────
  // ANIMATED STAT COUNTERS
  // ─────────────────────────────────────────
  const statNumbers = document.querySelectorAll('.stat-number[data-target]');
  if (statNumbers.length) {
    const counterObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const el = entry.target;
          const target = el.dataset.target;
          const prefix = el.dataset.prefix || '';
          const suffix = el.dataset.suffix || '';
          const duration = 2000;
          const numericTarget = parseFloat(target.replace(/[^0-9.]/g, ''));
          const hasDecimal = target.includes('.');
          const start = performance.now();

          function updateCounter(now) {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            // Ease out cubic
            const ease = 1 - Math.pow(1 - progress, 3);
            const current = numericTarget * ease;

            if (hasDecimal) {
              el.textContent = prefix + current.toFixed(1).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + suffix;
            } else {
              el.textContent = prefix + Math.floor(current).toLocaleString() + suffix;
            }

            if (progress < 1) {
              requestAnimationFrame(updateCounter);
            } else {
              el.textContent = prefix + target + suffix;
            }
          }
          requestAnimationFrame(updateCounter);
          counterObserver.unobserve(el);
        }
      });
    }, { threshold: 0.5 });

    statNumbers.forEach(el => counterObserver.observe(el));
  }

  // ─────────────────────────────────────────
  // FAQ ACCORDION
  // ─────────────────────────────────────────
  document.querySelectorAll('.faq-question').forEach(q => {
    q.addEventListener('click', () => {
      const item = q.parentElement;
      document.querySelectorAll('.faq-item').forEach(i => {
        if (i !== item) i.classList.remove('open');
      });
      item.classList.toggle('open');
    });
  });

});
