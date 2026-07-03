/* =========================================================
   My Blog — 순수 바닐라 JS 블로그 엔진
   - 해시 라우팅: #/ (목록), #/post/<slug> (상세)
   - posts/posts.json 매니페스트에서 글 목록을 읽는다
   - 각 .md의 YAML 프론트매터를 파싱해 메타데이터 사용
   ========================================================= */

const POSTS_DIR = "posts";
const MANIFEST = `${POSTS_DIR}/posts.json`;

const app = document.getElementById("app");

/* ---------- 유틸 ---------- */

// HTML 이스케이프 (목록의 제목/요약 등 텍스트 삽입 시 XSS 방지)
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// 파일명 -> slug (예: "hello-world.md" -> "hello-world")
function toSlug(filename) {
  return filename.replace(/\.md$/i, "");
}

// 날짜 문자열을 보기 좋게 (실패 시 원본 반환)
function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/* ---------- 프론트매터 파싱 (의존성 없음) ---------- */
// `---` 로 감싼 블록에서 key: value 를 읽는다.
// 배열은 [a, b, c] 인라인 형식과 하이픈(-) 목록 형식 모두 지원.
function parseFrontmatter(text) {
  const match = /^﻿?---\s*\n([\s\S]*?)\n---\s*\n?/.exec(text);
  if (!match) return { meta: {}, body: text };

  const meta = {};
  const lines = match[1].split("\n");
  let currentKey = null;

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) continue;

    // "- item" 형식의 리스트 항목 (직전 key에 누적)
    const listItem = /^\s*-\s+(.*)$/.exec(line);
    if (listItem && currentKey) {
      if (!Array.isArray(meta[currentKey])) meta[currentKey] = [];
      meta[currentKey].push(stripQuotes(listItem[1].trim()));
      continue;
    }

    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;

    const key = kv[1];
    let value = kv[2].trim();
    currentKey = key;

    if (value === "") {
      // 다음 줄들이 리스트일 수 있음
      meta[key] = "";
    } else if (value.startsWith("[") && value.endsWith("]")) {
      // 인라인 배열
      meta[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => stripQuotes(s.trim()))
        .filter(Boolean);
    } else {
      meta[key] = stripQuotes(value);
    }
  }

  const body = text.slice(match[0].length);
  return { meta, body };
}

