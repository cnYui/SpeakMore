/**
 * 玻璃折射用的 SVG 滤镜定义（供 glass.css 里的 `.glass-lens` 引用）
 *
 * 位移图：中间区域是中性灰（不位移），四条边附近 R / G 通道渐变到两端，feDisplacementMap 据此在边缘处弯折背景，
 * 看起来像边缘有一圈透镜。只在 Chromium 里对 backdrop-filter 生效。
 */
const displacementMap = [
  '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">',
  '<defs>',
  '<linearGradient id="x" x1="0" y1="0" x2="1" y2="0">',
  '<stop offset="0" stop-color="rgb(255,0,0)"/><stop offset="0.16" stop-color="rgb(128,0,0)"/>',
  '<stop offset="0.84" stop-color="rgb(128,0,0)"/><stop offset="1" stop-color="rgb(0,0,0)"/>',
  '</linearGradient>',
  '<linearGradient id="y" x1="0" y1="0" x2="0" y2="1">',
  '<stop offset="0" stop-color="rgb(0,255,0)"/><stop offset="0.16" stop-color="rgb(0,128,0)"/>',
  '<stop offset="0.84" stop-color="rgb(0,128,0)"/><stop offset="1" stop-color="rgb(0,0,0)"/>',
  '</linearGradient>',
  '</defs>',
  '<rect width="200" height="200" fill="rgb(0,0,0)"/>',
  '<rect width="200" height="200" fill="url(#x)"/>',
  '<rect width="200" height="200" fill="url(#y)" style="mix-blend-mode:screen"/>',
  '</svg>',
].join('')

const displacementMapUrl = `data:image/svg+xml;utf8,${encodeURIComponent(displacementMap)}`

export default function GlassFilters() {
  return (
    <svg aria-hidden="true" focusable="false" width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }}>
      <defs>
        <filter id="glass-refract" x="0" y="0" width="1" height="1" filterUnits="objectBoundingBox" primitiveUnits="objectBoundingBox" colorInterpolationFilters="sRGB">
          <feImage href={displacementMapUrl} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="map" />
          <feDisplacementMap in="SourceGraphic" in2="map" scale="0.35" xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </defs>
    </svg>
  )
}
