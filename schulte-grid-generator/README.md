# Schulte Grid Video Generator

独立的动态舒尔特方格短视频生成项目。

## 当前样片

- 画幅：720 x 1280
- 帧率：24 fps
- 时长：32 秒
- 数字：1-36
- 布局：8 + 12 + 16 三层同心圆
- 动效：三层圆环独立旋转，数字保持正向可读
- 音频：项目内生成的轻柔环境音乐

## 生成样片

在当前项目目录执行：

```powershell
npm run render
```

输出文件：

```text
output/schulte-focus-sample.mp4
```

## 打开可视化编辑器

```powershell
npm run studio
```

## 可调参数

在 `src/Root.jsx` 中修改：

- `day`：训练天数
- `seed`：数字随机布局
- `durationSeconds`：视频总时长
- `trainingStartsAt`：计时开始时间
- `headline`：开场标题
- `rangeStart` / `rangeEnd`：数字范围

后续批量生成时，只需为每条视频更换 `day` 和 `seed`，即可生成不同数字排列。
