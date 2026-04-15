/**
 * 模板元数据定义
 */
export interface TemplateMetadata {
  /** 模板唯一标识（如 simple-html, react-tailwind-v3, nextjs-fullstack） */
  id: string;
  /** 模板展示名称 */
  name: string;
  /** 模板描述 */
  description: string;
  /** 模板类型：simple（静态）、complex（组件化）、fullstack（全栈） */
  type: 'simple' | 'complex' | 'fullstack';
  /** 技术栈标签 */
  tags: string[];
  /** Git 仓库 URL（用于克隆） */
  repoUrl?: string;
  /** Git 分支（默认 main） */
  branch?: string;
}
