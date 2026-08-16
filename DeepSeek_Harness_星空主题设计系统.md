# DeepSeek Harness 桌面端 · 星空主题设计系统

## 「Nebula Core」星云核心 —— 设计总纲

---

## 一、设计哲学与情感定位

### 核心意象

以「观测者」视角构建整个交互体验。用户不是在使用一个 AI 工具，而是在操作一座**深空观测站**——透过舷窗凝视星云，与宇宙深处的智能体对话。每一次交互都是一次星际通讯。

### 情感关键词

深邃、神秘、静谧、科技感、孤独的诗意、探索的兴奋

### 设计原则

1. **暗场优先**：全界面以深空黑为基底，所有元素如星光般浮现
2. **呼吸感**：界面元素拒绝拥挤，留白如宇宙真空般辽阔
3. **光的叙事**：用光的流动代替生硬的转场，用星芒的闪烁传递状态
4. **层次景深**：通过模糊、透明度、色彩偏移构建空间纵深感

---

## 二、色彩系统（Color System）

### 主色板 —— 深空光谱

| 色名 | 色值 | 用途 |
|---|---|---|
| **Void Black** | `#030508` | 最深背景，如宇宙深渊 |
| **Nebula Navy** | `#0A0E1A` | 主背景色，带微蓝调的深空 |
| **Abyss Blue** | `#0D1B2A` | 卡片/面板底色，比背景略亮一层 |
| **Stellar Cyan** | `#00D4AA` | 主强调色，极光般的青绿色 |
| **Nebula Violet** | `#7B61FF` | 次强调色，星云紫 |
| **Comet Gold** | `#FFD700` | 高亮/重要状态，彗星尾焰金 |
| **Starlight White** | `#E8F4F8` | 主文字色，带冷调的白 |
| **Dust Gray** | `#6B7B8D` | 次要文字，星际尘埃般的灰蓝 |
| **Horizon Orange** | `#FF6B35` | 警告/异常，地平线余晖橙 |

### 渐变光谱

```css
/* 星云渐变 —— 用于主视觉区域 */
--gradient-nebula: linear-gradient(135deg, 
  rgba(10, 14, 26, 0.95) 0%, 
  rgba(13, 27, 42, 0.8) 50%, 
  rgba(123, 97, 255, 0.15) 100%
);

/* 极光渐变 —— 用于交互元素悬停 */
--gradient-aurora: linear-gradient(90deg, 
  #00D4AA 0%, 
  #7B61FF 50%, 
  #00D4AA 100%
);

/* 彗星尾迹 —— 用于加载/进度 */
--gradient-comet: linear-gradient(180deg,
  rgba(255, 215, 0, 0) 0%,
  rgba(255, 215, 0, 0.8) 50%,
  rgba(255, 215, 0, 0) 100%
);
```

### 透明度层级

- 背景层：100% 不透明（Void Black）
- 面板层：85-92% 不透明 + backdrop-blur
- 悬浮层：60-75% 不透明
- 装饰层：10-30% 不透明

---

## 三、星空背景系统（Background System）

### 3.1 动态星空层（Canvas/WebGL 三层叠加）

#### 第一层：恒星星场（Star Field）

- **数量**：800-1500 颗恒星
- **分布**：非均匀分布，形成隐约的星座连线感
- **亮度变化**：每颗星有独立的呼吸周期（3-8秒随机），模拟大气闪烁（Twinkle）
- **色彩**：90% 冷白（`#E8F4F8`），8% 淡蓝（`#A8D8FF`），2% 淡金（`#FFE4B5`）
- **大小**：1-3px，偶尔出现 4px 的亮星
- **深度视差**：鼠标移动时，不同深度的星以不同速度偏移，营造 3D 空间感

#### 第二层：星云雾霭（Nebula Mist）

- **形态**：3-4 团大型半透明星云，使用 Canvas 径向渐变绘制
- **色彩**：紫罗兰（`#7B61FF`，透明度 0.03-0.08）+ 青绿（`#00D4AA`，透明度 0.02-0.05）
- **动态**：极缓慢漂移（30-60秒完成一次横向移动），如真实星云的自转
- **位置**：避免遮挡主内容区，主要分布在边缘和四角

#### 第三层：流星系统（Meteor Shower）

- **触发**：随机触发，平均每 15-30 秒一颗
- **轨迹**：从右上到左下的弧线，长度约 200-400px
- **视觉**：头部亮白（4px），尾部渐隐为青绿色，带轻微粒子消散效果
- **交互彩蛋**：用户发送消息时，有 30% 概率触发一颗流星划过