function stripQuotes(s) {
  return s.replace(/^["']|["']$/g, "");
}

// 본문에서 요약 추출: 첫 문단(공백 아닌 텍스트 줄)
function makeExcerpt(body, max = 140) {
  const plain = body
    .replace(/```[\s\S]*?```/g, "") // 코드블록 제거
    .replace(/^#.*$/gm, "") // 제목 제거
    .replace(/[#>*_`~\-]/g, "") // 마크다운 기호 제거
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // 링크/이미지 -> 텍스트
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const text = (plain[0] || "").trim();
  return text.length > max ? text.slice(0, max).trimEnd() + "…" : text;
}

/* ---------- 데이터 로딩 ---------- */

async function fetchText(url) {
  const res = await fetch(url, { cache: "no-cache" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
}

async function fetchManifest() {
  const res = await fetch(MANIFEST, { cache: "no-cache" });
  if (!res.ok) throw new Error(`매니페스트를 불러올 수 없습니다 (${res.status})`);
  const data = await res.json();
  // 배열 또는 { posts: [...] } 형식 모두 허용
  return Array.isArray(data) ? data : data.posts || [];
}

// 각 글의 메타데이터를 모아 목록용 데이터 생성
async function loadPostSummaries() {
  const files = await fetchManifest();
  const results = await Promise.all(
    files.map(async (file) => {
      try {
        const text = await fetchText(`${POSTS_DIR}/${file}`);
        const { meta, body } = parseFrontmatter(text);
        return {
          slug: toSlug(file),
          title: meta.title || toSlug(file),
          date: meta.date || "",
          tags: Array.isArray(meta.tags) ? meta.tags : [],
          excerpt: meta.summary || makeExcerpt(body),
        };
      } catch (e) {
        console.warn(`글을 읽지 못했습니다: ${file}`, e);
        return null;
      }
    })
  );

  return results
    .filter(Boolean)
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

/* ---------- 렌더링 ---------- */

function renderState(message, isError = false) {
  app.innerHTML = `<p class="state ${
    isError ? "state--error" : ""
  }">${escapeHtml(message)}</p>`;
}

function renderList(posts) {
  document.title = "My Blog";

  if (!posts.length) {
    renderState("아직 작성된 글이 없습니다.");
    return;
  }

  const items = posts
    .map((p) => {
      const tags = p.tags.length
        ? `<span class="tags">${p.tags
            .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
            .join("")}</span>`
        : "";
      const date = p.date
        ? `<time datetime="${escapeHtml(p.date)}">${escapeHtml(
            formatDate(p.date)
          )}</time>`
        : "";
      return `
        <li class="post-card">
          <h2 class="post-card__title">
            <a href="#/post/${encodeURIComponent(p.slug)}">${escapeHtml(
        p.title
      )}</a>
          </h2>
          <div class="post-card__meta">${date}${tags}</div>
          <p class="post-card__excerpt">${escapeHtml(p.excerpt)}</p>
        </li>`;
    })
    .join("");

  app.innerHTML = `<ul class="post-list">${items}</ul>`;
}

async function renderPost(slug) {
  renderState("불러오는 중…");
  try {
    const text = await fetchText(`${POSTS_DIR}/${slug}.md`);
    const { meta, body } = parseFrontmatter(text);

    const title = meta.title || slug;
    document.title = `${title} · My Blog`;

    const htmlBody = marked.parse(body);

    const date = meta.date
      ? `<time datetime="${escapeHtml(meta.date)}">${escapeHtml(
          formatDate(meta.date)
        )}</time>`
      : "";
    const tags =
      Array.isArray(meta.tags) && meta.tags.length
        ? `<span class="tags">${meta.tags
            .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
            .join("")}</span>`
        : "";

    app.innerHTML = `
      <article class="post">
        <header class="post__header">
          <h1 class="post__title">${escapeHtml(title)}</h1>
          <div class="post__meta">${date}${tags}</div>
        </header>
        <div class="markdown-body">${htmlBody}</div>
        <a class="back-link" href="#/">← 목록으로</a>
      </article>`;

    // 코드 하이라이팅 (highlight.js 로드된 경우)
    if (window.hljs) {
      app.querySelectorAll("pre code").forEach((el) => {
        window.hljs.highlightElement(el);
      });
    }

    window.scrollTo(0, 0);
  } catch (e) {
    renderState(`글을 불러올 수 없습니다: ${e.message}`, true);
  }
}

/* ---------- 라우터 ---------- */

async function router() {
  const hash = location.hash || "#/";
  const postMatch = /^#\/post\/(.+)$/.exec(hash);

  if (postMatch) {
    const slug = decodeURIComponent(postMatch[1]);
    await renderPost(slug);
    return;
  }

  // 기본: 목록
  renderState("불러오는 중…");
  try {
    const posts = await loadPostSummaries();
    renderList(posts);
  } catch (e) {
    renderState(`목록을 불러올 수 없습니다: ${e.message}`, true);
  }
}

/* ---------- 테마 토글 ---------- */

const HLJS_THEME = {
  light: "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11/styles/github.min.css",
  dark: "https://cdn.jsdelivr.net/npm/@highlightjs/cdn-assets@11/styles/github-dark.min.css",
};

// 현재 테마에 맞는 코드 하이라이팅 스타일시트로 교체
function applyHljsTheme(theme) {
  const link = document.getElementById("hljs-theme");
  if (link) link.href = HLJS_THEME[theme] || HLJS_THEME.light;
}

function initTheme() {
  applyHljsTheme(document.documentElement.getAttribute("data-theme") || "light");

  const toggle = document.getElementById("theme-toggle");
  if (!toggle) return;
  toggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    applyHljsTheme(next);
    try {
      localStorage.setItem("theme", next);
    } catch (e) {}
  });
}

/* ---------- 초기화 ---------- */

function init() {
  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  initTheme();
  window.addEventListener("hashchange", router);
  router();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
