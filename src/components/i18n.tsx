'use client';

import * as React from 'react';

export type Lang = 'en' | 'zh';

interface I18nContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
}

const I18nContext = React.createContext<I18nContextValue | null>(null);

// Translation dictionary. Keys are dot-separated paths.
const TRANSLATIONS: Record<Lang, Record<string, string>> = {
  en: {
    'nav.quickStart': 'Quick start',
    'nav.features': 'Features',
    'nav.endpoints': 'Endpoints',
    'nav.config': 'Config',
    'nav.openwebui': 'OpenWebUI',
    'nav.console': 'Console',
    'hero.title': 'NodeByte Crawl',
    'hero.tagline': 'Firecrawl v2-compatible web scraping API. JavaScript-rendered. Multi-engine search. OpenWebUI compatible.',
    'hero.badge.jsRendered': 'JS-Rendered',
    'hero.badge.firecrawlV2': 'Firecrawl v2',
    'hero.badge.multiEngine': 'Multi-Engine Search',
    'hero.badge.stealth': 'Stealth',
    'hero.copyBaseUrl': 'Copy base URL',
    'quickStart.title': 'Quick start',
    'quickStart.step1.title': 'Get an API key',
    'quickStart.step1.body': 'Set CRAWLER_API_KEYS in your .env.local (one or more comma-separated keys). Restart the app. Skip this if auth is disabled.',
    'quickStart.step2.title': 'Send a request',
    'quickStart.step2.body': 'POST /v2/scrape with your URL and the formats you want. Pass the key as Authorization: Bearer.',
    'quickStart.step3.title': 'Render the result',
    'quickStart.step3.body': 'Use data.markdown, data.html, data.links, or data.screenshot. Poll crawl/batch jobs every 2s until status is "completed".',
    'features.title': 'Features',
    'features.jsRendering.title': 'JavaScript Rendering',
    'features.jsRendering.desc': 'Uses a real headless Chromium via Playwright, so SPAs and JS-rendered content are captured.',
    'features.mainContent.title': 'Main Content Extraction',
    'features.mainContent.desc': 'Removes nav, footer, ads, sidebars; keeps the article body. Configurable via include/exclude tags.',
    'features.markdownOutput.title': 'Markdown Output',
    'features.markdownOutput.desc': 'Clean GFM markdown with fenced code blocks, tables, and links. No zero-width chars or mojibake.',
    'features.concurrent.title': 'Concurrent Scraping',
    'features.concurrent.desc': 'Scrape multiple URLs in parallel with bounded concurrency (configurable via CRAWLER_MAX_CONCURRENCY).',
    'features.stealth.title': 'Stealth & Anti-Bot',
    'features.stealth.desc': 'Rotating user agents, navigator.webdriver removal, cookie-banner auto-dismissal, and retry with backoff on 403/429/503.',
    'features.multiEngine.title': 'Multi-Engine Search',
    'features.multiEngine.desc': 'Bing + DuckDuckGo + SearXNG (meta-search) + Wikipedia. One engine failing doesn\'t break the others.',
    'endpoints.title': 'Endpoints',
    'endpoints.subtitle': 'Seven endpoints cover the full Firecrawl v2-compatible surface, plus a SearxNG-compatible /search for OpenWebUI.',
    'endpoints.param': 'Parameter',
    'endpoints.type': 'Type',
    'endpoints.required': 'Required',
    'endpoints.default': 'Default',
    'endpoints.description': 'Description',
    'endpoints.requestExample': 'Request example',
    'endpoints.responseExample': 'Response example',
    'config.title': 'Configuration',
    'config.subtitle': 'All options are set via environment variables. See .env.example for the full reference.',
    'openwebui.title': 'OpenWebUI Integration',
    'openwebui.subtitle': 'Use NodeByte Crawl as a SearxNG-compatible search provider for OpenWebUI.',
    'console.title': 'Test console',
    'console.subtitle': 'Try every endpoint directly from this page. All requests go through the Next.js proxy routes — no CORS, no exposed ports. Save your API key above once, and it will be reused across all tabs.',
    'console.apiKey': 'API Key',
    'console.authDisabled': 'Auth disabled — testing is open',
    'console.apiKeyRequired': 'API key required',
    'footer.text': 'NodeByte Crawl · Firecrawl v2 compatible · OpenWebUI compatible',
  },
  zh: {
    'nav.quickStart': '快速开始',
    'nav.features': '功能',
    'nav.endpoints': '端点',
    'nav.config': '配置',
    'nav.openwebui': 'OpenWebUI',
    'nav.console': '控制台',
    'hero.title': 'NodeByte Crawl',
    'hero.tagline': 'Firecrawl v2 兼容的网页抓取 API。支持 JS 渲染。多引擎搜索。兼容 OpenWebUI。',
    'hero.badge.jsRendered': 'JS 渲染',
    'hero.badge.firecrawlV2': 'Firecrawl v2',
    'hero.badge.multiEngine': '多引擎搜索',
    'hero.badge.stealth': '隐身模式',
    'hero.copyBaseUrl': '复制基础 URL',
    'quickStart.title': '快速开始',
    'quickStart.step1.title': '获取 API 密钥',
    'quickStart.step1.body': '在 .env.local 中设置 CRAWLER_API_KEYS（一个或多个逗号分隔的密钥）。重启应用。如果禁用了认证则跳过此步。',
    'quickStart.step2.title': '发送请求',
    'quickStart.step2.body': 'POST /v2/scrape，传入你的 URL 和想要的格式。密钥通过 Authorization: Bearer 头传递。',
    'quickStart.step3.title': '渲染结果',
    'quickStart.step3.body': '使用 data.markdown、data.html、data.links 或 data.screenshot。每 2 秒轮询 crawl/batch 作业直到 status 为 "completed"。',
    'features.title': '功能',
    'features.jsRendering.title': 'JavaScript 渲染',
    'features.jsRendering.desc': '通过 Playwright 使用真实的 Chromium 无头浏览器，可抓取 SPA 和 JS 渲染的内容。',
    'features.mainContent.title': '正文提取',
    'features.mainContent.desc': '移除导航栏、页脚、广告、侧边栏；保留正文。可通过 include/exclude 标签配置。',
    'features.markdownOutput.title': 'Markdown 输出',
    'features.markdownOutput.desc': '干净的 GFM Markdown，支持围栏代码块、表格和链接。无零宽字符或乱码。',
    'features.concurrent.title': '并发抓取',
    'features.concurrent.desc': '通过有界并发并行抓取多个 URL（可通过 CRAWLER_MAX_CONCURRENCY 配置）。',
    'features.stealth.title': '隐身与反爬',
    'features.stealth.desc': '轮换用户代理、移除 navigator.webdriver、自动关闭 cookie 弹窗、403/429/503 退避重试。',
    'features.multiEngine.title': '多引擎搜索',
    'features.multiEngine.desc': 'Bing + DuckDuckGo + SearXNG（元搜索）+ Wikipedia。单个引擎失败不影响其他。',
    'endpoints.title': '端点',
    'endpoints.subtitle': '七个端点覆盖完整的 Firecrawl v2 兼容接口，外加兼容 SearxNG 的 /search 供 OpenWebUI 使用。',
    'endpoints.param': '参数',
    'endpoints.type': '类型',
    'endpoints.required': '必填',
    'endpoints.default': '默认',
    'endpoints.description': '描述',
    'endpoints.requestExample': '请求示例',
    'endpoints.responseExample': '响应示例',
    'config.title': '配置',
    'config.subtitle': '所有选项通过环境变量设置。完整参考请见 .env.example。',
    'openwebui.title': 'OpenWebUI 集成',
    'openwebui.subtitle': '将 NodeByte Crawl 用作 OpenWebUI 的 SearxNG 兼容搜索提供者。',
    'console.title': '测试控制台',
    'console.subtitle': '直接在此页面试用每个端点。所有请求通过 Next.js 代理路由——无 CORS、无暴露端口。在上方保存一次 API 密钥，即可在所有标签页中复用。',
    'console.apiKey': 'API 密钥',
    'console.authDisabled': '认证已禁用——测试开放',
    'console.apiKeyRequired': '需要 API 密钥',
    'footer.text': 'NodeByte Crawl · Firecrawl v2 兼容 · OpenWebUI 兼容',
  },
};

const STORAGE_KEY = 'nbc-lang';

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = React.useState<Lang>('en');

  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY) as Lang | null;
      if (saved === 'en' || saved === 'zh') {
        setLangState(saved);
      } else {
        // Auto-detect from browser language.
        const browserLang = navigator.language.toLowerCase();
        if (browserLang.startsWith('zh')) {
          setLangState('zh');
        }
      }
    } catch {
      // ignore
    }
  }, []);

  const setLang = React.useCallback((l: Lang) => {
    setLangState(l);
    try { window.localStorage.setItem(STORAGE_KEY, l); } catch { /* ignore */ }
  }, []);

  const t = React.useCallback((key: string) => {
    return TRANSLATIONS[lang][key] || TRANSLATIONS.en[key] || key;
  }, [lang]);

  return (
    <I18nContext.Provider value={{ lang, setLang, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = React.useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
