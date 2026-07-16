import { Component, type ReactNode } from 'react'

export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ maxWidth: '600px', margin: '2rem auto', padding: '1.5rem', fontFamily: 'Georgia, serif' }}>
          <h2 style={{ color: '#2E4034' }}>Something went wrong on this page.</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#900', fontSize: '0.85rem' }}>
            {this.state.error.message}
            {'\n'}
            {this.state.error.stack}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}