### 3.2 参考图色彩提取与应用

从参考图中提取的关键视觉元素：

| 参考图元素 | UI 转化 |
|---|---|
| 画面下方橙金色地平线 | 底部状态栏的暖色渐变边缘 |
| 中央偏上的亮蓝星云团 | 主交互区域的背景光晕 |
| 几道流星弧线 | 消息发送时的动画反馈 |
| 云层与星空的交界过渡 | 面板与背景的模糊过渡边界 |
| 地面城市的金色光网 | 代码/数据展示区的语法高亮色系 |

---

## 四、界面架构与布局（Layout）

### 4.1 整体结构

```
┌─────────────────────────────────────────────────────────┐
│  [轨道边栏]  │         [主视窗 —— 对话区域]              │
│   64px宽    │                                          │
│  图标垂直排列 │    ┌─────────────────────────────┐      │
│  悬浮展开    │    │      星空背景（全透明）        │      │
│             │    │                             │      │
│  🪐 新对话   │    │   [消息气泡 —— 如星际信号]     │      │
│  📡 历史     │    │                             │      │
│  ⚙️ 设置    │    │   [输入框 —— 如通讯终端]       │      │
│  🌙 主题     │    │                             │      │
│             │    └─────────────────────────────┘      │
└─────────────────────────────────────────────────────────┘
         ↓
    [底部状态栏 —— 如飞船仪表盘]
```

### 4.2 轨道边栏（Orbital Sidebar）

- **宽度**：收起 64px，展开 240px
- **背景**：`rgba(10, 14, 26, 0.7)` + `backdrop-filter: blur(20px)`
- **边框**：右侧 1px `rgba(0, 212, 170, 0.1)`，带微弱发光
- **图标**：24px，默认 `Dust Gray`，悬停时变为 `Stellar Cyan` 并发出 8px 光晕
- **展开动画**：如星际舱门滑开，0.4s cubic-bezier(0.16, 1, 0.3, 1)
- **选中态**：图标下方有 2px 高的极光渐变条，如飞船的指示灯

### 4.3 主视窗（Main Viewport）

- **背景**：完全透明，直接展示星空 Canvas
- **消息区域**：垂直居中偏上，最大宽度 800px，两侧留白如宇宙空间
- **安全边距**：上下左右各保留 5% 视口空间，避免内容贴边

---

## 五、消息气泡设计（Message Bubbles）

### 5.1 用户消息（观测者信号）

```css
.user-message {
  background: linear-gradient(135deg, 
    rgba(0, 212, 170, 0.12) 0%, 
    rgba(0, 212, 170, 0.05) 100%
  );
  border: 1px solid rgba(0, 212, 170, 0.2);
  border-radius: 20px 20px 4px 20px; /* 左下角锐角，如信号发射方向 */
  box-shadow: 
    0 0 20px rgba(0, 212, 170, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
  backdrop-filter: blur(10px);
}
```

- **文字色**：`Starlight White`
- **发送动画**：从输入框位置向上「发射」，带轻微尾迹粒子效果，0.5s 后稳定
- **悬停效果**：边框光晕增强，显示精确时间戳（如星际坐标时间）

### 5.2 AI 消息（深空回响）

```css
.ai-message {
  background: linear-gradient(135deg,
    rgba(123, 97, 255, 0.08) 0%,
    rgba(10, 14, 26, 0.6) 100%
  );
  border: 1px solid rgba(123, 97, 255, 0.15);
  border-radius: 20px 20px 20px 4px; /* 右下角锐角 */
  box-shadow: 
    0 0 30px rgba(123, 97, 255, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.03);
  backdrop-filter: blur(12px);
}
```

- **文字色**：`Starlight White`，代码块使用 `Comet Gold` 高亮
- **生成动画**：文字如打字机般逐字浮现，每个字符有 0.02s 的淡入延迟
- **思考状态**：气泡内显示旋转的星云加载器，周围有微弱的引力波环状扩散

### 5.3 代码块（数据核心）

```css
.code-block {
  background: rgba(3, 5, 8, 0.9);
  border: 1px solid rgba(0, 212, 170, 0.15);
  border-radius: 12px;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  box-shadow: inset 0 0 30px rgba(0, 212, 170, 0.03);
}
```

- **语法高亮**：基于星空色板定制
  - 关键字：`Stellar Cyan`
  - 字符串：`Comet Gold`
  - 注释：`Dust Gray`
  - 函数：`Nebula Violet`
  - 数字：`Horizon Orange`
- **行号**：`Dust Gray`，右侧有 1px 分隔线
- **复制按钮**：悬停时从透明浮现为 `Stellar Cyan` 图标

