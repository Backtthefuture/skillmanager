const VERSION = '0.3.0'

const LINKS = {
  x: 'https://x.com/PMbackttfuture',
  jike: 'https://web.okjike.com/u/E272054E-D904-4F13-A7EC-9ABD2CBF209E',
  github: 'https://github.com/Backtthefuture/huangshu',
}

export function Footer({ onAboutClick }: { onAboutClick: () => void }) {
  return (
    <footer className="mt-16 pt-5 pb-6 border-t border-slate-800/60">
      <div className="max-w-[1400px] mx-auto px-6 flex flex-col sm:flex-row items-center justify-center gap-x-3 gap-y-2 text-[11px] text-slate-600">
        <span>
          by{' '}
          <button
            onClick={onAboutClick}
            className="text-slate-400 font-medium hover:text-indigo-300 transition-colors"
          >
            黄叔
          </button>
        </span>
        <span className="hidden sm:inline text-slate-800">·</span>
        <span>v{VERSION}</span>
        <span className="hidden sm:inline text-slate-800">·</span>
        <a
          href={LINKS.x}
          target="_blank"
          rel="noreferrer"
          className="hover:text-slate-400 transition-colors"
        >
          X
        </a>
        <span className="hidden sm:inline text-slate-800">·</span>
        <a
          href={LINKS.jike}
          target="_blank"
          rel="noreferrer"
          className="hover:text-slate-400 transition-colors"
        >
          即刻
        </a>
        <span className="hidden sm:inline text-slate-800">·</span>
        <a
          href={LINKS.github}
          target="_blank"
          rel="noreferrer"
          className="hover:text-slate-400 transition-colors inline-flex items-center gap-1"
        >
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
          </svg>
          GitHub
        </a>
        <span className="hidden sm:inline text-slate-800">·</span>
        <button
          onClick={onAboutClick}
          className="hover:text-slate-400 transition-colors"
        >
          关于
        </button>
      </div>
    </footer>
  )
}
