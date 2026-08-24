# NodeByte Crawl — 开源 Firecrawl 替代方案，自部署的 AI 网页抓取 API

> 一个端口、一个进程、零外部依赖。打包 Chromium，任何 Linux 服务器解压即用。

## 这是什么？

**NodeByte Crawl** 是一个完全开源的网页抓取 API 服务，兼容 Firecrawl v2 接口规范，支持 OpenWebUI 搜索集成。你可以在自己的服务器上一键部署，无需依赖任何第三方云服务。

简单来说：**你给一个 URL，它返回干净的 Markdown。** 中间的 JavaScript 渲染、正文提取、反爬绕过、多引擎搜索，全部自动处理。

## 为什么选择 NodeByte Crawl？

### 1. 完全自部署，数据不出你的服务器

与 Firecrawl、ScrapingBee、Browserless 等云服务不同，NodeByte Crawl 运行在你自己的服务器上。抓取的内容从目标网站直接到你的应用，不经过任何中间商。

- 没有按请求计费
- 没有 API 调用配额
- 没有数据流向第三方
- 你的 Cookie、你的数据，你做主

### 2. 真正的 JavaScript 渲染

基于 Playwright 无头 Chromium 浏览器，不是简单的 HTTP 请求 + 正则提取。我们做的是：

- 完整渲染 SPA（React、Vue、Angular）
- 执行页面 JavaScript，等待动态内容加载
- 滚动页面触发懒加载图片
- 自动关闭 Cookie 同意弹窗
- 截图功能（完整页面 PNG）

### 3. Firecrawl v2 完全兼容

API 接口与 Firecrawl v2 完全一致，你可以直接用 Firecrawl SDK，只需把 `baseUrl` 改成你的服务器地址：

```python
from firecrawl import FirecrawlApp
app = FirecrawlApp(api_key="your-key", api_url="https://your-server.com")
result = app.scrape_url("https://example.com", params={"formats": ["markdown"]})
```

支持的全部端点：

| 端点 | 功能 |
|------|------|
| `POST /v2/scrape` | 单页抓取 → Markdown/HTML/链接/截图 |
| `POST /v2/scrape/batch` | 同步批量抓取（多 URL 并发） |
| `POST /v2/batch/scrape` | 异步批量作业（返回 jobId，轮询） |
| `POST /v2/crawl` | BFS 递归爬取（maxDepth 1-5） |
| `POST /v2/map` | 站点链接地图 |
| `POST /v2/search` | 多引擎 Web 搜索 |
| `GET /search?q=&format=json` | SearxNG 兼容（OpenWebUI 可用） |

### 4. 多引擎搜索聚合

不只是爬虫，还是一个搜索引擎。聚合多个搜索引擎的结果：

- **Bing** — 直接抓取搜索结果页，解析 `b_algo` 块
- **DuckDuckGo** — Instant Answer API
- **SearXNG** — 元搜索（聚合 Google/Bing/DDG），支持自定义实例
- **Wikipedia** — opensearch API

**容错机制**：一个引擎失败不影响其他引擎。结果自动去重、按相关性排序。

**自动语言检测**：查询含中文 → 搜索中文结果，查询含日文 → 搜索日文结果。也支持指定语言。

### 5. 设备仿真

不只是桌面浏览器。支持设备仿真：

```json
{"url": "https://example.com", "device": "mobile"}
```

- `auto`（默认）— 50/50 随机桌面/手机
- `desktop` — 桌面 UA + 大视口
- `mobile` — 手机 UA + 小视口 + 触摸

UA 池包含 5 个桌面 UA + 4 个手机 UA，自动轮换防反爬。

### 6. Cookie 注入（隐私模式安全）

需要抓取需要登录的页面？通过 API 传入 Cookie：

```bash
curl -X POST https://your-server.com/v2/scrape \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/dashboard","cookies":"session=abc123; token=xyz"}'
```

**安全模型**：每次抓取使用全新的浏览器上下文（无痕模式），Cookie 仅用于该单次请求，抓取完成后立即销毁。多次并发请求之间 Cookie 零泄漏。

### 7. 隐身反爬

- 移除 `navigator.webdriver` 标识
- 伪造 plugins、languages、platform
- 添加 `window.chrome` 对象
- WebGL vendor 伪装
- UA 轮换（5 桌面 + 4 手机）
- Cookie 同意弹窗自动关闭
- 403/429/503 指数退避重试

### 8. 资源管理

**双池并发架构**，确保快速请求不被后台任务阻塞：