---

## 六、输入终端设计（Input Terminal）

### 6.1 输入框（Comm Terminal）

```css
.input-terminal {
  background: rgba(10, 14, 26, 0.8);
  border: 1px solid rgba(0, 212, 170, 0.2);
  border-radius: 16px;
  backdrop-filter: blur(20px);
  box-shadow: 
    0 -10px 40px rgba(0, 0, 0, 0.3),
    0 0 0 1px rgba(0, 212, 170, 0.05),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
}
```

- **高度**：最小 56px，最大 200px（随内容自动扩展）
- **占位符文字**：`向深空发送信号...`（`Dust Gray`，斜体）
- **聚焦状态**：边框变为 `Stellar Cyan`，底部出现 2px 高的极光渐变扫描线（从左到右流动）
- **光标**：竖线光标，`Stellar Cyan`，带轻微呼吸闪烁（1.2s 周期）

### 6.2 发送按钮（Launch Button）

- **常态**：圆形，40px，边框 `Stellar Cyan`，内部透明，图标为纸飞机
- **悬停**：内部填充 `Stellar Cyan`，图标变为白色，外围出现 8px 光晕环
- **点击**：按钮如发射般向上微移 2px，同时从按钮位置向消息区域发射一道粒子尾迹（0.3s）
- **加载态**：按钮变为旋转的星云环（SVG 动画）

---

## 七、组件细节设计（Component Details）

### 7.1 滚动条（Orbital Scroll）

```css
::-webkit-scrollbar {
  width: 6px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: linear-gradient(180deg, 
    rgba(0, 212, 170, 0.3), 
    rgba(123, 97, 255, 0.3)
  );
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(180deg, 
    rgba(0, 212, 170, 0.6), 
    rgba(123, 97, 255, 0.6)
  );
}
```

- 滚动时，thumb 有轻微的「彗星拖尾」视觉效果

### 7.2 下拉菜单（Stellar Menu）

- **背景**：`rgba(10, 14, 26, 0.95)` + `backdrop-filter: blur(30px)`
- **边框**：1px `rgba(0, 212, 170, 0.15)`
- **项悬停**：背景变为 `rgba(0, 212, 170, 0.1)`，左侧出现 3px `Stellar Cyan` 竖线
- **展开动画**：从触发点向外「展开」，如星图放大，0.2s

### 7.3 对话框/弹窗（Warp Dialog）

- **背景遮罩**：`rgba(3, 5, 8, 0.8)` + 背景星空模糊
- **面板**：从中心「跃迁」出现（scale 0.9→1 + opacity 0→1），带轻微色差分离效果（Chromatic Aberration）0.3s
- **关闭**：向中心坍缩消失

### 7.4 开关/滑块（Quantum Toggle）

- **轨道**：圆角胶囊，背景 `Abyss Blue`，边框 `rgba(0, 212, 170, 0.2)`
- **滑块**：圆形，关闭时为 `Dust Gray`，开启时变为 `Stellar Cyan` 并发出光晕
- **切换动画**：滑块如行星般沿轨道移动，0.3s，带弹性缓动

---

## 八、动效系统（Motion System）

### 8.1 缓动曲线

| 名称 | 值 | 用途 |
|---|---|---|
| **Space Ease** | `cubic-bezier(0.16, 1, 0.3, 1)` | 面板展开、页面切换 |
| **Orbit Ease** | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 按钮点击、弹性反馈 |
| **Light Ease** | `cubic-bezier(0.4, 0, 0.2, 1)` | 颜色过渡、透明度变化 |
| **Warp Ease** | `cubic-bezier(0.7, 0, 0.3, 1)` | 弹窗出现/消失 |

### 8.2 核心动画

**消息进入（Message Entry）**

```
用户消息：从输入框位置向上滑入 30px + 淡入，0.4s Space Ease
AI 消息：从上方滑入 20px + 淡入，0.5s Space Ease，带 0.1s 延迟
```

**思考加载（Thinking State）**

```
- 气泡边框出现流动的极光渐变（沿边框循环，2s 周期）
- 内部显示 3 个脉冲点（...），每个点 0.6s 呼吸周期，错开 0.2s
- 可选：周围出现微弱的引力波环（scale 1→1.5 + opacity 0.3→0，2s 循环）
```

**背景切换（Theme Transition）**

```
切换主题时，整个星空 Canvas 进行「跃迁」：
- 当前星空快速缩放模糊（scale 1→3 + blur 0→20px，0.5s）
- 新主题星空从中心清晰化出现（scale 3→1 + blur 20→0px，0.5s）
```

