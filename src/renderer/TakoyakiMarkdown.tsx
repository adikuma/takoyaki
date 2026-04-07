import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface TakoyakiMarkdownProps {
  markdown: string
}

const markdownComponents: Components = {
  table: ({ children }) => (
    <div className="takoyaki-markdown-table-wrap">
      <table>{children}</table>
    </div>
  ),
}

export function TakoyakiMarkdown({ markdown }: TakoyakiMarkdownProps) {
  return (
    <div className="takoyaki-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {markdown}
      </ReactMarkdown>
    </div>
  )
}
