const revealTargets = Array.from(document.querySelectorAll(".reveal"));

const observer =
  "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add("is-visible");
            observer?.unobserve(entry.target);
          }
        },
        { threshold: 0.14 }
      )
    : null;

for (const el of revealTargets) {
  if (!observer) {
    el.classList.add("is-visible");
    continue;
  }
  observer.observe(el);
}

