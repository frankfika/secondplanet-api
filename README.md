# SecondPlanet API

基于 Hono + Cloudflare Workers 的社区应用后端 API。

## 技术栈

- **框架**: [Hono](https://hono.dev) 4.6
- **运行时**: Cloudflare Workers
- **数据库**: Neon (PostgreSQL) + Prisma 5.22
- **认证**: JWT (jose) + Web Crypto API
- **验证**: Zod + @hono/zod-validator
- **Web3**: tweetnacl (Solana) + ethers (EVM)

## 项目结构

```
src/
├── index.ts              # 应用入口
├── routes/               # API 路由
│   ├── auth.ts          # 认证 (登录/注册/钱包登录)
│   ├── planets.ts       # 星球管理
│   ├── posts.ts         # 帖子/评论
│   ├── events.ts        # 活动/RSVP
│   ├── members.ts       # 成员管理
│   ├── users.ts         # 用户资料
│   ├── upload.ts        # 文件上传 (R2)
│   └── notifications.ts # 通知系统
├── middleware/           # 中间件
│   └── auth.ts          # JWT 认证中间件
├── lib/                  # 工具库
│   ├── auth.ts          # 密码哈希/Token 签名
│   └── db.ts            # Prisma 客户端
├── types/
│   └── env.ts           # 环境变量类型
prisma/
└── schema.prisma        # 数据模型
```

## 开发

```bash
# 安装依赖
npm install

# 本地开发 (端口 8787)
npm run dev

# 类型检查
npx tsc --noEmit

# 部署到 Cloudflare
npm run deploy
```

## API 路由

### 认证
- `POST /api/auth/register` - 邮箱注册
- `POST /api/auth/login` - 邮箱登录
- `POST /api/auth/wechat` - 微信登录
- `POST /api/auth/solana` - Solana 钱包登录
- `POST /api/auth/evm` - EVM 钱包登录
- `DELETE /api/auth/me` - 注销账号
- `GET /api/auth/me` - 获取当前用户

### 星球
- `GET /api/planets` - 星球列表
- `POST /api/planets` - 创建星球
- `GET /api/planets/:id` - 星球详情
- `PATCH /api/planets/:id` - 更新星球
- `POST /api/planets/:id/join` - 加入星球
- `POST /api/planets/:id/transfer-ownership` - 转让所有权

### 帖子
- `GET /api/planets/:planetId/posts` - 帖子列表
- `POST /api/planets/:planetId/posts` - 创建帖子
- `GET /api/posts/:id` - 帖子详情
- `PATCH /api/posts/:id` - 更新帖子
- `DELETE /api/posts/:id` - 删除帖子
- `POST /api/posts/:id/like` - 点赞
- `POST /api/posts/:id/comments` - 评论

### 活动
- `GET /api/planets/:planetId/events` - 活动列表
- `POST /api/planets/:planetId/events` - 创建活动
- `GET /api/events/:id` - 活动详情
- `PATCH /api/events/:id` - 更新活动
- `DELETE /api/events/:id` - 删除活动
- `POST /api/events/:id/rsvp` - 报名活动

### 成员
- `GET /api/planets/:planetId/members` - 成员列表
- `PATCH /api/planets/:planetId/members/me` - 更新我的资料
- `PATCH /api/planets/:planetId/members/:userId/role` - 更新角色
- `DELETE /api/planets/:planetId/members/:userId` - 移除成员

### 通知
- `GET /api/notifications` - 通知列表
- `GET /api/notifications/unread-count` - 未读数量
- `PATCH /api/notifications/:id/read` - 标记已读
- `PATCH /api/notifications/read-all` - 全部已读
- `DELETE /api/notifications/:id` - 删除通知

### 用户
- `GET /api/users/me` - 我的资料
- `PATCH /api/users/me` - 更新资料
- `GET /api/users/me/planets` - 我的星球
- `GET /api/users/me/events` - 我的活动
- `GET /api/users/me/assets` - 我的资产

### 上传
- `POST /api/upload` - 上传文件到 R2
- `DELETE /api/upload/:filename` - 删除文件

## 环境变量

```
DATABASE_URL=postgresql://...
JWT_SECRET=your-jwt-secret
JWT_REFRESH_SECRET=your-refresh-secret
ENVIRONMENT=development
```

## 数据库模型

- **User** - 用户
- **Planet** - 星球（社区）
- **Membership** - 成员关系
- **Post** - 帖子
- **Comment** - 评论
- **Event** - 活动
- **EventRsvp** - 活动报名
- **Notification** - 通知
- **Quest/QuestProgress** - 任务系统

## License

MIT
