import { useCallback, useEffect, useState } from 'react'
import Library from './pages/Library'
import SongPage from './pages/SongPage'
import SetlistPage from './pages/SetlistPage'
import ProjectorPage from './pages/ProjectorPage'
import { resumeQueue } from './lib/pipeline'
import { seedDemo } from './lib/demo'
import Splash from './components/Splash'

function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const on = () => setHash(window.location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}

export function navigate(to: string) { window.location.hash = to }

export default function App() {
  const hash = useHashRoute()
  const [splash, setSplash] = useState(true)
  const hideSplash = useCallback(() => setSplash(false), [])
  useEffect(() => {
    // a janela do projetor só mostra a letra: não mexe na fila de processamento
    if (window.location.hash.startsWith('#/projetor')) return
    void seedDemo().catch(() => {})
    void resumeQueue()
  }, [])
  const m = /^#\/musica\/([\w-]+)/.exec(hash)
  const r = /^#\/repertorio(?:\/([\w-]+))?/.exec(hash)
  const pj = /^#\/projetor\/([\w-]+)/.exec(hash)
  if (pj) return <ProjectorPage id={pj[1]} />
  return (
    <>
      {m ? <SongPage key={hash} id={m[1]} /> : r ? <SetlistPage key={r[1] ?? 'lista'} id={r[1]} /> : <Library />}
      {splash && <Splash onDone={hideSplash} />}
    </>
  )
}