---

## 九、字体与排版（Typography）

### 字体栈

```css
--font-sans: 'Inter', 'SF Pro Display', -apple-system, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', 'SF Mono', monospace;
--font-display: 'Space Grotesk', 'Inter', sans-serif; /* 标题用，带科技感 */
```

### 字号层级

| 层级 | 大小 | 字重 | 用途 |
|---|---|---|---|
| **Cosmic** | 32px | 700 | 空状态标题、欢迎语 |
| **Nebula** | 24px | 600 | 面板标题 |
| **Star** | 18px | 500 | 消息正文 |
| **Dust** | 14px | 400 | 辅助文字、时间戳 |
| **Signal** | 12px | 500 | 标签、徽章（大写 + 1px 字间距）|

### 特殊排版

- **时间戳**：`Dust` 大小，`Dust Gray`，格式如 `T+ 04:23:17`（模拟任务时间）
- **模型标识**：`Signal` 大小，胶囊形状，背景 `rgba(0, 212, 170, 0.1)`，文字 `Stellar Cyan`
- **代码**：`font-mono`，14px，行高 1.6

---

## 十、状态与反馈（States & Feedback）

### 10.1 网络状态

| 状态 | 视觉表现 |
|---|---|
| 连接中 | 顶部细线进度条，极光渐变，无限循环 |
| 已连接 | 右上角微弱绿点（`Stellar Cyan`，呼吸） |
| 断开 | 顶部出现警告条，文字 `Horizon Orange`，背景脉冲 |
| 重连中 | 绿点变为旋转的断线圆环 |

### 10.2 错误状态

- **背景**：面板边缘出现微弱的 `Horizon Orange` 光晕脉冲
- **图标**：破碎的星形或信号丢失图标
- **文字**：`Horizon Orange`，带重试按钮（`Stellar Cyan` 边框）

---

## 十一、响应式适配（Responsive）

### 桌面端（>1024px）

- 完整三栏布局：边栏 + 主视窗 + 可选右侧面板（设置/模型选择）
- 星空背景全分辨率渲染

### 平板端（768-1024px）

- 边栏变为可滑出的抽屉
- 消息最大宽度 90%

### 移动端（<768px）

- 边栏完全隐藏，通过顶部汉堡菜单触发
- 输入框固定在底部，占满宽度
- 星空粒子数减半以保证性能

---

## 十二、技术实现提示

### 推荐技术栈

- **框架**：Electron / Tauri（桌面端封装）
- **前端**：React / Vue + TypeScript
- **星空渲染**：Canvas 2D（轻量）或 Three.js（3D 视差）
- **动画**：Framer Motion（React）或 GSAP
- **毛玻璃效果**：CSS `backdrop-filter`（注意 Electron 需开启硬件加速）

### 性能优化

- 星空 Canvas 使用 `requestAnimationFrame`，页面不可见时暂停渲染
- 粒子数量根据设备性能动态调整（通过 `navigator.hardwareConcurrency` 判断）
- 使用 `will-change` 谨慎优化动画元素
- 消息虚拟滚动（对话过长时）

---

## 十三、提示词总结（Prompt Summary）

如需用 AI 生成相关视觉素材，可使用以下提示词：

### 主背景生成

> Deep space nebula scene, vast cosmic landscape, vibrant blue and violet nebula clouds swirling in the upper sky, multiple shooting stars with cyan trails streaking across, warm orange and gold horizon glow at the bottom transitioning to deep navy and black night sky, scattered stars twinkling with atmospheric distortion, dark silhouetted terrain below with faint golden city lights, cinematic composition, ultra-wide angle, ethereal and mysterious atmosphere, 8k resolution, digital art, matte painting style, no text, no UI elements

### 图标风格

> Minimalist space-themed icon set, thin line style, cyan and violet gradient, glowing edges, transparent background, futuristic sci-fi aesthetic, clean geometric shapes, stellar and orbital motifs

### 概念氛围图

> Interior of a futuristic deep space observatory, large panoramic window showing nebula and stars outside, holographic control panels with cyan light, dark interior with dramatic lighting, solitary figure silhouette, contemplative mood, cinematic sci-fi concept art, blade runner meets interstellar aesthetic

---

## 十四、设计宣言

> *这套设计系统以「观测站」为核心隐喻，将冰冷的 AI 交互转化为富有诗意的星际通讯体验。每一个像素都在讲述关于宇宙、孤独与探索的故事。*

---

*文档版本：v1.0*  
*主题代号：Nebula Core*  
*适用项目：DeepSeek Harness 桌面端*
