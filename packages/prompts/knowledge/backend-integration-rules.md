# 后端集成指导规范

## 核心原则

- **优先使用项目已配置的数据库方案**
- **表名规范**：使用 `{projectId}_{tableName}` 格式，避免多项目表名冲突

---

## 🔍 tsconfig.json 必需配置

**确保路径别名配置正确**（避免模块导入错误）：
```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./*"]
    }
  }
}
```

**检查清单**：
- [ ] `baseUrl` 设置为 `"."`
- [ ] `paths` 包含 `"@/*": ["./*"]`
- [ ] 修改后重启开发服务器

---

## 📦 必需的依赖包

**数据库相关**：
```bash
pnpm add pg
pnpm add -D @types/pg
```
