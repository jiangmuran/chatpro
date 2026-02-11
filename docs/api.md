# 接口文档

## 约定

- Base URL: `/api`
- 所有时间为 ISO 8601
- 用户信息系统 prompt 在服务端合并注入
- 返回统一结构：`{ code, message, data }`

## 鉴权

### POST /auth/login

用途：唯一字符串登录

请求

```
{
  "token": "user-unique-string"
}
```

响应

```
{
  "code": 0,
  "data": {
    "userId": "xxxx-xxxx",
    "username": "optional",
    "region": "CN",
    "modelQuota": {
      "enhanced": 10,
      "pro": 5
    }
  }
}
```

## 会话与消息

### POST /chat/message

用途：发送消息

请求

```
{
  "conversationId": "uuid",
  "model": "normal | enhanced | pro",
  "personaId": "optional",
  "messages": [
    { "role": "user", "content": "hello" }
  ],
  "client": {
    "device": "mobile | desktop",
    "ua": "..."
  }
}
```

响应

```
{
  "code": 0,
  "data": {
    "messageId": "uuid",
    "content": "assistant reply",
    "usage": { "prompt": 12, "completion": 56, "total": 68 },
    "quotaLeft": { "enhanced": 9, "pro": 5 }
  }
}
```

### GET /chat/conversations

用途：获取会话列表（用于服务端留档查询）

### GET /chat/conversations/:id

用途：获取某会话详情

## 人设卡

### GET /personas

用途：获取公开人设卡列表

### POST /personas

用途：上传人设卡（待审核）

请求

```
{
  "name": "初音未来",
  "type": "scenario | professional",
  "prompt": "..."
}
```

## 主题

### GET /themes

用途：获取主题列表

## 公告与敏感词

### GET /admin/announcements
### POST /admin/announcements
### GET /admin/sensitive-words
### POST /admin/sensitive-words

## 运营与监控

### GET /admin/metrics/overview

返回：今日请求量、并发、平均响应时间、token 消耗趋势

### GET /admin/metrics/traffic

返回：来源、设备、地区

### GET /admin/metrics/keywords

返回：请求最多词语

## 用户管理

### GET /admin/users
### POST /admin/users
### GET /admin/users/:id
### DELETE /admin/users/:id

## 模型配置

### GET /admin/models
### POST /admin/models

用途：设置模型名称与上游模型 ID 对应关系

## 访问限制

### POST /admin/ip/block
### POST /admin/ip/limit

## 日志

### GET /admin/logs

返回：上游 API 调用、错误、延时
