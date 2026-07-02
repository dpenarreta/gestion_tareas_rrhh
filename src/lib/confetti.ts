import confetti from "canvas-confetti";

const COLORS = ["#6366f1", "#8b5cf6", "#a855f7", "#4f46e5"];

export function fireCelebrationConfetti(rect: { left: number; top: number; width: number; height: number }) {
  const origin = {
    x: (rect.left + rect.width / 2) / window.innerWidth,
    y: (rect.top + rect.height / 2) / window.innerHeight,
  };
  const end = Date.now() + 2000;

  (function frame() {
    confetti({ particleCount: 3, angle: 60, spread: 55, origin, colors: COLORS, startVelocity: 30, scalar: 0.8, ticks: 100 });
    confetti({ particleCount: 3, angle: 120, spread: 55, origin, colors: COLORS, startVelocity: 30, scalar: 0.8, ticks: 100 });
    if (Date.now() < end) requestAnimationFrame(frame);
  })();
}
