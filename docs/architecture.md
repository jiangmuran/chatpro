# 项目架构与数据流

## 总体结构

- 前台 Web：聊天 UI、主题、人设卡、游客模式
- 后台 Web：运营与合规控制台
- 服务端 API：鉴权、聊天代理、审计留档
- SQLite：用户、会话、日志、配置

## 数据流

1. 客户端组装消息与当前人设
2. 服务端注入系统 prompt（用户名、时间、地区等）
3. 调用上游模型 API
4. 回写响应与用量统计
5. 前端本地保存会话；后台保存留档

## 本地存储

- LocalStorage：主题、人设选择、登录 token
- IndexedDB：聊天记录与草稿

## SQLite 结构建议

### users

- id (pk)
- user_id (unique)
- username
- region
- tag
- quota_enhanced
- quota_pro
- created_at

### conversations

- id (pk)
- user_id
- persona_id
- model
- created_at

### messages

- id (pk)
- conversation_id
- role
- content
- created_at
- usage_prompt
- usage_completion

### personas

- id (pk)
- name
- type (scenario | professional)
- prompt
- status (pending | approved)

### audit_logs

- id (pk)
- user_id
- ip
- ua
- action
- created_at

### metrics_daily

- date
- total_requests
- avg_latency
- token_total
- concurrent_peak

### announcements

- id (pk)
- title
- content
- status
- created_at

### sensitive_words

- id (pk)
- word
- category

## 系统级 prompt 规则

- 将用户基础信息放在所有系统 prompt 最前面
- 可根据模型类型配置不同系统级上限
- 支持用户标签跳过敏感词审查
