# LDStatus Pro v2.6 - 更新日志

## 主要改进

### 1. 🌐 多网站支持 (IDCFlare 集成)

**功能描述：**
- 脚本现在支持 **IDCFlare.com** (https://idcflare.com) 社区
- 自动检测当前网站并加载相应的配置
- 每个网站的数据完全独立存储

**实现细节：**
- 添加了 `SITE_CONFIG` 对象定义支持的网站配置
  ```javascript
  'linux.do': { name: 'Linux.do', icon: '🐧', apiUrl: 'https://connect.linux.do', ... }
  'idcflare.com': { name: 'IDCFlare', icon: '⚡', apiUrl: 'https://connect.idcflare.com', ... }
  ```
- 实现 `detectCurrentSite()` 函数自动识别当前网站
- 为每个网站的存储键添加前缀 (`linux_do_` 或 `idcflare_com_`) 以确保数据隔离
- 面板标题动态显示当前网站的名称和图标

**受影响的文件：**
- `LDStatusPro.user.js` - 脚本头部、配置、API 调用、UI

---

### 2. 🎯 面板拖动优化

#### 功能 2.1：最小化状态下的拖动支持

**问题：** 之前最小化后的小图标无法被拖动移动位置

**解决方案：**
- 重新设计 `bindEvents()` 中的拖动逻辑
- 区分两种拖动模式：
  - **展开状态**：只能拖拽 header（标题栏）移动面板
  - **最小化状态**：可以拖拽整个面板（44x44像素的小圆形）来移动
- 最小化的位置与展开后的位置保持同步（都保存到相同的位置存储键）

**实现代码：**
```javascript
// Header 可以随时拖动（展开时）
this.$.header.addEventListener('mousedown', (e) => {
    if (!this.el.classList.contains('collapsed')) {
        startDrag(e);
    }
});

// 最小化时整个面板可拖动
this.el.addEventListener('mousedown', (e) => {
    if (this.el.classList.contains('collapsed') && !e.target.closest('button')) {
        startDrag(e);
    }
});
```

#### 功能 2.2：智能展开/缩小方向

**问题：** 当面板靠近屏幕右侧时，向右展开会超出屏幕边界

**解决方案：**
- 实现 `optimizeExpandDirection()` 方法，自动判断最佳展开方向
- 检测面板与屏幕右边的距离
- 当距离小于 100px 且左侧距离大于 300px 时，改为向左展开
- 使用 CSS `transform-origin` 属性来控制展开/缩小的原点

**实现代码：**
```javascript
optimizeExpandDirection() {
    const panelRect = this.el.getBoundingClientRect();
    const distanceToRight = window.innerWidth - panelRect.right;
    const distanceToLeft = panelRect.left;
    
    // 如果面板在右侧接近边界，则向左展开
    if (distanceToRight < 100 && distanceToLeft > 300) {
        this.el.style.transformOrigin = 'right center';
    } else {
        this.el.style.transformOrigin = 'left center';
    }
}
```

**CSS 改进：**
- 优化了 `.collapsed` 样式，改为使用 `!important` 确保最小化时的尺寸
- 添加了过渡动画支持：宽度、高度、圆角都有平滑的 0.3s 过渡

---

### 3. 🎨 UI/UX 改进

- **面板标题更新** - 显示网站标识和名称（如 "🐧 Linux.do" 或 "⚡ IDCFlare"）
- **光标提示** - 最小化时光标改为 `move` 以提示可拖动
- **位置同步** - 确保最小化和展开状态的位置完全同步
- **初始化优化** - 在面板恢复后自动计算最佳展开方向

---

## 技术细节

### 存储键隔离

为了支持多个社区并保持数据隔离，实现了网站特定的前缀系统：

```javascript
CONFIG.SITE_PREFIX = CURRENT_SITE.domain.replace('.', '_');  // 'linux_do' 或 'idcflare_com'

// 获取用户特定的存储键
getUserKey(key) {
    const user = this.getCurrentUser();
    const baseKey = CONFIG.STORAGE_KEYS[key];
    const sitePrefix = `${CONFIG.SITE_PREFIX}_`;
    
    if (user && CONFIG.USER_SPECIFIC_KEYS.includes(key)) {
        return `${sitePrefix}${baseKey}_${user}`;
    }
    return `${sitePrefix}${baseKey}`;
}
```

这确保了：
- Linux.do 的数据存储在 `linux_do_history_username` 下
- IDCFlare 的数据存储在 `idcflare_com_history_username` 下
- 两个网站的数据完全独立，不会相互干扰

---

## 版本号更新

- **脚本版本**：2.5 → 2.6
- **脚本描述**：更新为支持多网站
- **@match**：添加 `https://idcflare.com/*`
- **@connect**：添加 `connect.idcflare.com` 和 `idcflare.com`

---

## 测试建议

1. **多网站切换**
   - 在 Linux.do 和 IDCFlare 上分别访问
   - 验证数据独立存储
   - 检查面板标题显示正确的网站名称

2. **拖动功能**
   - 展开状态下拖拽 header
   - 最小化状态下拖拽整个面板
   - 验证位置保存和恢复正确

3. **展开方向**
   - 将面板放在屏幕右侧
   - 最小化并再次展开
   - 确认面板不会超出屏幕右边界

4. **多账户支持**
   - 在同一网站的不同账户间切换
   - 确认数据隔离工作正常

---

## 向后兼容性

脚本与之前版本的数据向后兼容：
- 没有进行破坏性的存储键更改
- 旧的 Linux.do 数据会自动添加前缀
- 多用户迁移逻辑已存在，可处理旧格式数据

---

## 已知限制

- IDCFlare 和 Linux.do 的 HTML 结构必须相似（目前假设相同）
- 如果两个网站的 API 响应格式不同，可能需要进一步调整 `parse()` 方法
- 脚本不支持跨网站数据聚合

---

## 未来改进方向

- 支持更多社区平台
- 允许用户自定义网站配置
- 数据导入/导出功能
- 跨网站数据对比分析
