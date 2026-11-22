(() => {
  const columns = 7;
  const frameWidth = 228;
  const frameHeight = 224;
  const originX = 51;
  const originY = 209;
  const standingHeight = 176;
  const topFrame = 12;
  const impactFrame = 40;
  const recoveryFrame = 44;
  // Progress is supplied by the edit lifecycle, independent of keystrokes and frame rate.
  const contactAt = .24;
  const releaseAt = .35;

  function frameAt(phase, p) {
    if (phase === 'windup') {
      const lift = Math.min(1, p / .87);
      return Math.round(topFrame * lift * (2 - lift));
    }
    if (p < contactAt) {
      const swing = p / contactAt;
      return Math.min(impactFrame - 1, Math.round(topFrame + (impactFrame - topFrame) * swing ** 1.4));
    }
    if (p <= releaseAt) return impactFrame;
    const rebound = (p - releaseAt) / (1 - releaseAt);
    return Math.round(impactFrame + (recoveryFrame - impactFrame) * rebound * (2 - rebound));
  }

  globalThis.createFormovodImpact = (asset, redraw) => {
    function load(name) {
      const image = new Image();
      image.addEventListener('load', redraw, {once:true});
      image.src = asset(name);
      return image;
    }

    const images = {price:load('impact-amber'), quote:load('impact-violet')};
    return {
      ready(role) { return Boolean(images[role]?.naturalWidth); },
      draw(ctx, {phase, p, x, y, scale, flip = false, role}) {
        const image = images[role];
        if ((phase !== 'windup' && phase !== 'strike') ||
            !image?.naturalWidth || ![p, x, y, scale].every(Number.isFinite) || scale <= 0) return false;

        const frame = frameAt(phase, Math.max(0, Math.min(1, p)));
        const size = scale / standingHeight;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(flip ? -size : size, size);
        ctx.drawImage(image, (frame % columns) * frameWidth, Math.floor(frame / columns) * frameHeight,
          frameWidth, frameHeight, -originX, -originY, frameWidth, frameHeight);
        ctx.restore();
        return true;
      },
    };
  };
})();
