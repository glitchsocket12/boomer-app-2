import { Component, type ReactNode } from 'react'

export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ maxWidth: '480px', margin: '3rem auto', padding: '1.5rem', fontFamily: 'Georgia, serif' }}>
          <div
            style={{
              backgroundColor: '#FFFFFF',
              padding: '2rem',
              borderRadius: '12px',
              boxShadow: '0 2px 12px rgba(0,0,0,0.08)',
              textAlign: 'center',
            }}
          >
            <h2 style={{ color: '#2E4034', marginTop: 0 }}>Something went wrong</h2>
            <p style={{ color: '#5A5A5A', fontSize: '1.05rem', lineHeight: 1.5 }}>
              This page hit a snag. Your data is safe — reloading usually fixes it.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                fontFamily: 'Georgia, serif',
                fontSize: '1.1rem',
                padding: '0.75rem 1.75rem',
                borderRadius: '8px',
                border: 'none',
                backgroundColor: '#2E4034',
                color: '#FFFFFF',
                cursor: 'pointer',
                marginTop: '0.5rem',
              }}
            >
              Reload page
            </button>
            <details style={{ marginTop: '1.5rem', textAlign: 'left' }}>
              <summary style={{ cursor: 'pointer', color: '#5A5A5A', fontSize: '0.85rem' }}>
                Technical details
              </summary>
              <pre style={{ whiteSpace: 'pre-wrap', color: '#900', fontSize: '0.8rem' }}>
                {this.state.error.message}
                {'\n'}
                {this.state.error.stack}
              </pre>
            </details>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
