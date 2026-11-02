import { Component, type ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'

export class ErrorBoundary extends Component<{ children: ReactNode; compact?: boolean }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    if (this.props.compact) return <div className="core-unavailable" role="status"><span className="static-core">∞</span><small>Visualization unavailable · workspace ready</small></div>
    return <div className="recovery-state" role="alert"><TriangleAlert size={28}/><h1>This view couldn’t load</h1><p>Your workspace is still open. Try loading this view again.</p><button className="primary-action" onClick={() => this.setState({ failed: false })}>Try again</button><button onClick={() => window.location.reload()}>Reload EDITH</button></div>
  }
}
