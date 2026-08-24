# NodeByte Crawl 爬虫声明

> **最后更新**: 2025-08-24  
> **版本**: v3.6  
> **UA 标识**: `NodeByte Crawl/3.6 (+https://nodebyte.cn)`

---

## 关于我们

NodeByte Crawl 是一个开源的网页抓取 API 服务，基于 Playwright 无头浏览器技术，提供 JavaScript 渲染后的网页内容提取。我们尊重网站所有者的权益，并制定了以下爬取规则。

## 我们的爬虫标识

我们的爬虫在每个 HTTP 请求中都会携带以下 User-Agent 标识：

```
Mozilla/5.0 ... NodeByte Crawl/3.6 (+https://nodebyte.cn)
```

您可以通过以下方式识别我们的爬虫：
- **User-Agent**：包含 `NodeByte Crawl` 字段
- **网站标识 URL**：`https://nodebyte.cn`
- **UA 后缀格式**：`NodeByte Crawl/<版本号> (+https://nodebyte.cn)`

## 爬取规则

### 1. 遵守 robots.txt

我们严格遵守目标网站的 `robots.txt` 规则。如果您的 `robots.txt` 禁止我们抓取某些路径，我们不会抓取这些路径。

**示例 robots.txt 配置**：

```
# 完全禁止 NodeByte Crawl 抓取
User-agent: NodeByte Crawl
Disallow: /

# 仅允许抓取特定路径
User-agent: NodeByte Crawl
Allow: /public/
Disallow: /private/
```

### 2. 请求频率限制

- **前台请求**（单页抓取）：最多 4 个并发
- **后台请求**（批量/爬取）：最多 2 个并发
- **总并发上限**：6 个同时进行的浏览器实例
- **默认超时**：45 秒
- **重试退避**：遇到 403/429/503 时指数退避重试，最多 2 次

### 3. Cookie 与隐私

**我们的爬虫不会保留任何 Cookie 或会话数据。**

- 每次抓取请求使用一个全新的浏览器上下文（相当于隐私模式/无痕模式）
- 抓取完成后，上下文立即销毁，所有 Cookie、localStorage、sessionStorage 被清除
- Cookie 仅在 API 调用方明确传入时才会被使用，且仅用于该单次请求
- 我们不会在服务器上存储任何 Cookie 数据

### 4. 资源占用

- 每个浏览器实例约占 100MB 内存
- 我们会在抓取完成后立即释放资源
- 不会对目标服务器发起 DDoS 级别的请求

### 5. 内容提取

- 我们仅提取页面的主要内容（文章正文、标题、链接）
- 我们会移除导航栏、广告、侧边栏、页脚等非核心内容
- 我们不会下载或存储图片、视频、字体等媒体资源（除非明确请求截图功能）

## 如何屏蔽我们的爬虫

### 方法 1：robots.txt（推荐）

在网站根目录创建或编辑 `robots.txt`：

```
User-agent: NodeByte Crawl
Disallow: /
```

### 方法 2：User-Agent 检测

在服务器端检测 User-Agent，拒绝包含 `NodeByte Crawl` 的请求：

**Nginx**:
```nginx
if ($http_user_agent ~* "NodeByte Crawl") {
    return 403;
}
```

**Apache (.htaccess)**:
```apache
RewriteEngine On
RewriteCond %{HTTP_USER_AGENT} NodeByte Crawl [NC]
RewriteRule .* - [F,L]
```

### 方法 3：防火墙规则

在 Cloudflare 或其他 WAF 中添加规则，拦截包含 `NodeByte Crawl` 的 User-Agent。

## 数据处理声明

- 抓取的内容仅在 API 响应中返回给调用方
- 我们不会在服务器上持久化存储抓取到的内容
- 异步作业（批量/爬取）的结果在内存中保留 30 分钟后自动清除
- 我们不会将抓取的数据用于任何商业目的

## 联系方式

- **项目地址**: https://github.com/cshdotcom/free-web-scraper
- **网站**: https://nodebyte.cn
- **UA 标识 URL**: https://nodebyte.cn

如果您认为我们的爬虫违反了上述规则，或需要调整抓取行为，请通过 GitHub Issues 联系我们。

## 许可证

本项目基于 MIT 许可证开源。
