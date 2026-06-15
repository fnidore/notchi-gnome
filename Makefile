# Notchi 顶栏宠物 — 构建 / 安装（GNOME Shell 42）
# 标准目标：make help 看全部；make install 一条龙；make pack 打官方 zip。

UUID    := notchi@fnidore.top
SRC     := src
BIN     := bin
BUILD   := build
EXT_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
ZIP     := $(UUID).shell-extension.zip

.DEFAULT_GOAL := help

.PHONY: help
help:  ## 显示可用目标
	@grep -hE '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
	  | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n",$$1,$$2}'

.PHONY: lint
lint:  ## 本地校验：JS 语法 + gschema 编译（容器内即可跑）
	node --check $(SRC)/extension.js
	node --check $(SRC)/prefs.js
	glib-compile-schemas --dry-run --strict $(SRC)/schemas
	@echo "✅ lint 通过"

.PHONY: install
install:  ## 安装扩展+发送器并合并 Claude hooks（推荐，含备份/幂等）
	bash install.sh

.PHONY: uninstall
uninstall:  ## 卸载扩展并摘除 hooks（带备份）
	bash uninstall.sh

.PHONY: pack
pack: $(ZIP)  ## 打包官方 .shell-extension.zip（不合并 hooks）

$(ZIP): $(shell find $(SRC) -type f) $(BIN)/notchi-send.py $(BIN)/notchi-usage.py
	rm -rf $(BUILD) && mkdir -p $(BUILD)
	cp -r $(SRC)/. $(BUILD)/
	cp $(BIN)/notchi-send.py $(BIN)/notchi-usage.py $(BUILD)/
	gnome-extensions pack $(BUILD) \
	  --extra-source=icons \
	  --extra-source=notchi-send.py \
	  --extra-source=notchi-usage.py \
	  --force --out-dir=.
	rm -rf $(BUILD)
	@echo "✅ 打包完成：$(ZIP)"

.PHONY: install-zip
install-zip: pack  ## 用官方工具安装 zip（注意：不会自动配置 Claude hooks）
	gnome-extensions install --force $(ZIP)
	@echo "⚠️  hooks 未配置——如需事件驱动请另跑 'make install' 或手动合并 hooks"

.PHONY: enable
enable:  ## 启用扩展（需先重载 Shell：Xorg 按 Alt+F2→r；Wayland 注销重登）
	gnome-extensions enable $(UUID)

.PHONY: disable
disable:  ## 停用扩展
	gnome-extensions disable $(UUID)

.PHONY: prefs
prefs:  ## 打开设置界面
	gnome-extensions prefs $(UUID)

.PHONY: clean
clean:  ## 清理构建产物
	rm -rf $(BUILD) $(ZIP) notchi-gnome.zip
	@echo "✅ 已清理"
