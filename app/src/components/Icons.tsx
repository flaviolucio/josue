import type { SVGProps } from 'react'

type P = SVGProps<SVGSVGElement> & { size?: number }
const base = (size = 20, rest: SVGProps<SVGSVGElement>) => ({ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true, ...rest })

export const IUpload = ({ size, ...r }: P) => <svg {...base(size, r)}><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></svg>
export const ILink = ({ size, ...r }: P) => <svg {...base(size, r)}><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" /></svg>
export const ISearch = ({ size, ...r }: P) => <svg {...base(size, r)}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
export const ITrash = ({ size, ...r }: P) => <svg {...base(size, r)}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3" /></svg>
export const IPlay = ({ size, ...r }: P) => <svg {...base(size, { ...r, fill: 'currentColor', stroke: 'none' })}><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" /></svg>
export const IPause = ({ size, ...r }: P) => <svg {...base(size, { ...r, fill: 'currentColor', stroke: 'none' })}><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
export const IBack5 = ({ size, ...r }: P) => <svg {...base(size, r)}><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><text x="12" y="15.5" fontSize="7.5" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="sans-serif" fontWeight="700">5</text></svg>
export const IFwd5 = ({ size, ...r }: P) => <svg {...base(size, r)}><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /><text x="12" y="15.5" fontSize="7.5" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="sans-serif" fontWeight="700">5</text></svg>
export const IArrowLeft = ({ size, ...r }: P) => <svg {...base(size, r)}><path d="M15 18l-6-6 6-6" /></svg>
export const IDownload = ({ size, ...r }: P) => <svg {...base(size, r)}><path d="M12 4v12M7 11l5 5 5-5M4 20h16" /></svg>
export const IEdit = ({ size, ...r }: P) => <svg {...base(size, r)}><path d="M4 20h4L19 9l-4-4L4 16v4Z" /><path d="m13.5 6.5 4 4" /></svg>
export const IRepeat = ({ size, ...r }: P) => <svg {...base(size, r)}><path d="M17 2l4 4-4 4" /><path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4" /><path d="M21 13v1a4 4 0 0 1-4 4H3" /></svg>
export const IUndo = ({ size, ...r }: P) => <svg {...base(size, r)}><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></svg>
export const IClose = ({ size, ...r }: P) => <svg {...base(size, r)}><path d="M6 6l12 12M18 6 6 18" /></svg>
export const IGrid = ({ size, ...r }: P) => <svg {...base(size, r)}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M5 8h14M10 3v18M14 3v18" /></svg>
export const IPrinter = ({ size, ...r }: P) => <svg {...base(size, r)}><path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1h-2" /><rect x="6" y="14" width="12" height="7" rx="1" /></svg>
export const IChevron = ({ size, ...r }: P) => <svg {...base(size, r)}><path d="m6 9 6 6 6-6" /></svg>
export const IRetry = ({ size, ...r }: P) => <svg {...base(size, r)}><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>


export const VERSE = '“Seja forte e corajoso, porque o Senhor, seu Deus, estará com você por onde você andar.”'
export const VERSE_REF = 'Josué 1:9'
export const ITuner = ({ size, ...r }: P) => <svg {...base(size, r)}><path d="M9 3v8a3 3 0 0 0 6 0V3" /><path d="M12 14v7" /><path d="M5 9a7 7 0 0 0 3 5.7M19 9a7 7 0 0 1-3 5.7" /></svg>
export const ITab = ({ size, ...r }: P) => <svg {...base(size, r)}><path d="M3 6h18M3 10h18M3 14h18M3 18h18" opacity=".55" /><text x="7" y="12.5" fontSize="6.5" fill="currentColor" stroke="none" fontFamily="sans-serif" fontWeight="700">3</text><text x="14" y="16.5" fontSize="6.5" fill="currentColor" stroke="none" fontFamily="sans-serif" fontWeight="700">5</text></svg>
export const IStop = ({ size, ...r }: P) => <svg {...base(size, { ...r, fill: 'currentColor', stroke: 'none' })}><rect x="6" y="6" width="12" height="12" rx="1.5" /></svg>
