# 钱江两岸低空交通与应急协同 Demo

基于 OpenStreetMap 街区数据的离线课程仿真，展示异构机队调度、风险路径规划、地面与楼顶起降、跨江运输及空地交接。浏览器本地运行，无需后端、地图服务账号或网络连接。

本仓库整理自低空课程项目的 Demo 源码，包含运行所需资源、原始地图、测试、实验脚本和技术文档。源码快照日期：2026-10-22。课件、个人报告、网站部署配置和生成的演示压缩包另行管理。

## 运行

下载仓库 ZIP 并完整解压，双击 `打开Demo.bat`，或使用 Chrome / Edge 打开 [demo/index.html](demo/index.html)。运行 Demo 不需要安装 Node.js、Python、ROS 或 Gazebo。

默认场景有 16 架无人机、2 架救援直升机和 2 架 eVTOL。点击“开始自动演示”可观看日常运营、应急派单、人员转运、消防支援与跨江医疗协同。也可打开 `demo/index.html?autoplay=1` 自动启动。支持暂停、继续、退出、重播，以及 2D / 3D 视图。

自动演示约 90 秒；任务完成状态来自实际仿真，到时未完成的任务会继续运行。操作详见 [标准流程演示](docs/标准流程演示.md)。

## 主要模块

| 路径 | 内容 |
|---|---|
| `demo/` | HTML、CSS、JavaScript、本地 Three.js 与适配地图 |
| `demo/planner.js` | 距离 / 风险 A* 路径规划 |
| `demo/operations.js`、`mixed-operations.js` | 任务派单、能力匹配、优先级、抢占、场站与航路资源 |
| `demo/ground-operations.js` | 起降、地面交接、返场与末端配送 |
| `demo/adaptive-planning.js`、`safety.js` | 按需后台改线、链路和电量异常处理 |
| `demo/classroom-demo.js`、`dispatch-view.js` | 自动流程和调度过程可视化 |
| `data/` | 原始 OSM XML、来源摘要与数据许可证 |
| `tests/` | Node 模型测试与浏览器验证脚本 |
| `tools/` | 地图转换、实验与性能测量脚本 |
| `results/` | 固定配置实验数据、CSV 和结果说明 |
| `docs/` | 核心代码导读、算法分析及模块说明 |

读码建议从 [核心代码导读](docs/核心代码导读.md) 和 [调度算法与实验分析](docs/调度算法与实验分析.md) 开始。部分技术文档保留早期实验配置与课堂材料的背景；当前默认运行行为以源码和标准流程说明为准。

## 开发与验证

模型测试仅使用 Node 内置模块。本次整理使用 Node.js 24：

```powershell
node --test tests/*.test.js
```

2026-10-22 整理时，上述 118 项模型测试全部通过。

实验复现按以下顺序运行，会更新 `results/` 中对应数据：

```powershell
node tools/run-experiments.js
node tools/run-operations-experiments.js
node tools/run-scheduler-ablation.js
node tools/run-mixed-experiments.js
```

地图转换只读取仓库内 XML，使用 Python 标准库，不访问网络：

```powershell
python tools/prepare-qianjiang.py
```

浏览器验证是可选开发步骤，需要已有的 Playwright 与 Chrome。例如在 PowerShell 中指定现有安装路径后运行：

```powershell
$env:LOWAIR_PLAYWRIGHT_PACKAGE = 'D:/path/to/node_modules/playwright'
$env:LOWAIR_CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
node tests/browser-smoke.cjs
```

浏览器测试截图和临时文件写入 `output/`、`.build/`；两个目录均不纳入版本管理。个别视觉测试还使用 Sharp。

## 实验与模型边界

单模块 187 次配置试验、无人机三策略调度 9 次及混合机队 6 次，共 202 次固定配置试验。固定 8 机 / 20 机巡航实验与当前 20 机地面起降实时演示采用不同执行条件，应分别解读。

这是课程工程仿真。风险、能耗、气象、信号、火情及站点均包含教学设定；未模拟真实飞控、气动过程、临床救治或消防流体。返航和自动切换演示环节不等于业务成功。固定地图和少量种子结果不能直接推断真实城市运行效果。

## 数据与第三方许可

- 地图数据：© OpenStreetMap contributors，原始及适配数据库采用 ODbL 1.0，详见 [data/LICENSE.md](data/LICENSE.md)。原始 XML 与转换脚本随仓库提供。
- Three.js：MIT，完整许可证见 [demo/vendor/THREE-LICENSE.txt](demo/vendor/THREE-LICENSE.txt)。
