export interface CodeBlockProps {
  code: string;
  language?: string;
  filename?: string;
  showLineNumbers?: boolean;
  className?: string;
}

export function CodeBlock({
  code,
  language = 'text',
  filename,
  showLineNumbers = true,
  className = '',
}: CodeBlockProps) {
  const lines = code.split('\n');

  return (
    <div
      className={`rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden ${className}`}
    >
      {filename && (
        <div className="px-4 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-sm text-gray-600 dark:text-gray-400 font-mono">
          {filename}
        </div>
      )}
      <pre className="overflow-x-auto p-4 text-sm">
        <code className={`language-${language}`}>
          {lines.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: code lines are positional
            <div key={i} className="flex">
              {showLineNumbers && (
                <span className="select-none text-gray-400 dark:text-gray-600 w-8 text-right mr-4 shrink-0">
                  {i + 1}
                </span>
              )}
              <span>{line}</span>
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}
