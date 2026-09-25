我将系统提示词（System Instruction）组件的默认状态调整为收起（`const [isOpen, setIsOpen] = useState(false);`），这样能够避免长系统提示词在加载会话详情时过分占用首屏视觉空间，点击标头即可按需展开预览。

## [WIP] feat: 将会话详情面板中的系统提示词默认设置为收起状态

### 用户需求
将会话详情面板中的系统提示词卡片默认状态改为收起。

### 评论
默认收起状态能让界面更加紧凑清爽，用户在需要审计模型底层设定时点击即可展开。

### 目标
修改 `frontend/src/components/SessionDetailPanel.tsx` 中的 `SystemInstructionCard`，将 `useState(true)` 改为 `useState(false)`。

### 基本原理
调整本地组件的状态初始值，实现默认收起。

### 标签
#intent/tune #flow/ready #priority/low #comp/ui #concept/ui #scope/ux #ai/instruct #task/domain/ui #task/object/system-instruction-viewer #task/action/implementation #task/state/continue

---

### Script

#### Acts 1: 将 SystemInstructionCard 默认状态设为收起

~~~~~act
patch_file
frontend/src/components/SessionDetailPanel.tsx
~~~~~
~~~~~typescript.old
function SystemInstructionCard({ instruction }: { instruction: string }) {
  const [isOpen, setIsOpen] = useState(true);

  if (!instruction || !instruction.trim()) return null;
~~~~~
~~~~~typescript.new
function SystemInstructionCard({ instruction }: { instruction: string }) {
  const [isOpen, setIsOpen] = useState(false);

  if (!instruction || !instruction.trim()) return null;
~~~~~

### 下一步建议
运行 `npm run check` 或 `npm run build` 进行前端构建与类型校验。
