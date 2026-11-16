export function Cover({ hue, size = 48, className = '' }: { hue: number; size?: number; className?: string }) {
  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-r5 ${className}`}
      style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${hue} 85% 58%), hsl(${(hue + 25) % 360} 75% 38%))` }}
      aria-hidden
    >
      <svg viewBox="0 0 48 48" className="absolute inset-0 h-full w-full"><path d="M19 32V14l15-3v18" fill="none" stroke="white" strokeWidth="3" strokeLinejoin="round" /><circle cx="15.5" cy="32" r="4.5" fill="white" /><circle cx="30.5" cy="29" r="4.5" fill="white" /></svg>
    </div>
  )
}
