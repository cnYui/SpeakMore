function clamp(value, min, max) {
  if (max < min) return min;
  return Math.max(min, Math.min(max, value));
}

function clampBoundsToWorkArea(bounds, workArea) {
  const maxX = workArea.x + Math.max(0, workArea.width - bounds.width);
  const maxY = workArea.y + Math.max(0, workArea.height - bounds.height);

  return {
    x: clamp(bounds.x, workArea.x, maxX),
    y: clamp(bounds.y, workArea.y, maxY),
    width: bounds.width,
    height: bounds.height,
  };
}

function resolveBottomCenterBounds(workArea, windowSize, bottomGap) {
  const x = Math.floor(workArea.x + (workArea.width - windowSize.width) / 2);
  const y = Math.floor(workArea.y + workArea.height - windowSize.height - bottomGap);
  return clampBoundsToWorkArea({ x, y, ...windowSize }, workArea);
}

module.exports = {
  clampBoundsToWorkArea,
  resolveBottomCenterBounds,
};
