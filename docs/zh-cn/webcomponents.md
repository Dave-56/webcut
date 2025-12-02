# Web Components 使用指南

本指南将介绍如何在任何现代Web应用中使用WebCut的Web Components，无需依赖Vue.js。

## 安装

### 选项1：NPM

```bash
npm install webcut
```

### 选项2：CDN

```html
<script src="https://cdn.jsdelivr.net/npm/webcut@latest/webcomponents/index.js"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/webcut@latest/webcomponents/style.css">
```

## 基本使用

### 导入 (NPM方式)

```javascript
import 'webcut/webcomponents';
import 'webcut/webcomponents/style.css';
```

### HTML集成

在HTML中添加Web组件：

```html
<webcut-editor project-id="my-project"></webcut-editor>
```

### 组件列表

- **webcut-editor**: 主编辑器组件
- **webcut-provider**: 视频/音频/图片/文本资源提供器组件
- **webcut-player-screen**: 视频/音频播放屏幕组件
- **webcut-player-button**: 播放控制按钮组件
- **webcut-manager**: 片段管理组件
- **webcut-manager-scaler**: 片段缩放组件
- **webcut-player**: 视频/音频播放组件
- **webcut-select-aspect-ratio**: 选择视频宽高比组件
- **webcut-library**: 资源库组件
- **webcut-video-segment**: 视频片段组件
- **webcut-audio-segment**: 音频片段组件
- **webcut-image-segment**: 图片片段组件
- **webcut-text-segment**: 文本片段组件
- **webcut-clear-selected-tool**: 清除选中片段工具组件
- **webcut-delete-current-tool**: 删除当前片段工具组件
- **webcut-split-current-tool**: 分割当前片段工具组件
- **webcut-split-keep-left-tool**: 分割并保留左侧片段工具组件
- **webcut-split-keep-right-tool**: 分割并保留右侧片段工具组件
- **webcut-panel**: 面板组件
- **webcut-text-panel**: 文本面板组件
- **webcut-basic-panel**: 基本面板组件
- **webcut-time-clock**: 时间时钟组件
- **webcut-export-button**: 导出按钮组件

## 属性

### webcut-editor

- **project-id**: 项目的唯一标识符（可选）

```html
<webcut-editor project-id="my-project"></webcut-editor>
```

## 示例

你可以在 examples/webcomponents 目录下找到完整的示例代码。

## 浏览器支持

Web Components支持所有现代浏览器：

- Chrome 67+
- Firefox 63+
- Safari 13+
- Edge 79+

对于较旧的浏览器，您可能需要包含polyfills。

## 下一步

- 探索JavaScript API以进行更高级的操作
- 将其集成到您现有的应用程序中
- 查看`src/webcomponents.ts`中的源代码了解实现细节