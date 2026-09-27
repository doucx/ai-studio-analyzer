# 📸 Snapshot Capture

### 💬 备注:
format_and_check

检测到工作区发生变更。

### 📝 变更文件摘要:
```
frontend/src/components/OverviewDashboard.tsx  |   2 +-
 frontend/src/components/SessionDetailPanel.tsx |  16 +--
 frontend/src/components/ToastContainer.tsx     |   2 +-
 frontend/src/state/toast.ts                    |   2 +-
 frontend/src/utils/date.ts                     |   2 +-
 scripts/quipu/__init__.py                      |   2 +-
 scripts/quipu/__main__.py                      |   2 +-
 scripts/quipu/core.py                          |  28 ++--
 scripts/quipu/main.py                          | 187 +++++++++++++++++++------
 src/analyzer/cache.py                          |   6 +-
 src/analyzer/config.py                         |   4 +-
 src/server/api.py                              |   7 +-
 12 files changed, 181 insertions(+), 79 deletions(-)
```