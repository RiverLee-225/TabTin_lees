#!/usr/bin/env bash
set -u

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ 未找到 Docker CLI。请从 Docker 官方渠道安装 Docker Desktop/Engine。" >&2
  return 1 2>/dev/null || exit 1
fi

if docker info >/dev/null 2>&1; then
  return 0 2>/dev/null || exit 0
fi

case "$(uname -s 2>/dev/null || true)" in
  Darwin*)
    echo "⏳ Docker Desktop 已安装但 daemon 未就绪，尝试自动启动..."
    if ! open -a Docker >/dev/null 2>&1; then
      echo "❌ 无法自动启动 Docker Desktop。请确认应用已安装并完成 macOS 安全确认。" >&2
      return 1 2>/dev/null || exit 1
    fi
    ;;
  Linux*)
    echo "⏳ Docker daemon 未就绪，尝试通过 systemd 启动..."
    systemctl start docker >/dev/null 2>&1 || sudo -n systemctl start docker >/dev/null 2>&1 || true
    ;;
  *)
    echo "❌ Docker daemon 未就绪，当前平台无法自动启动。" >&2
    return 1 2>/dev/null || exit 1
    ;;
esac

echo "⏳ 等待 docker info 成功，最多 120 秒..."
for _ in $(seq 1 60); do
  if docker info >/dev/null 2>&1; then
    echo "✅ Docker daemon 已就绪。"
    return 0 2>/dev/null || exit 0
  fi
  sleep 2
done

echo "❌ Docker daemon 在 120 秒内未就绪。" >&2
echo "   请打开 Docker Desktop，完成首次启动/权限确认后重试。" >&2
return 1 2>/dev/null || exit 1
