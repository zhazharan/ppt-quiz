# 课件刷题 · PPT 知识点测验

上传课堂 PPT（.pptx / .pdf），自动识别内容、提取知识点，生成选择题 / 判断题 / 填空题在线答题，并给出解析与错题回顾。

纯前端网站（位于 `docs/`），文件在浏览器本地解析，不会上传到服务器。

## 使用
- 在线：通过 GitHub Pages 访问（Settings → Pages → Deploy from a branch → `main` / `/docs`）。
- 本地：`cd docs && python3 -m http.server 8000`，打开 http://localhost:8000

## 出题方式
- **本地规则出题**（默认）：识别“X 是 / 指 / ：Y”式定义、关键词、数字和反义词，生成选择、判断、填空题。
- **AI 出题**（推荐）：在页面“AI 智能出题”中填写 OpenAI 兼容接口（DeepSeek、通义千问、Kimi、OpenAI 等）的地址、模型和 Key，题目质量更高。Key 只保存在浏览器本地，由浏览器直接请求该接口。
