import { useRef } from 'react'
import { Search, X } from 'lucide-react'

export function SearchField({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null)
  return <div className="compact-search"><Search size={15} aria-hidden="true"/><input ref={ref} type="search" aria-label={label} placeholder={label} value={value} onChange={(e) => onChange(e.target.value)}/>{value && <button type="button" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => { onChange(''); ref.current?.focus() }}><X size={14}/></button>}</div>
}
