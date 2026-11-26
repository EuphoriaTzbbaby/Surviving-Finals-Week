# 期末周求生 · Surviving Finals Week

2026 Qoder 高校创造力大赛 LifeHack 参赛作品：用 3 分钟体验一场“三天九时段”的期末周。

纯前端、无后端依赖，Three.js r147 已本地打包，可直接双击 `期末周求生/dist/index.html` 离线游玩。

## 玩法

- 三天 × 三个时段，在三门科目之间抢时间，兼顾掌握、体力、心态与人脉。
- 66 个随机事件 + 170 道分科真题 + 14 个结局；课程与科目均可自选。
- 第一人称三维校园：宿舍、图书馆、教学楼、食堂、打印店、中庭、篮球场、静心花园、咖啡角 9 处可走到场景，12 位可交谈 NPC（108 条时段话题回复）。
- 自动寻路、小地图、罗盘与地面箭头；手机端摇杆 + 触屏视角。
- WebGL 不可用时一键切回平面模式，剧情与进度不丢。
- 结算生成 1080×1440 战绩卡，含三科成绩单与加权绩点。

## 本地运行

```bash
node tools/serve.js
# 打开 http://127.0.0.1:8765
```

也可以直接打开 `期末周求生/index.html`（源码）或 `期末周求生/dist/index.html`（离线产物）。

## 目录

| 路径 | 内容 |
| --- | --- |
| `期末周求生/` | 游戏源码与本地 Three.js / 音频资源 |
| `期末周求生/dist/` | 可离线分发的构建产物 |
| `tools/` | 构建、静态服务与零依赖自动化测试 |
| `screenshots/` | 游戏画面与开发过程留证 |
| `开发日志.md` | 按时间记录的开发、测试与发布过程 |
| `必做清单.md` | 参赛交付清单与验收状态 |

## 测试

```bash
node tools/campustest.js     # 12 位 NPC × 3 时段 × 3 话题 = 108 条回复，9 场景导航
node tools/worldtest.js      # 三维桌面 / 手机 / 导航专项
node tools/uitest.js         # 完整对局与平面模式
node tools/worldaudio.test.js
node tools/build.js          # 重建 dist
```

自动化基于本地无头 Chrome + CDP，不依赖测试框架。

## 说明

- **最新版在线试玩**：<https://cdwswb.github.io/finals-week-survival/>（GitHub Pages，随 `dist` 更新）
- 源码仓库：<https://github.com/EuphoriaTzbbaby/Surviving-Finals-Week>
- Qoder Sites 原站点：<https://finals-week-survival-k3z3jvrfki4.qoder.zone>（平台故障期间可能落后）
- 仓库中的最新版以 `期末周求生/dist/index.html` 为准。