import { useEffect, useState } from 'react'

export function useMotionPreference() {
  const read = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('reduce-motion')
  const [reduced, setReduced] = useState(read)
  useEffect(() => {
    const update = () => setReduced(read())
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const observer = new MutationObserver(update)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    media.addEventListener('change', update)
    return () => { observer.disconnect(); media.removeEventListener('change', update) }
  }, [])
  return reduced
}
