import { Component, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    console.error('[Skill Hub] React error:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-slate-950 text-slate-200 p-8 font-mono">
          <div className="max-w-3xl mx-auto">
            <h1 className="text-2xl font-bold text-red-400 mb-4">
              ⚠️ Skill Hub crashed
            </h1>
            <p className="text-slate-400 mb-6">
              前端崩溃了。请截图这段信息发给作者，或访问{' '}
              <a
                href="/api/debug"
                target="_blank"
                rel="noreferrer"
                className="text-cyan-400 underline"
              >
                /api/debug
              </a>{' '}
              复制诊断 JSON。
            </p>
            <div className="bg-slate-900 border border-red-500/30 rounded-lg p-4 mb-4">
              <div className="text-red-400 text-sm font-semibold mb-2">
                {this.state.error.name}: {this.state.error.message}
              </div>
              <pre className="text-xs text-slate-400 overflow-auto whitespace-pre-wrap">
                {this.state.error.stack}
              </pre>
            </div>
            <button
              onClick={() => {
                this.setState({ error: null })
                window.location.reload()
              }}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white text-sm"
            >
              重新加载
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