| 池 | 并发 | 用途 |
|---|---|---|
| 前台 | 4 个 | 单页抓取（同步，快速响应） |
| 后台 | 2 个 | 批量/爬取（异步，后台处理） |
| 总计 | 6 个 | ~600MB 内存（有界，不 OOM） |

### 9. 国际化

文档 + 测试控制台支持中英文切换。自动检测浏览器语言。

### 10. 暗色模式

完整的暗色主题支持。

## 快速开始

### 方式 1：Standalone 包（推荐，零配置）

```bash
# 下载（348MB，含打包 Chromium）
wget https://github.com/cshdotcom/free-web-scraper/releases/download/v3.6.0/nodebyte-crawl-v3.6.zip
unzip nodebyte-crawl-v3.6.zip
cd nodebyte-crawl

# 如果系统缺少 Chromium 依赖
bash install-deps.sh

# 启动
bash start.sh
```

打开 `http://localhost:3000` — 你会看到一个集成了 API 文档 + 交互式测试控制台的页面。

### 方式 2：从源码构建

```bash
git clone https://github.com/cshdotcom/free-web-scraper.git
cd free-web-scraper
bun install
bun run dev
```

## API 示例

### 抓取单个页面

```bash
curl -X POST http://localhost:3000/v2/scrape \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "formats": ["markdown", "html", "links"],
    "onlyMainContent": true,
    "device": "auto"
  }'
```

响应：

```json
{
  "success": true,
  "data": {
    "statusCode": 200,
    "markdown": "# Example Domain\n\nThis domain is for use...",
    "html": "<article>...</article>",
    "links": [{"url": "https://iana.org/domains/example", "text": "Learn more"}],
    "metadata": {"title": "Example Domain", "statusCode": 200},
    "strategy": "explicit-selector"
  },
  "attempts": 1
}
```

### 多引擎搜索

```bash
curl -X POST http://localhost:3000/v2/search \
  -H "Content-Type: application/json" \
  -d '{"query":"Bun JavaScript runtime","limit":10,"lang":"auto"}'
```

### OpenWebUI 集成

在 OpenWebUI 设置中配置 `SEARXNG_API_URL=http://localhost:3000/search`，即可使用 NodeByte Crawl 作为搜索后端。

## 配置

所有配置通过 `.env` 文件管理。核心选项：

```env
PORT=3000                              # 单端口（文档 + API）
CRAWLER_API_KEYS=key1,key2,key3        # 多 API key（逗号分隔）
CRAWLER_UA_SITE_URL=https://yoursite.com  # UA 中的网址标识
CRAWLER_MAX_CONCURRENCY=4              # 前台并发
CRAWLER_BACKGROUND_CONCURRENCY=2       # 后台并发
CRAWLER_SEARCH_LANG=auto              # 搜索语言自动检测
CRAWLER_SEARXNG_INSTANCES=My Search|https://searx.example.com  # 自定义 SearXNG
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 框架 | Next.js 16 (App Router, standalone) |
| 语言 | TypeScript 5 |
| 浏览器 | Playwright + 打包 Chromium 1200 |
| Markdown | Turndown (GFM) |
| UI | Tailwind CSS 4 + shadcn/ui |
| 暗色模式 | next-themes |
| 国际化 | 自研 i18n (EN/ZH) |

## 与 Firecrawl 对比

| 特性 | Firecrawl (云服务) | NodeByte Crawl (自部署) |
|------|-------------------|------------------------|
| 定价 | 按请求计费 | 免费（开源） |
| 数据流向 | 经过 Firecrawl 服务器 | 直接在你服务器上 |
| API 兼容 | — | 完全兼容 Firecrawl v2 |
| JS 渲染 | ✅ | ✅ (Playwright) |
| 多引擎搜索 | ❌ | ✅ (Bing+DDG+SearXNG+Wikipedia) |
| 设备仿真 | ❌ | ✅ (auto/desktop/mobile) |
| Cookie 注入 | ❌ | ✅ (隐私模式安全) |
| OpenWebUI 兼容 | ❌ | ✅ (SearxNG 格式) |
| 自定义 UA 标识 | ❌ | ✅ (网站 URL) |
| 部署难度 | 注册即用 | 解压即用 |

## 项目地址

- **GitHub**: https://github.com/cshdotcom/free-web-scraper
- **下载**: https://github.com/cshdotcom/free-web-scraper/releases
- **网站**: https://nodebyte.cn
- **License**: MIT

---

*NodeByte Crawl — 开源、自部署、Firecrawl 兼容的网页抓取 API。你的爬虫，你做主。*
