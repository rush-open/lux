import { describe, expect, it } from 'vitest';
import { getTemplateById, listTemplates, matchTemplate } from './template-registry.js';

describe('template-registry', () => {
  describe('listTemplates', () => {
    it('should return all builtin templates', () => {
      const templates = listTemplates();
      expect(templates.length).toBe(3);
      expect(templates.map((t) => t.id)).toEqual([
        'simple-html',
        'react-tailwind-v3',
        'nextjs-fullstack',
      ]);
    });

    it('should include correct types', () => {
      const templates = listTemplates();
      expect(templates.find((t) => t.id === 'simple-html')?.type).toBe('simple');
      expect(templates.find((t) => t.id === 'react-tailwind-v3')?.type).toBe('complex');
      expect(templates.find((t) => t.id === 'nextjs-fullstack')?.type).toBe('fullstack');
    });
  });

  describe('getTemplateById', () => {
    it('should return template by id', () => {
      const template = getTemplateById('simple-html');
      expect(template).not.toBeNull();
      expect(template?.id).toBe('simple-html');
      expect(template?.name).toBe('Simple HTML');
    });

    it('should return null for unknown id', () => {
      const template = getTemplateById('nonexistent');
      expect(template).toBeNull();
    });
  });

  describe('matchTemplate', () => {
    it('should match fullstack keywords', () => {
      expect(matchTemplate('创建一个带API的全栈应用')?.type).toBe('fullstack');
      expect(matchTemplate('I need a nextjs project')?.type).toBe('fullstack');
      expect(matchTemplate('做一个AI聊天机器人')?.type).toBe('fullstack');
      expect(matchTemplate('需要数据库和登录功能')?.type).toBe('fullstack');
      expect(matchTemplate('backend api with crud')?.type).toBe('fullstack');
    });

    it('should match complex keywords', () => {
      expect(matchTemplate('create a react app with components')?.type).toBe('complex');
      expect(matchTemplate('做一个组件化的交互应用')?.type).toBe('complex');
      expect(matchTemplate('typescript todo app')?.type).toBe('complex');
      expect(matchTemplate('需要状态管理的前端应用')?.type).toBe('complex');
    });

    it('should match simple keywords', () => {
      expect(matchTemplate('hello world page')?.type).toBe('simple');
      expect(matchTemplate('simple static page')?.type).toBe('simple');
      expect(matchTemplate('做一个简单的展示页面')?.type).toBe('simple');
      expect(matchTemplate('basic html page')?.type).toBe('simple');
    });

    it('should default to simple template', () => {
      expect(matchTemplate('随便做点什么')?.type).toBe('simple');
      expect(matchTemplate('test')?.type).toBe('simple');
    });

    it('should prioritize fullstack over complex', () => {
      // "react app with api" has both react (complex) and api (fullstack)
      // fullstack should win
      expect(matchTemplate('react app with api and database')?.type).toBe('fullstack');
    });
  });
});
