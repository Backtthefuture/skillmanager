const CATEGORY_META: Record<string, { name: string; icon: string; bg: string; text: string }> = {
  'code-dev':    { name: '代码开发',   icon: '💻', bg: 'bg-blue-500/15',    text: 'text-blue-300' },
  'content':     { name: '内容创作',   icon: '✍️', bg: 'bg-emerald-500/15', text: 'text-emerald-300' },
  'image-gen':   { name: '图片生成',   icon: '🎨', bg: 'bg-pink-500/15',    text: 'text-pink-300' },
  'video-audio': { name: '视频/音频',  icon: '🎬', bg: 'bg-purple-500/15',  text: 'text-purple-300' },
  'data':        { name: '数据分析',   icon: '📊', bg: 'bg-cyan-500/15',    text: 'text-cyan-300' },
  'web-search':  { name: '网络搜索',   icon: '🔍', bg: 'bg-amber-500/15',   text: 'text-amber-300' },
  'social':      { name: '社交媒体',   icon: '📱', bg: 'bg-rose-500/15',    text: 'text-rose-300' },
  'doc':         { name: '文档处理',   icon: '📄', bg: 'bg-sky-500/15',     text: 'text-sky-300' },
  'comms':       { name: '通讯协作',   icon: '💬', bg: 'bg-indigo-500/15',  text: 'text-indigo-300' },
  'design':      { name: '设计/UI',    icon: '🖌️', bg: 'bg-fuchsia-500/15', text: 'text-fuchsia-300' },
  'translate':   { name: '翻译/i18n',  icon: '🌐', bg: 'bg-teal-500/15',    text: 'text-teal-300' },
  'sysadmin':    { name: '系统管理',   icon: '🖥️', bg: 'bg-orange-500/15',  text: 'text-orange-300' },
  'persona':     { name: '人格/角色',  icon: '🎭', bg: 'bg-violet-500/15',  text: 'text-violet-300' },
  'finance':     { name: '财务/金融',  icon: '💰', bg: 'bg-yellow-500/15',  text: 'text-yellow-300' },
  'other':       { name: '其他',       icon: '📦', bg: 'bg-gray-500/15',    text: 'text-gray-400' },
}

const FALLBACK = { name: '未知', icon: '❔', bg: 'bg-gray-500/15', text: 'text-gray-400' }

export function getCategoryMeta(id: string) {
  return CATEGORY_META[id] || FALLBACK
}

export function CategoryBadge({ category }: { category: string }) {
  const meta = getCategoryMeta(category)
  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${meta.bg} ${meta.text}`}
      title={meta.name}
    >
      <span>{meta.icon}</span>
      <span>{meta.name}</span>
    </span>
  )
}
