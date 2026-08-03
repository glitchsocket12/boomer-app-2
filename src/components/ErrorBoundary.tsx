import { Component, type ReactNode } from 'react'
import { colors, fontFamily, fontSize, maxWidth, neutral, radius, shadow, space } from '../lib/theme'

export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ maxWidth: maxWidth.dialog, margin: '3rem auto', padding: space.xxxl, fontFamily }}>
          <div
            style={{
              backgroundColor: neutral.white,
              padding: '2rem',
              borderRadius: radius.xl,
              boxShadow: shadow.raised,
              textAlign: 'center',
            }}
          >
            <h2 style={{ color: colors.ink, marginTop: 0 }}>Something went wrong</h2>
            <p style={{ color: neutral.grey600, fontSize: '1.05rem', lineHeight: 1.5 }}>
              This page hit a snag. Your data is safe — reloading usually fixes it.
            </p>
            <button
              onClick={() => window.location.reload()}
              style={{
                fontFamily,
                fontSize: fontSize.lead,
                padding: '0.75rem 1.75rem',
                borderRadius: radius.md,
                border: 'none',
                backgroundColor: colors.ink,
                color: neutral.white,
                cursor: 'pointer',
                marginTop: space.md,
              }}
            >
              Reload page
            </button>
            <details style={{ marginTop: space.xxxl, textAlign: 'left' }}>
              <summary style={{ cursor: 'pointer', color: neutral.grey600, fontSize: fontSize.label }}>
                Technical details
              </summary>
              <pre style={{ whiteSpace: 'pre-wrap', color: '#900', fontSize: fontSize.small }}>
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
