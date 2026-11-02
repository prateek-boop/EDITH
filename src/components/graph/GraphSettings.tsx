import { useState } from 'react'
import { ChevronRight, ChevronDown, RotateCcw, X, Plus, Settings2, Crosshair } from 'lucide-react'
import { SearchField } from '../ui/SearchField'
import { useEdithStore } from '../../store/useEdithStore'

interface SectionProps {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}

function Section({ title, children, defaultOpen = false }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`obs-section ${open ? 'open' : ''}`}>
      <button aria-expanded={open} className="obs-section-header" onClick={() => setOpen(!open)} type="button">
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <span>{title}</span>
      </button>
      {open && <div className="obs-section-body">{children}</div>}
    </div>
  )
}

interface GraphSettingsProps {
  onResetCamera?: () => void
}

export function GraphSettings({ onResetCamera }: GraphSettingsProps) {
  const [settingsOpen, setSettingsOpen] = useState(true)
  const settings = useEdithStore((s) => s.graphSettings)
  const setSettings = useEdithStore((s) => s.setGraphSettings)

  const updateFilters = (k: keyof typeof settings.filters, v: any) =>
    setSettings((s) => ({ ...s, filters: { ...s.filters, [k]: v } }))
  const updateDisplay = (k: keyof typeof settings.display, v: any) =>
    setSettings((s) => ({ ...s, display: { ...s.display, [k]: v } }))
  const updateForces = (k: keyof typeof settings.forces, v: any) =>
    setSettings((s) => ({ ...s, forces: { ...s.forces, [k]: v } }))

  if (!settingsOpen) {
    return (
      <button
        className="obs-toggle-btn"
        onClick={() => setSettingsOpen(true)}
        title="Open graph settings"
        type="button"
      >
        <Settings2 size={16} />
      </button>
    )
  }

  const handleReset = () => {
    setSettings((s) => ({
      ...s,
      filters: { search: '', orphans: true },
      display: { arrows: false, textFade: 0.5, nodeSize: 1.2, linkThickness: 1.5, animate: true },
      forces: { centerForce: 0.15, repelForce: 30, linkForce: 1, linkDistance: 40 }
    }))
    if (onResetCamera) onResetCamera()
  }

  return (
    <div className="obs-graph-settings">
      {/* Top bar */}
      <div className="obs-settings-top">
        {onResetCamera && (
          <button
            className="obs-icon-btn"
            title="Center graph"
            onClick={onResetCamera}
            type="button"
          >
            <Crosshair size={13} />
          </button>
        )}
        <button
          className="obs-icon-btn"
          title="Reset to defaults"
          onClick={handleReset}
          type="button"
        >
          <RotateCcw size={13} />
        </button>
        <button
          className="obs-icon-btn"
          title="Close settings"
          onClick={() => setSettingsOpen(false)}
          type="button"
        >
          <X size={13} />
        </button>
      </div>

      {/* Filters */}
      <Section title="Filters" defaultOpen>
        <div className="obs-row">
          <SearchField label="Search graph" value={settings.filters.search} onChange={(value) => updateFilters('search', value)}/>
        </div>
        <button type="button"
          className="obs-row obs-toggle"
          aria-pressed={settings.filters.orphans}
          onClick={() => updateFilters('orphans', !settings.filters.orphans)}

        >
          <span>Orphans</span>
          <div className={`obs-switch ${settings.filters.orphans ? 'on' : ''}`}>
            <div className="obs-switch-thumb" />
          </div>
        </button>
      </Section>

      {/* Groups */}
      <Section title="Groups">
        {(settings.groups || []).map((g, i) => (
          <div key={i} className="obs-row obs-group-row">
            <input
              aria-label={`Group ${i + 1} color`}
              type="color"
              value={g.color}
              onChange={(e) => {
                const newGroups = [...(settings.groups || [])]
                newGroups[i].color = e.target.value
                setSettings((s) => ({ ...s, groups: newGroups }))
              }}
              className="obs-color-pick"
            />
            <input
              type="text"
              aria-label={`Group ${i + 1} query`}
              value={g.query}
              placeholder="tag, path, or keyword..."
              onChange={(e) => {
                const newGroups = [...(settings.groups || [])]
                newGroups[i].query = e.target.value
                setSettings((s) => ({ ...s, groups: newGroups }))
              }}
              className="obs-input"
            />
            <button
              aria-label={`Remove group ${i + 1}`}
              className="obs-icon-btn sm"
              onClick={() => {
                const newGroups = (settings.groups || []).filter((_, idx) => idx !== i)
                setSettings((s) => ({ ...s, groups: newGroups }))
              }}
              type="button"
            >
              <X size={11} />
            </button>
          </div>
        ))}
        <button
          className="obs-add-group"
          onClick={() => {
            setSettings((s) => ({ ...s, groups: [...s.groups, { query: '', color: '#a882ff' }] }))
          }}
          type="button"
        >
          <Plus size={11} /> New group
        </button>
      </Section>

      {/* Display */}
      <Section title="Display">
        <button type="button"
          className="obs-row obs-toggle"
          aria-pressed={settings.display.arrows}
          onClick={() => updateDisplay('arrows', !settings.display.arrows)}

        >
          <span>Arrows</span>
          <div className={`obs-switch ${settings.display.arrows ? 'on' : ''}`}>
            <div className="obs-switch-thumb" />
          </div>
        </button>
        <button type="button"
          className="obs-row obs-toggle"
          aria-pressed={settings.display.animate}
          onClick={() => updateDisplay('animate', !settings.display.animate)}

        >
          <span>Animate</span>
          <div className={`obs-switch ${settings.display.animate ? 'on' : ''}`}>
            <div className="obs-switch-thumb" />
          </div>
        </button>
        <div className="obs-slider-row">
          <div className="obs-slider-label">
            <span>Text fade</span>
            <span className="obs-slider-val">{settings.display.textFade.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            aria-label="Text fade"
            value={settings.display.textFade}
            onChange={(e) => updateDisplay('textFade', parseFloat(e.target.value))}
            className="obs-range"
          />
        </div>
        <div className="obs-slider-row">
          <div className="obs-slider-label">
            <span>Node size</span>
            <span className="obs-slider-val">{settings.display.nodeSize.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min="0.2"
            max="3"
            step="0.1"
            aria-label="Node size"
            value={settings.display.nodeSize}
            onChange={(e) => updateDisplay('nodeSize', parseFloat(e.target.value))}
            className="obs-range"
          />
        </div>
        <div className="obs-slider-row">
          <div className="obs-slider-label">
            <span>Link thickness</span>
            <span className="obs-slider-val">{settings.display.linkThickness.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min="0.2"
            max="4"
            step="0.1"
            aria-label="Link thickness"
            value={settings.display.linkThickness}
            onChange={(e) => updateDisplay('linkThickness', parseFloat(e.target.value))}
            className="obs-range"
          />
        </div>
      </Section>

      {/* Forces */}
      <Section title="Forces">
        <div className="obs-slider-row">
          <div className="obs-slider-label">
            <span>Center force</span>
            <span className="obs-slider-val">{settings.forces.centerForce.toFixed(2)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="0.5"
            step="0.01"
            aria-label="Center force"
            value={settings.forces.centerForce}
            onChange={(e) => updateForces('centerForce', parseFloat(e.target.value))}
            className="obs-range"
          />
        </div>
        <div className="obs-slider-row">
          <div className="obs-slider-label">
            <span>Repel force</span>
            <span className="obs-slider-val">{settings.forces.repelForce.toFixed(0)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="200"
            step="1"
            aria-label="Repel force"
            value={settings.forces.repelForce}
            onChange={(e) => updateForces('repelForce', parseFloat(e.target.value))}
            className="obs-range"
          />
        </div>
        <div className="obs-slider-row">
          <div className="obs-slider-label">
            <span>Link force</span>
            <span className="obs-slider-val">{settings.forces.linkForce.toFixed(1)}</span>
          </div>
          <input
            type="range"
            min="0"
            max="2"
            step="0.1"
            aria-label="Link force"
            value={settings.forces.linkForce}
            onChange={(e) => updateForces('linkForce', parseFloat(e.target.value))}
            className="obs-range"
          />
        </div>
        <div className="obs-slider-row">
          <div className="obs-slider-label">
            <span>Link distance</span>
            <span className="obs-slider-val">{settings.forces.linkDistance.toFixed(0)}</span>
          </div>
          <input
            type="range"
            min="10"
            max="180"
            step="1"
            aria-label="Link distance"
            value={settings.forces.linkDistance}
            onChange={(e) => updateForces('linkDistance', parseFloat(e.target.value))}
            className="obs-range"
          />
        </div>
      </Section>
    </div>
  )
}
